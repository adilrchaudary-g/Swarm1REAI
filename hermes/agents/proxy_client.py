"""HTTP client for the Claude CLI proxy server."""

from __future__ import annotations

import json
import urllib.request
import urllib.error
from typing import Any


class ClaudeProxyClient:
    def __init__(self, base_url: str = "http://127.0.0.1:8766"):
        self.base_url = base_url
        self._available: bool | None = None

    def is_available(self) -> bool:
        try:
            req = urllib.request.Request(f"{self.base_url}/health")
            with urllib.request.urlopen(req, timeout=3) as resp:
                data = json.loads(resp.read())
                self._available = data.get("available", False)
                return self._available
        except Exception:
            self._available = False
            return False

    def prompt(self, text: str, system: str | None = None) -> str | None:
        try:
            body = {"prompt": text}
            if system:
                body["system"] = system
            data = json.dumps(body).encode()
            req = urllib.request.Request(
                f"{self.base_url}/prompt",
                data=data,
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            with urllib.request.urlopen(req, timeout=180) as resp:
                result = json.loads(resp.read())
                if result.get("status") == "ok":
                    return result.get("response")
                return None
        except Exception:
            return None

    def health(self) -> dict[str, Any]:
        try:
            req = urllib.request.Request(f"{self.base_url}/health")
            with urllib.request.urlopen(req, timeout=3) as resp:
                return json.loads(resp.read())
        except Exception:
            return {"available": False, "error": "Proxy unreachable"}
