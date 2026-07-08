"""Claude CLI Proxy — turns `claude -p` into a local HTTP API on port 8766.

Uses the operator's existing Claude Code subscription. No API tokens.
Serial queue: one prompt at a time (CLI is single-user).
"""

from __future__ import annotations

import json
import queue
import shutil
import subprocess
import threading
import time
import uuid
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any


class ClaudeProxy:
    def __init__(self, max_queue: int = 10, timeout: int = 120):
        self.claude_bin = shutil.which("claude")
        self.available = self.claude_bin is not None
        self.timeout = timeout
        self.max_queue = max_queue
        self._queue: queue.Queue[dict] = queue.Queue(maxsize=max_queue)
        self._results: dict[str, dict] = {}
        self._results_lock = threading.Lock()
        self._total_calls = 0
        self._worker = threading.Thread(target=self._worker_loop, daemon=True)
        self._worker.start()

    def _worker_loop(self) -> None:
        while True:
            item = self._queue.get()
            ticket = item["ticket"]
            try:
                start = time.monotonic()
                result = subprocess.run(
                    [self.claude_bin, "-p", item["prompt"], "--no-input"],
                    capture_output=True,
                    text=True,
                    timeout=self.timeout,
                )
                elapsed_ms = int((time.monotonic() - start) * 1000)
                self._total_calls += 1

                if result.returncode == 0:
                    response = {
                        "status": "ok",
                        "response": result.stdout.strip(),
                        "elapsed_ms": elapsed_ms,
                    }
                else:
                    response = {
                        "status": "error",
                        "error": result.stderr.strip() or f"Exit code {result.returncode}",
                        "elapsed_ms": elapsed_ms,
                    }
            except subprocess.TimeoutExpired:
                response = {"status": "timeout", "error": f"Claude CLI timed out after {self.timeout}s"}
            except Exception as e:
                response = {"status": "error", "error": str(e)}

            with self._results_lock:
                self._results[ticket] = response
            self._queue.task_done()

    def submit(self, prompt: str, system: str | None = None) -> str | None:
        if not self.available:
            return None
        ticket = uuid.uuid4().hex[:12]
        full_prompt = f"{system}\n\n{prompt}" if system else prompt
        try:
            self._queue.put_nowait({"ticket": ticket, "prompt": full_prompt})
        except queue.Full:
            return None
        return ticket

    def poll(self, ticket: str) -> dict | None:
        with self._results_lock:
            return self._results.pop(ticket, None)

    def prompt_sync(self, prompt: str, system: str | None = None) -> dict:
        if not self.available:
            return {"status": "unavailable", "error": "Claude CLI not found"}
        ticket = self.submit(prompt, system)
        if ticket is None:
            return {"status": "queue_full", "error": "Prompt queue is full"}
        for _ in range(self.timeout * 10):
            result = self.poll(ticket)
            if result is not None:
                return result
            time.sleep(0.1)
        return {"status": "timeout", "error": "Timed out waiting for result"}

    @property
    def queue_depth(self) -> int:
        return self._queue.qsize()

    def health(self) -> dict[str, Any]:
        return {
            "available": self.available,
            "queue_depth": self.queue_depth,
            "total_calls": self._total_calls,
            "claude_bin": self.claude_bin or "not found",
        }


def create_server(host: str, port: int) -> ThreadingHTTPServer:
    proxy = ClaudeProxy()

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, format: str, *args: Any) -> None:
            pass

        def _send_json(self, status: HTTPStatus, body: dict) -> None:
            data = json.dumps(body).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
            self.end_headers()
            self.wfile.write(data)

        def do_OPTIONS(self) -> None:
            self.send_response(HTTPStatus.NO_CONTENT)
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
            self.end_headers()

        def do_GET(self) -> None:
            if self.path == "/health":
                self._send_json(HTTPStatus.OK, proxy.health())
                return
            self._send_json(HTTPStatus.NOT_FOUND, {"error": "Not found"})

        def do_POST(self) -> None:
            if self.path == "/prompt":
                length = int(self.headers.get("Content-Length", 0))
                body = json.loads(self.rfile.read(length)) if length else {}

                prompt = body.get("prompt", "")
                if not prompt:
                    self._send_json(HTTPStatus.BAD_REQUEST, {"error": "Missing 'prompt' field"})
                    return

                if not proxy.available:
                    self._send_json(HTTPStatus.SERVICE_UNAVAILABLE, {
                        "status": "unavailable",
                        "error": "Claude CLI not found on this machine",
                    })
                    return

                if proxy.queue_depth >= proxy.max_queue:
                    self._send_json(HTTPStatus.TOO_MANY_REQUESTS, {
                        "status": "queue_full",
                        "error": f"Queue full ({proxy.max_queue} pending)",
                    })
                    return

                system = body.get("system")
                result = proxy.prompt_sync(prompt, system=system)

                if result["status"] == "ok":
                    self._send_json(HTTPStatus.OK, result)
                elif result["status"] == "timeout":
                    self._send_json(HTTPStatus.GATEWAY_TIMEOUT, result)
                else:
                    self._send_json(HTTPStatus.INTERNAL_SERVER_ERROR, result)
                return

            if self.path == "/prompt/async":
                length = int(self.headers.get("Content-Length", 0))
                body = json.loads(self.rfile.read(length)) if length else {}

                prompt = body.get("prompt", "")
                if not prompt:
                    self._send_json(HTTPStatus.BAD_REQUEST, {"error": "Missing 'prompt' field"})
                    return

                ticket = proxy.submit(prompt, system=body.get("system"))
                if ticket is None:
                    status = HTTPStatus.SERVICE_UNAVAILABLE if not proxy.available else HTTPStatus.TOO_MANY_REQUESTS
                    self._send_json(status, {"error": "Cannot submit prompt"})
                    return

                self._send_json(HTTPStatus.ACCEPTED, {"ticket": ticket})
                return

            if self.path.startswith("/prompt/poll/"):
                ticket = self.path.split("/")[-1]
                result = proxy.poll(ticket)
                if result is None:
                    self._send_json(HTTPStatus.OK, {"status": "pending"})
                else:
                    self._send_json(HTTPStatus.OK, result)
                return

            self._send_json(HTTPStatus.NOT_FOUND, {"error": "Not found"})

    server = ThreadingHTTPServer((host, port), Handler)
    return server


def run(host: str = "127.0.0.1", port: int = 8766) -> None:
    server = create_server(host, port)
    status = "available" if shutil.which("claude") else "UNAVAILABLE (claude CLI not found)"
    print(f"Claude proxy listening on http://{host}:{port}  status={status}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down Claude proxy")
        server.shutdown()
