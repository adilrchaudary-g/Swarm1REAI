from __future__ import annotations

import json
import mimetypes
import os
import re
import subprocess
import sys
import threading
import time
from datetime import datetime, timezone
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlparse

from .store import HermesStore

_STREET_ABBREVS = {
    "street": "st", "saint": "st", "avenue": "ave", "boulevard": "blvd",
    "drive": "dr", "court": "ct", "place": "pl", "lane": "ln",
    "road": "rd", "circle": "cir", "terrace": "ter", "trail": "trl",
    "way": "wy", "parkway": "pkwy", "highway": "hwy",
    "north": "n", "south": "s", "east": "e", "west": "w",
    "northeast": "ne", "northwest": "nw", "southeast": "se", "southwest": "sw",
    "apartment": "apt", "suite": "ste", "building": "bldg", "floor": "fl",
}

def _normalize_address(addr: str) -> str:
    """Normalize street address for cross-source matching."""
    addr = addr.lower().strip()
    addr = re.sub(r"[.,#\-/]", " ", addr)
    addr = re.sub(r"\s+", " ", addr)
    parts = addr.split()
    parts = [_STREET_ABBREVS.get(p, p) for p in parts]
    return "".join(parts)


_repo_env = Path(__file__).resolve().parent.parent / ".env"
if _repo_env.is_file():
    for _line in _repo_env.read_text().splitlines():
        _line = _line.strip()
        if not _line or _line.startswith("#"):
            continue
        _eq = _line.find("=")
        if _eq == -1:
            continue
        _k, _v = _line[:_eq].strip(), _line[_eq + 1:].strip()
        os.environ.setdefault(_k, _v)

# ── Skip-trace pipeline state (module-level, shared across requests) ──
_pipeline_state: dict[str, Any] = {
    "running": False,
    "job_id": None,
    "log_lines": [],
    "started_at": None,
    "completed_at": None,
    "result": None,
    "error": None,
    "address_count": 0,
    "phase": "idle",
}
_pipeline_lock = threading.Lock()

# ── County scouting state (module-level) ──
_scout_state: dict[str, Any] = {
    "running": False,
    "job_id": None,
    "log_lines": [],
    "started_at": None,
    "completed_at": None,
    "phase": "idle",
}
_scout_lock = threading.Lock()


def _job_log_messages(job: dict[str, Any] | None) -> list[str]:
    if not job:
        return []

    try:
        raw_lines = json.loads(job.get("log_lines_json") or "[]")
    except Exception:
        return []

    messages: list[str] = []
    for entry in raw_lines:
        if isinstance(entry, dict):
            msg = entry.get("msg")
            if msg is not None:
                messages.append(str(msg))
        elif entry is not None:
            messages.append(str(entry))
    return messages


def _scout_status_from_job(job: dict[str, Any] | None) -> dict[str, Any]:
    if not job:
        return dict(_scout_state)

    status = str(job.get("status") or "")
    return {
        "running": status == "running",
        "job_id": job.get("job_id"),
        "log_lines": _job_log_messages(job),
        "started_at": job.get("started_at"),
        "completed_at": job.get("completed_at"),
        "phase": job.get("phase") or ("running" if status == "running" else "idle"),
    }

# ── Court records scrape state (module-level, shared across requests) ──
_court_records_state: dict[str, Any] = {
    "running": False,
    "job_id": None,
    "log_lines": [],
    "started_at": None,
    "completed_at": None,
    "result": None,
    "error": None,
    "phase": "idle",
}
_court_records_lock = threading.Lock()

# ── FSBO scrape state (module-level, shared across requests) ──
_fsbo_scrape_state: dict[str, Any] = {
    "running": False,
    "job_id": None,
    "log_lines": [],
    "started_at": None,
    "completed_at": None,
    "result": None,
    "error": None,
    "phase": "idle",
}
_fsbo_scrape_lock = threading.Lock()

# ── Evaluation pipeline state (module-level) ──
_eval_state: dict[str, Any] = {
    "running": False,
    "log_lines": [],
    "started_at": None,
    "completed_at": None,
    "total": 0,
    "processed": 0,
    "passed": 0,
    "failed": 0,
    "phase": "idle",
}
_eval_lock = threading.Lock()

# ── Underwriting pipeline state (module-level) ──
_underwrite_state: dict[str, Any] = {
    "running": False,
    "lead_id": None,
    "started_at": None,
    "completed_at": None,
    "phase": "idle",
}
_underwrite_lock = threading.Lock()


def _auto_skip_trace_if_needed(runtime: "HermesRuntime") -> None:
    """Check for leads without phones and auto-start the skip trace pipeline.

    Called after every ingestion endpoint. Runs in a background thread so the
    HTTP response returns immediately.
    """
    with _pipeline_lock:
        if _pipeline_state["running"]:
            return

    with runtime.store._connect() as conn:
        row = conn.execute("""
            SELECT COUNT(*) as cnt FROM leads l
            LEFT JOIN owner_phones op ON op.owner_id = l.owner_id
            WHERE op.id IS NULL
            AND l.status NOT IN ('archived', 'dead')
        """).fetchone()
        phoneless = row["cnt"] if row else 0

    if phoneless == 0:
        return

    def _bg():
        try:
            _run_skip_trace_pipeline(runtime, source=None)
        except Exception:
            pass

    t = threading.Thread(target=_bg, daemon=True)
    t.start()


# ── Call Recording helpers ───────────────────────────────────

_ALLOWED_AUDIO_EXTS = {".mov", ".mp4", ".mp3", ".m4a", ".wav", ".webm"}


def _handle_recording_upload(handler: Any, runtime: "HermesRuntime") -> dict[str, Any]:
    """Parse multipart/form-data upload and create a call recording."""
    import cgi
    content_type = handler.headers.get("Content-Type", "")
    length = int(handler.headers.get("Content-Length", 0))
    raw = handler.rfile.read(length)

    boundary = ""
    for part in content_type.split(";"):
        part = part.strip()
        if part.startswith("boundary="):
            boundary = part.split("=", 1)[1].strip('"')
            break

    parts: dict[str, Any] = {}
    file_data: bytes | None = None
    file_name: str | None = None
    file_type: str | None = None

    if boundary:
        sep = f"--{boundary}".encode()
        chunks = raw.split(sep)
        for chunk in chunks:
            if b"Content-Disposition" not in chunk:
                continue
            header_end = chunk.find(b"\r\n\r\n")
            if header_end == -1:
                continue
            header_part = chunk[:header_end].decode("utf-8", errors="replace")
            body_part = chunk[header_end + 4:]
            if body_part.endswith(b"\r\n"):
                body_part = body_part[:-2]

            name = ""
            fname = ""
            for line in header_part.split("\r\n"):
                if "Content-Disposition" in line:
                    for item in line.split(";"):
                        item = item.strip()
                        if item.startswith("name="):
                            name = item.split("=", 1)[1].strip('"')
                        elif item.startswith("filename="):
                            fname = item.split("=", 1)[1].strip('"')

            if fname:
                file_data = body_part
                file_name = fname
                ext = os.path.splitext(fname)[1].lower()
                file_type = ext.lstrip(".")
            else:
                parts[name] = body_part.decode("utf-8", errors="replace")

    recordings_dir = runtime.store.data_dir / "recordings"
    recordings_dir.mkdir(parents=True, exist_ok=True)

    file_path = None
    if file_data and file_name:
        import uuid
        safe_name = f"{uuid.uuid4().hex}_{file_name}"
        file_path = str(recordings_dir / safe_name)
        Path(file_path).write_bytes(file_data)

    data = {
        "seller_name": parts.get("seller_name", ""),
        "property_address": parts.get("property_address"),
        "call_date": parts.get("call_date"),
        "file_path": file_path,
        "file_name": file_name,
        "file_type": file_type,
        "next_action": parts.get("next_action"),
        "next_action_due": parts.get("next_action_due"),
        "notes": parts.get("notes"),
    }
    result = runtime.store.create_call_recording(data)

    if file_path:
        rec_id = result["id"]
        t = threading.Thread(
            target=_transcribe_and_grade, args=(runtime, rec_id), daemon=True
        )
        t.start()

    return result


def _transcribe_and_grade(runtime: "HermesRuntime", rec_id: int) -> None:
    """Transcribe audio with local mlx-whisper, then grade the transcript."""
    rec = runtime.store.get_call_recording(rec_id)
    if not rec or not rec.get("file_path"):
        return

    fp = Path(rec["file_path"])
    if not fp.is_file():
        return

    # Convert to wav first if needed (mlx-whisper works best with wav/mp3)
    audio_path = str(fp)
    tmp_wav = None
    if fp.suffix.lower() in (".mov", ".mp4", ".m4a", ".webm"):
        tmp_wav = str(fp.with_suffix(".wav"))
        try:
            result = subprocess.run(
                ["ffmpeg", "-y", "-i", audio_path, "-ar", "16000", "-ac", "1",
                 "-c:a", "pcm_s16le", tmp_wav],
                capture_output=True, text=True, timeout=300,
            )
            if result.returncode == 0:
                audio_path = tmp_wav
            else:
                print(f"[call-recordings] ffmpeg conversion failed: {result.stderr[:500]}")
        except Exception as exc:
            print(f"[call-recordings] ffmpeg failed for {rec_id}: {exc}")

    transcript = None
    try:
        import whisper as _whisper
        print(f"[call-recordings] Transcribing {rec_id} with whisper (medium model)...")
        _model = _whisper.load_model("medium")
        result = _model.transcribe(audio_path)
        transcript = result.get("text", "").strip()
        print(f"[call-recordings] Transcription complete for {rec_id}: {len(transcript)} chars")
    except Exception as exc:
        print(f"[call-recordings] whisper transcription failed for {rec_id}: {exc}")

    # Clean up temp wav
    if tmp_wav and Path(tmp_wav).exists():
        try:
            Path(tmp_wav).unlink()
        except OSError:
            pass

    if not transcript:
        runtime.store.update_call_recording(rec_id, {
            "transcript": "(transcription failed — check server logs)"
        })
        return

    runtime.store.update_call_recording(rec_id, {"transcript": transcript})
    _grade_recording(runtime, rec_id, transcript)


def _grade_recording(runtime: "HermesRuntime", rec_id: int, transcript: str) -> None:
    """Grade a call transcript using Claude API (optional — skips if no key)."""
    api_key = os.environ.get("ANTHROPIC_API_KEY", "")
    if not api_key:
        print(f"[call-recordings] Skipping grading for {rec_id} — no ANTHROPIC_API_KEY set")
        return

    prompt = f"""You are an expert real estate wholesaling call coach. Analyze this seller call transcript and produce two structured grades.

TRANSCRIPT:
{transcript}

IMPORTANT: Assume the caller is generally competent. Reserve low scores for clear breakdowns only.

Respond with ONLY valid JSON in this exact format:
{{
  "my_performance": {{
    "controlled_conversation": "yes/no with brief explanation",
    "uncovered_motivation": "yes/no with brief explanation",
    "handled_objections": "well/adequately/poorly with brief explanation",
    "momentum_loss": "where momentum was lost, or 'none'",
    "score": 7,
    "summary": "1-2 sentence overall assessment"
  }},
  "seller_motivation": {{
    "core_reason": "their primary reason for selling",
    "motivation_level": 6,
    "emotional_or_logical": "emotional/logical/mixed with brief explanation",
    "timeline": "their selling timeline",
    "overall_sentiment": "Hot",
    "summary": "1-2 sentence assessment of seller readiness"
  }},
  "call_score": "Strong"
}}

For call_score use exactly one of: "Strong", "Average", "Needs Work"
For overall_sentiment use exactly one of: "Hot", "Warm", "Cold", "Dead"
"""

    try:
        import urllib.request
        req_body = json.dumps({
            "model": "claude-sonnet-4-6",
            "max_tokens": 1024,
            "messages": [{"role": "user", "content": prompt}],
        }).encode()
        req = urllib.request.Request(
            "https://api.anthropic.com/v1/messages",
            data=req_body,
            headers={
                "x-api-key": api_key,
                "anthropic-version": "2023-06-01",
                "Content-Type": "application/json",
            },
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=60) as resp:
            result = json.loads(resp.read().decode())

        text = ""
        for block in result.get("content", []):
            if block.get("type") == "text":
                text += block["text"]

        start = text.find("{")
        end = text.rfind("}") + 1
        if start >= 0 and end > start:
            grades = json.loads(text[start:end])
            runtime.store.update_call_recording(rec_id, {
                "my_performance_json": grades.get("my_performance"),
                "seller_motivation_json": grades.get("seller_motivation"),
                "call_score": grades.get("call_score", "Average"),
            })
    except Exception as exc:
        print(f"[call-recordings] Grading failed for {rec_id}: {exc}")


# Content types for static files
STATIC_CONTENT_TYPES: dict[str, str] = {
    ".html": "text/html; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".ico": "image/x-icon",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".ttf": "font/ttf",
    ".map": "application/json",
}


class HermesRuntime:
    def __init__(self, root: Path, *, static_dir: Path | None = None) -> None:
        self.root = root
        self.store = HermesStore(root)
        self.store.initialize()
        self.store.recover_running_jobs(
            "county_scout",
            error="Server restarted while county scout job was running",
            log_line="[scout] Server restarted before completion; previous scout job marked failed",
        )
        # Resolve dashboard dist directory for static file serving
        if static_dir and static_dir.is_dir():
            self.static_dir: Path | None = static_dir.resolve()
        else:
            # Auto-detect: look for ../dashboard/dist relative to hermes/
            candidate = root.parent / "dashboard" / "dist"
            self.static_dir = candidate.resolve() if candidate.is_dir() else None
        self._register_source_adapters()

    def _register_source_adapters(self) -> None:
        try:
            from lead_engine.sources import list_sources, get_adapter
            for source_type in list_sources():
                adapter = get_adapter(source_type)
                self.store.upsert_source_adapter(
                    source_type, adapter.source_name, adapter.data_quality_tier,
                )
        except ImportError:
            pass

        self.store.upsert_source_adapter(
            "water_shutoffs",
            "Water Shutoff Lists",
            "PARTIAL",
        )

        self.store.upsert_source_adapter(
            "court_records",
            "Court Records (CaseNet)",
            "PARTIAL",
        )

    def create_server(self, host: str = "127.0.0.1", port: int = 8765) -> ThreadingHTTPServer:
        runtime = self

        class Handler(BaseHTTPRequestHandler):
            server_version = "HermesRuntime/0.1"

            def log_message(self, format: str, *args: Any) -> None:  # noqa: A003
                return

            def _cors_headers(self) -> None:
                self.send_header("Access-Control-Allow-Origin", "*")
                self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
                self.send_header("Access-Control-Allow-Headers", "Content-Type, X-Export-CSV-Path")

            def _send_json(self, status: int, payload: Any) -> None:
                body = json.dumps(payload, indent=2, sort_keys=True, default=str).encode("utf-8")
                self.send_response(status)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Content-Length", str(len(body)))
                self._cors_headers()
                self.end_headers()
                self.wfile.write(body)

            def _read_json(self) -> dict[str, Any]:
                length = int(self.headers.get("Content-Length") or "0")
                raw = self.rfile.read(length) if length else b"{}"
                return json.loads(raw.decode("utf-8"))

            def _query_first(self, query: dict, key: str, default: str | None = None) -> str | None:
                values = query.get(key)
                if values:
                    return values[0]
                return default

            def do_OPTIONS(self) -> None:  # noqa: N802
                self.send_response(HTTPStatus.NO_CONTENT)
                self._cors_headers()
                self.end_headers()

            def do_GET(self) -> None:  # noqa: N802
                parsed = urlparse(self.path)
                path = parsed.path
                query = parse_qs(parsed.query)

                if path == "/health":
                    self._send_json(HTTPStatus.OK, {"status": "ok"})
                    return

                if path == "/bridge/poll":
                    lane = (query.get("lane") or ["houses"])[0]
                    after = (query.get("after") or [None])[0]
                    wait_ms = int((query.get("wait_ms") or ["0"])[0] or 0)
                    deadline = time.time() + (wait_ms / 1000.0 if wait_ms > 0 else 0)
                    commands = runtime.store.poll_commands(lane=lane, after=after, limit=1)
                    while not commands and wait_ms > 0 and time.time() < deadline:
                        time.sleep(0.25)
                        commands = runtime.store.poll_commands(lane=lane, after=after, limit=1)
                    self._send_json(HTTPStatus.OK, commands)
                    return

                # ── Dashboard API (GET) ──────────────────────────────

                if path == "/api/leads":
                    exclude_raw = self._query_first(query, "exclude_statuses")
                    exclude_list = [s.strip() for s in exclude_raw.split(",") if s.strip()] if exclude_raw else None
                    data = runtime.store.list_all_leads(
                        status=self._query_first(query, "status"),
                        exclude_statuses=exclude_list,
                        tier=self._query_first(query, "tier"),
                        source=self._query_first(query, "source"),
                        persona=self._query_first(query, "persona"),
                        limit=int(self._query_first(query, "limit", "100")),
                        offset=int(self._query_first(query, "offset", "0")),
                    )
                    self._send_json(HTTPStatus.OK, data)
                    return

                m = re.match(r"^/api/leads/([^/]+)$", path)
                if m:
                    lead = runtime.store.get_lead_detail(m.group(1))
                    if lead:
                        self._send_json(HTTPStatus.OK, lead)
                    else:
                        self._send_json(HTTPStatus.NOT_FOUND, {"error": "Lead not found"})
                    return

                if path == "/api/pipeline/stats":
                    self._send_json(HTTPStatus.OK, runtime.store.get_pipeline_stats())
                    return

                if path == "/api/queue/hot":
                    data = runtime.store.query_queue("hot", limit=int(self._query_first(query, "limit", "50")))
                    self._send_json(HTTPStatus.OK, data)
                    return

                if path == "/api/queue/all":
                    data = runtime.store.query_queue("all", limit=int(self._query_first(query, "limit", "100")))
                    self._send_json(HTTPStatus.OK, data)
                    return

                if path == "/api/sources":
                    self._send_json(HTTPStatus.OK, runtime.store.list_source_adapters())
                    return

                if path == "/api/quota":
                    quota = runtime.store.get_latest_quota()
                    self._send_json(HTTPStatus.OK, quota or {})
                    return

                if path == "/api/kpi/summary":
                    self._send_json(HTTPStatus.OK, runtime.store.get_kpi_summary())
                    return

                if path == "/api/pending-verification":
                    data = runtime.store.pending_verification_stats()
                    data["items"] = runtime.store.list_pending_verification(
                        status=self._query_first(query, "status", "pending"),
                        source=self._query_first(query, "source"),
                        limit=int(self._query_first(query, "limit", "500")),
                    )
                    self._send_json(HTTPStatus.OK, data)
                    return

                if path == "/api/jobs":
                    data = runtime.store.list_jobs(
                        job_type=self._query_first(query, "type"),
                        limit=int(self._query_first(query, "limit", "20")),
                    )
                    self._send_json(HTTPStatus.OK, data)
                    return

                m_job = re.match(r"^/api/jobs/([^/]+)$", path)
                if m_job:
                    job = runtime.store.get_job(m_job.group(1))
                    if job:
                        self._send_json(HTTPStatus.OK, job)
                    else:
                        self._send_json(HTTPStatus.NOT_FOUND, {"error": "Job not found"})
                    return

                if path == "/api/command-queue/status":
                    self._send_json(HTTPStatus.OK, runtime.store.get_command_queue_status())
                    return

                if path == "/api/follow-ups":
                    pending = self._query_first(query, "pending", "true") == "true"
                    data = runtime.store.list_follow_ups(
                        pending_only=pending,
                        limit=int(self._query_first(query, "limit", "50")),
                    )
                    self._send_json(HTTPStatus.OK, data)
                    return

                if path == "/api/markets":
                    data = _get_markets(runtime)
                    self._send_json(HTTPStatus.OK, data)
                    return

                # ── Social / Bandit (GET) ────────────────────────────
                if path == "/api/social-bandit/stats":
                    self._send_json(HTTPStatus.OK, runtime.store.social_bandit_stats())
                    return

                if path == "/api/social-bandit/campaigns":
                    self._send_json(HTTPStatus.OK, runtime.store.list_social_campaigns())
                    return

                if path == "/api/social-bandit/comments":
                    data = runtime.store.list_social_comments(
                        status=self._query_first(query, "status"),
                        campaign_id=int(self._query_first(query, "campaign_id", "0")) or None,
                        limit=int(self._query_first(query, "limit", "200")),
                    )
                    self._send_json(HTTPStatus.OK, data)
                    return

                # ── Water Shutoffs (GET) ─────────────────────────────
                if path == "/api/water-shutoffs/stats":
                    self._send_json(HTTPStatus.OK, runtime.store.water_shutoff_stats())
                    return

                if path == "/api/water-shutoffs/requests":
                    data = runtime.store.list_foia_requests(
                        limit=int(self._query_first(query, "limit", "50")),
                    )
                    self._send_json(HTTPStatus.OK, data)
                    return

                if path == "/api/water-shutoffs/records":
                    data = runtime.store.list_water_shutoff_records(
                        foia_request_id=int(self._query_first(query, "foia_request_id", "0")) or None,
                        status=self._query_first(query, "status"),
                        limit=int(self._query_first(query, "limit", "200")),
                    )
                    self._send_json(HTTPStatus.OK, data)
                    return

                # ── FSBOs (GET) ──────────────────────────────────────
                if path == "/api/fsbo/stats":
                    self._send_json(HTTPStatus.OK, runtime.store.fsbo_stats())
                    return

                if path == "/api/fsbo/markets":
                    self._send_json(HTTPStatus.OK, runtime.store.list_fsbo_markets())
                    return

                if path == "/api/fsbo/scrape-status":
                    with _fsbo_scrape_lock:
                        self._send_json(HTTPStatus.OK, dict(_fsbo_scrape_state))
                    return

                if path == "/api/fsbo/listings":
                    data = runtime.store.list_fsbo_listings(
                        status=self._query_first(query, "status"),
                        min_score=int(self._query_first(query, "min_score", "0")) or None,
                        city=self._query_first(query, "city"),
                        state=self._query_first(query, "state"),
                        sort_by=self._query_first(query, "sort_by", "distress_score") or "distress_score",
                        limit=int(self._query_first(query, "limit", "200")),
                    )
                    self._send_json(HTTPStatus.OK, data)
                    return

                # ── Court Records (GET) ──────────────────────────────
                if path == "/api/court-records/stats":
                    self._send_json(HTTPStatus.OK, runtime.store.court_record_stats())
                    return

                if path == "/api/court-records/counties":
                    self._send_json(HTTPStatus.OK, runtime.store.list_court_record_counties())
                    return

                if path == "/api/court-records/cases":
                    data = runtime.store.list_court_record_cases(
                        status=self._query_first(query, "status"),
                        county_id=int(self._query_first(query, "county_id", "0")) or None,
                        limit=int(self._query_first(query, "limit", "200")),
                    )
                    self._send_json(HTTPStatus.OK, data)
                    return

                if path == "/api/court-records/scrape-status":
                    with _court_records_lock:
                        self._send_json(HTTPStatus.OK, dict(_court_records_state))
                    return

                # ── County Scouting (GET) ──────────────────────────────
                if path == "/api/counties/stats":
                    self._send_json(HTTPStatus.OK, runtime.store.county_scouting_stats())
                    return

                if path == "/api/counties":
                    data = runtime.store.list_counties(
                        state=self._query_first(query, "state"),
                        tier=self._query_first(query, "tier"),
                        scouted_only=self._query_first(query, "scouted_only") == "true",
                        limit=int(self._query_first(query, "limit", "100")),
                        offset=int(self._query_first(query, "offset", "0")),
                    )
                    self._send_json(HTTPStatus.OK, data)
                    return

                if path == "/api/counties/top":
                    limit = int(self._query_first(query, "limit", "50"))
                    data = runtime.store.get_harvest_queue(batch_size=limit, cooldown_days=0)
                    self._send_json(HTTPStatus.OK, data)
                    return

                if path == "/api/counties/scout-queue":
                    batch_size = int(self._query_first(query, "batch_size", "50"))
                    data = runtime.store.get_scout_queue(batch_size=batch_size)
                    self._send_json(HTTPStatus.OK, data)
                    return

                if path == "/api/counties/scout-status":
                    with _scout_lock:
                        current = dict(_scout_state)
                    if current["running"]:
                        self._send_json(HTTPStatus.OK, current)
                    else:
                        self._send_json(
                            HTTPStatus.OK,
                            _scout_status_from_job(runtime.store.get_latest_job("county_scout")),
                        )
                    return

                if path == "/api/distressed-properties":
                    data_file = runtime.root / "data" / "distressed-properties.json"
                    if data_file.exists():
                        import json as _json
                        props = _json.loads(data_file.read_text())
                        severity = (query.get("severity") or [None])[0]
                        city = (query.get("city") or [None])[0]
                        limit = int((query.get("limit") or ["300"])[0])
                        if severity:
                            props = [p for p in props if p["severity"] == int(severity)]
                        if city:
                            props = [p for p in props if p["source_city"] == city]
                        self._send_json(HTTPStatus.OK, {
                            "total": len(props),
                            "properties": props[:limit],
                            "cities": list(set(p["source_city"] for p in props)),
                        })
                    else:
                        self._send_json(HTTPStatus.OK, {"total": 0, "properties": [], "cities": []})
                    return

                if path == "/api/skip-trace/pipeline-status":
                    with _pipeline_lock:
                        state = dict(_pipeline_state)
                    with runtime.store._connect() as conn:
                        row = conn.execute("""
                            SELECT COUNT(*) as cnt FROM leads l
                            LEFT JOIN owner_phones op ON op.owner_id = l.owner_id
                            WHERE op.id IS NULL AND l.status NOT IN ('archived', 'dead')
                        """).fetchone()
                        state["leads_processing"] = row["cnt"] if row else 0
                    self._send_json(HTTPStatus.OK, state)
                    return

                # ── Evaluation (GET) ─────────────────────────────
                if path == "/api/evaluation/status":
                    with _eval_lock:
                        self._send_json(HTTPStatus.OK, dict(_eval_state))
                    return

                # ── Underwriting (GET) ───────────────────────────
                m = re.match(r"^/api/underwriting/report/([^/]+)$", path)
                if m:
                    report = runtime.store.get_underwriting_report(m.group(1))
                    if report:
                        lead = runtime.store.get_lead_detail(m.group(1))
                        report["lead"] = lead
                        self._send_json(HTTPStatus.OK, report)
                    else:
                        self._send_json(HTTPStatus.NOT_FOUND, {"error": "No underwriting report"})
                    return

                if path == "/api/underwriting/reports":
                    status_filter = self._query_first(query, "status")
                    data = runtime.store.list_underwriting_reports(status=status_filter)
                    self._send_json(HTTPStatus.OK, data)
                    return

                # ── KPI (GET) ────────────────────────────────────
                if path == "/api/kpi/funnel":
                    days = int(self._query_first(query, "days", "30"))
                    self._send_json(HTTPStatus.OK, runtime.store.get_conversion_funnel(days))
                    return

                if path == "/api/kpi/calls":
                    days = int(self._query_first(query, "days", "7"))
                    self._send_json(HTTPStatus.OK, runtime.store.get_call_metrics(days))
                    return

                if path == "/api/kpi/daily":
                    days = int(self._query_first(query, "days", "30"))
                    self._send_json(HTTPStatus.OK, runtime.store.get_daily_activity(days))
                    return

                if path == "/api/kpi/source-roi":
                    self._send_json(HTTPStatus.OK, runtime.store.get_source_roi())
                    return

                # ── Call Recordings (GET) ────────────────────────
                if path == "/api/call-recordings":
                    data = runtime.store.list_call_recordings(
                        search=self._query_first(query, "search"),
                        score=self._query_first(query, "score"),
                        motivation=self._query_first(query, "motivation"),
                        date_from=self._query_first(query, "date_from"),
                        date_to=self._query_first(query, "date_to"),
                        limit=int(self._query_first(query, "limit", "100")),
                        offset=int(self._query_first(query, "offset", "0")),
                    )
                    self._send_json(HTTPStatus.OK, data)
                    return

                if path == "/api/call-recordings/stats":
                    self._send_json(HTTPStatus.OK, runtime.store.call_recording_stats())
                    return

                m = re.match(r"^/api/call-recordings/(\d+)$", path)
                if m:
                    rec = runtime.store.get_call_recording(int(m.group(1)))
                    if rec:
                        self._send_json(HTTPStatus.OK, rec)
                    else:
                        self._send_json(HTTPStatus.NOT_FOUND, {"error": "Recording not found"})
                    return

                m = re.match(r"^/api/call-recordings/(\d+)/audio$", path)
                if m:
                    rec = runtime.store.get_call_recording(int(m.group(1)))
                    if not rec or not rec.get("file_path"):
                        self._send_json(HTTPStatus.NOT_FOUND, {"error": "No audio file"})
                        return
                    fp = Path(rec["file_path"])
                    if not fp.is_file():
                        self._send_json(HTTPStatus.NOT_FOUND, {"error": "File missing"})
                        return
                    ct = mimetypes.guess_type(str(fp))[0] or "application/octet-stream"
                    body = fp.read_bytes()
                    self.send_response(HTTPStatus.OK)
                    self.send_header("Content-Type", ct)
                    self.send_header("Content-Length", str(len(body)))
                    self._cors_headers()
                    self.end_headers()
                    self.wfile.write(body)
                    return

                # ── Static file serving (dashboard SPA) ───────────
                self._serve_static(path)

            def _serve_static(self, url_path: str) -> None:
                """Serve static files from the dashboard dist directory.

                Falls back to index.html for any path that doesn't match
                a real file (SPA client-side routing).
                """
                if not runtime.static_dir:
                    self._send_json(HTTPStatus.NOT_FOUND, {"error": "Not found"})
                    return

                # Sanitize path to prevent directory traversal
                clean = url_path.lstrip("/")
                if ".." in clean:
                    self._send_json(HTTPStatus.FORBIDDEN, {"error": "Forbidden"})
                    return

                file_path = runtime.static_dir / clean if clean else runtime.static_dir / "index.html"

                # If path is a directory or doesn't exist, serve index.html (SPA fallback)
                if file_path.is_dir() or not file_path.is_file():
                    file_path = runtime.static_dir / "index.html"

                if not file_path.is_file():
                    self._send_json(HTTPStatus.NOT_FOUND, {"error": "Not found"})
                    return

                # Security: ensure resolved path is within static_dir
                try:
                    file_path.resolve().relative_to(runtime.static_dir)
                except ValueError:
                    self._send_json(HTTPStatus.FORBIDDEN, {"error": "Forbidden"})
                    return

                ext = file_path.suffix.lower()
                content_type = STATIC_CONTENT_TYPES.get(ext, "application/octet-stream")
                try:
                    body = file_path.read_bytes()
                except OSError:
                    self._send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"error": "Read error"})
                    return

                self.send_response(HTTPStatus.OK)
                self.send_header("Content-Type", content_type)
                self.send_header("Content-Length", str(len(body)))
                # Cache static assets aggressively (hashed filenames), not index.html
                if "/assets/" in str(file_path):
                    self.send_header("Cache-Control", "public, max-age=31536000, immutable")
                else:
                    self.send_header("Cache-Control", "no-cache")
                self.end_headers()
                self.wfile.write(body)

            def do_POST(self) -> None:  # noqa: N802
                parsed = urlparse(self.path)
                path = parsed.path

                if path in {"/bridge/events", "/bridge/heartbeat"}:
                    payload = self._read_json()
                    export_csv_path = self.headers.get("X-Export-CSV-Path")
                    result = runtime.store.ingest_envelope(
                        payload,
                        export_csv_path=export_csv_path,
                    )
                    self._send_json(HTTPStatus.OK, result)
                    return
                if path == "/commands":
                    envelope = self._read_json()
                    result = runtime.store.enqueue_command(envelope)
                    self._send_json(HTTPStatus.OK, result)
                    return
                if path == "/discord/command":
                    payload = self._read_json()
                    result = runtime.store.handle_discord_command(
                        text=payload.get("text") or "",
                        guild_id=payload.get("guild_id"),
                        channel_id=payload.get("channel_id"),
                        thread_id=payload.get("thread_id"),
                        message_id=payload.get("message_id"),
                    )
                    self._send_json(HTTPStatus.OK, result)
                    return

                # ── Dashboard API (POST) ─────────────────────────────

                if path == "/api/leads/bulk-status":
                    body = self._read_json()
                    result = runtime.store.bulk_update_lead_status(
                        body.get("lead_ids", []),
                        body.get("status", ""),
                        body.get("reason"),
                    )
                    self._send_json(HTTPStatus.OK, result)
                    return

                m = re.match(r"^/api/leads/([^/]+)/status$", path)
                if m:
                    lead_id = m.group(1)
                    body = self._read_json()
                    new_status = body.get("status", "")
                    result = runtime.store.update_lead_status_api(
                        lead_id, new_status, body.get("reason"),
                    )
                    if new_status == "interested" and result.get("status") == "ok":
                        threading.Thread(
                            target=_run_underwriting_bg, args=(runtime, lead_id), daemon=True,
                        ).start()
                    self._send_json(HTTPStatus.OK, result)
                    return

                m = re.match(r"^/api/leads/([^/]+)/notes$", path)
                if m:
                    body = self._read_json()
                    result = runtime.store.add_lead_note(
                        m.group(1),
                        body.get("note_type", "general"),
                        body.get("content", ""),
                    )
                    self._send_json(HTTPStatus.OK, result)
                    return

                if path == "/api/pipeline/run":
                    result = _trigger_pipeline(runtime.root)
                    self._send_json(HTTPStatus.OK, result)
                    return

                if path == "/api/skip-trace/queue":
                    body = self._read_json()
                    result = _queue_skip_trace(
                        runtime,
                        lead_ids=body.get("lead_ids"),
                        source=body.get("source"),
                        limit=body.get("limit", 100),
                    )
                    self._send_json(HTTPStatus.OK, result)
                    return

                if path == "/api/skip-trace/ingest-csv":
                    body = self._read_json()
                    result = _ingest_propstream_csvs(runtime)
                    self._send_json(HTTPStatus.OK, result)
                    return

                if path == "/api/skip-trace/export-for-propstream":
                    body = self._read_json()
                    result = _export_for_propstream(
                        runtime,
                        source=body.get("source"),
                        limit=body.get("limit", 5000),
                    )
                    self._send_json(HTTPStatus.OK, result)
                    return

                if path == "/api/skip-trace/run-pipeline":
                    body = self._read_json()
                    result = _run_skip_trace_pipeline(
                        runtime,
                        source=body.get("source"),
                    )
                    self._send_json(HTTPStatus.OK, result)
                    return

                if path == "/api/verify-batch":
                    body = self._read_json()
                    result = _run_batch_verification(
                        runtime,
                        batch_id=body.get("batch_id"),
                    )
                    self._send_json(HTTPStatus.OK, result)
                    return

                if path == "/api/sources/code_violations/scrape":
                    body = self._read_json()
                    result = _trigger_scrape_and_ingest(
                        runtime,
                        portal_ids=body.get("portal_ids"),
                        days_back=body.get("days_back", 30),
                        limit=body.get("limit", 2000),
                    )
                    self._send_json(HTTPStatus.OK, result)
                    return

                if path == "/api/sources/code_violations/qualify":
                    result = _qualify_code_violation_leads(runtime)
                    self._send_json(HTTPStatus.OK, result)
                    return

                if path == "/api/follow-ups":
                    body = self._read_json()
                    result = runtime.store.create_follow_up(
                        body["lead_id"],
                        body.get("follow_up_type", "callback"),
                        body["scheduled_at"],
                        body.get("notes"),
                    )
                    self._send_json(HTTPStatus.OK, result)
                    return

                m = re.match(r"^/api/follow-ups/(\d+)/complete$", path)
                if m:
                    body = self._read_json()
                    result = runtime.store.complete_follow_up(
                        int(m.group(1)),
                        body.get("outcome", "completed"),
                    )
                    self._send_json(HTTPStatus.OK, result)
                    return

                # ── Social / Bandit (POST) ───────────────────────────

                if path == "/api/social-bandit/campaigns":
                    body = self._read_json()
                    result = runtime.store.create_social_campaign(
                        platform=body.get("platform", "facebook"),
                        campaign_name=body.get("campaign_name", ""),
                        post_url=body.get("post_url", ""),
                        post_type=body.get("post_type", "own_ad"),
                        target_market=body.get("target_market", ""),
                    )
                    self._send_json(HTTPStatus.OK, result)
                    return

                m = re.match(r"^/api/social-bandit/campaigns/(\d+)/scrape$", path)
                if m:
                    campaign_id = int(m.group(1))
                    # Scraping is manual — this endpoint is a stub for future automation
                    self._send_json(HTTPStatus.OK, {
                        "status": "ok",
                        "message": "Use the import endpoint or browser extension to add comments",
                        "campaign_id": campaign_id,
                        "new_comments": 0,
                    })
                    return

                m = re.match(r"^/api/social-bandit/campaigns/(\d+)/toggle$", path)
                if m:
                    body = self._read_json()
                    result = runtime.store.toggle_social_campaign(
                        int(m.group(1)), body.get("active", True),
                    )
                    self._send_json(HTTPStatus.OK, result)
                    return

                m = re.match(r"^/api/social-bandit/comments/(\d+)/classify$", path)
                if m:
                    body = self._read_json()
                    result = runtime.store.classify_social_comment(
                        int(m.group(1)),
                        body.get("status", "new"),
                        body.get("notes"),
                    )
                    self._send_json(HTTPStatus.OK, result)
                    return

                m = re.match(r"^/api/social-bandit/comments/(\d+)/extract$", path)
                if m:
                    body = self._read_json()
                    result = runtime.store.extract_social_comment(
                        int(m.group(1)), body,
                    )
                    self._send_json(HTTPStatus.OK, result)
                    return

                if path == "/api/social-bandit/comments/ingest":
                    body = self._read_json()
                    result = runtime.store.ingest_social_comments(
                        body.get("comment_ids", []),
                    )
                    self._send_json(HTTPStatus.OK, result)
                    return

                if path == "/api/social-bandit/comments/bulk-classify":
                    body = self._read_json()
                    result = runtime.store.bulk_classify_social_comments(
                        body.get("comment_ids", []),
                        body.get("status", "junk"),
                    )
                    self._send_json(HTTPStatus.OK, result)
                    return

                if path == "/api/social-bandit/import":
                    body = self._read_json()
                    result = runtime.store.import_social_comments(
                        platform=body.get("platform", "facebook"),
                        post_url=body.get("post_url", ""),
                        post_type=body.get("post_type", "own_ad"),
                        target_market=body.get("target_market", ""),
                        comments=body.get("comments", []),
                    )
                    self._send_json(HTTPStatus.OK, result)
                    return

                # ── Water Shutoffs (POST) ────────────────────────────

                if path == "/api/water-shutoffs/requests":
                    body = self._read_json()
                    result = runtime.store.create_foia_request(
                        city=body.get("city", ""),
                        state=body.get("state", ""),
                        agency_name=body.get("agency_name", ""),
                        agency_contact=body.get("agency_contact"),
                        submission_method=body.get("submission_method", "email"),
                        notes=body.get("notes"),
                    )
                    self._send_json(HTTPStatus.OK, result)
                    return

                m = re.match(r"^/api/water-shutoffs/requests/(\d+)$", path)
                if m:
                    body = self._read_json()
                    result = runtime.store.update_foia_request(int(m.group(1)), body)
                    self._send_json(HTTPStatus.OK, result)
                    return

                m = re.match(r"^/api/water-shutoffs/requests/(\d+)/letter$", path)
                if m:
                    result = runtime.store.generate_foia_letter(int(m.group(1)))
                    self._send_json(HTTPStatus.OK, result)
                    return

                if path == "/api/water-shutoffs/import":
                    body = self._read_json()
                    result = runtime.store.import_water_shutoff_records(
                        foia_request_id=body.get("foia_request_id"),
                        records=body.get("records", []),
                        city=body.get("city"),
                        state=body.get("state"),
                    )
                    self._send_json(HTTPStatus.OK, result)
                    return

                if path == "/api/water-shutoffs/ingest":
                    body = self._read_json()
                    result = runtime.store.ingest_water_shutoff_to_staging(
                        body.get("record_ids", []),
                    )
                    self._send_json(HTTPStatus.OK, result)
                    return

                # ── FSBOs (POST) ─────────────────────────────────────

                if path == "/api/fsbo/markets":
                    body = self._read_json()
                    result = runtime.store.upsert_fsbo_market(
                        metro=body.get("metro", ""),
                        state=body.get("state", ""),
                        median_price=body.get("median_price"),
                        zillow_search_url=body.get("zillow_search_url"),
                    )
                    self._send_json(HTTPStatus.OK, result)
                    return

                m = re.match(r"^/api/fsbo/markets/(\d+)/toggle$", path)
                if m:
                    body = self._read_json()
                    result = runtime.store.toggle_fsbo_market(
                        int(m.group(1)), body.get("active", True),
                    )
                    self._send_json(HTTPStatus.OK, result)
                    return

                if path == "/api/fsbo/scrape":
                    body = self._read_json()
                    result = _start_fsbo_scrape(runtime, body)
                    self._send_json(HTTPStatus.OK, result)
                    return

                if path == "/api/fsbo/auto-ingest":
                    result = runtime.store.auto_ingest_fsbo()
                    self._send_json(HTTPStatus.OK, result)
                    return

                if path == "/api/fsbo/import":
                    body = self._read_json()
                    result = runtime.store.import_fsbo_listings(
                        listings=body.get("listings", []),
                        market_metro=body.get("market_metro"),
                        market_state=body.get("market_state"),
                    )
                    self._send_json(HTTPStatus.OK, result)
                    return

                m = re.match(r"^/api/fsbo/listings/(\d+)/classify$", path)
                if m:
                    body = self._read_json()
                    result = runtime.store.classify_fsbo_listing(
                        int(m.group(1)),
                        body.get("status", "new"),
                        body.get("notes"),
                    )
                    self._send_json(HTTPStatus.OK, result)
                    return

                if path == "/api/fsbo/listings/bulk-classify":
                    body = self._read_json()
                    result = runtime.store.bulk_classify_fsbo_listings(
                        body.get("listing_ids", []),
                        body.get("status", "junk"),
                    )
                    self._send_json(HTTPStatus.OK, result)
                    return

                if path == "/api/fsbo/ingest":
                    body = self._read_json()
                    result = runtime.store.ingest_fsbo_listings(
                        body.get("listing_ids", []),
                    )
                    self._send_json(HTTPStatus.OK, result)
                    return

                # ── Court Records (POST) ──────────────────────────────
                if path == "/api/court-records/counties":
                    body = self._read_json()
                    result = runtime.store.upsert_court_record_county(
                        body["county"], body.get("state", "MO"), body["court_id"],
                        appraiser_url=body.get("appraiser_url"),
                        appraiser_type=body.get("appraiser_type"),
                    )
                    self._send_json(HTTPStatus.OK, result)
                    return

                m = re.match(r"^/api/court-records/counties/(\d+)/toggle$", path)
                if m:
                    body = self._read_json()
                    result = runtime.store.toggle_court_record_county(
                        int(m.group(1)), body.get("active", True),
                    )
                    self._send_json(HTTPStatus.OK, result)
                    return

                if path == "/api/court-records/scrape":
                    body = self._read_json()
                    result = _start_court_records_scrape(runtime, body)
                    self._send_json(HTTPStatus.OK, result)
                    return

                if path == "/api/court-records/import":
                    body = self._read_json()
                    result = runtime.store.import_court_record_cases(
                        body.get("cases", []),
                        county_id=body.get("county_id"),
                    )
                    self._send_json(HTTPStatus.OK, result)
                    return

                m = re.match(r"^/api/court-records/cases/(\d+)/classify$", path)
                if m:
                    body = self._read_json()
                    result = runtime.store.classify_court_record_case(
                        int(m.group(1)), body.get("status", "new"),
                    )
                    self._send_json(HTTPStatus.OK, result)
                    return

                if path == "/api/court-records/cases/bulk-classify":
                    body = self._read_json()
                    result = runtime.store.bulk_classify_court_record_cases(
                        body.get("case_ids", []), body.get("status", "junk"),
                    )
                    self._send_json(HTTPStatus.OK, result)
                    return

                if path == "/api/court-records/ingest":
                    body = self._read_json()
                    result = runtime.store.ingest_court_records_to_staging(
                        body.get("case_ids", []),
                    )
                    self._send_json(HTTPStatus.OK, result)
                    return

                # ── County Scouting (POST) ──────────────────────────────
                if path == "/api/counties/seed":
                    body = self._read_json()
                    counties = body.get("counties", [])
                    if not counties:
                        import json as _json
                        seed_path = Path(__file__).parent.parent / "lead_engine" / "data" / "us_counties.json"
                        if seed_path.exists():
                            counties = _json.loads(seed_path.read_text())
                    result = runtime.store.seed_counties(counties)
                    self._send_json(HTTPStatus.OK, result)
                    return

                if path == "/api/counties/import-scout-results":
                    body = self._read_json()
                    updated = runtime.store.import_scout_results(body.get("results", []))
                    self._send_json(HTTPStatus.OK, {"updated": updated})
                    return

                if path == "/api/counties/scout":
                    body = self._read_json()
                    batch_size = body.get("batch_size", 50)
                    queue = runtime.store.get_scout_queue(batch_size=batch_size)
                    if not queue:
                        self._send_json(HTTPStatus.OK, {"status": "no_counties_to_scout"})
                        return
                    batch_data = [{"fips": c["fips"], "search_term": c["search_term"]} for c in queue]
                    batch_path = Path(runtime.store.data_dir) / "scout-batch.json"
                    batch_path.write_text(json.dumps(batch_data, indent=2))
                    _start_scout_pipeline(runtime, str(batch_path))
                    self._send_json(HTTPStatus.OK, {
                        "status": "started",
                        "counties": len(batch_data),
                        "batch_path": str(batch_path),
                    })
                    return

                if path == "/api/counties/harvest":
                    body = self._read_json()
                    batch_size = body.get("batch_size", 10)
                    signal = body.get("signal", "pre_foreclosure")
                    queue = runtime.store.get_harvest_queue(batch_size=batch_size)
                    if not queue:
                        self._send_json(HTTPStatus.OK, {"status": "no_counties_to_harvest"})
                        return
                    county_names = "|".join(c["search_term"] for c in queue)
                    _start_harvest_pipeline(runtime, signal, county_names, queue)
                    self._send_json(HTTPStatus.OK, {
                        "status": "started",
                        "counties": len(queue),
                        "signal": signal,
                    })
                    return

                # ── Evaluation (POST) ────────────────────────────
                if path == "/api/evaluation/run":
                    result = _start_evaluation(runtime)
                    self._send_json(HTTPStatus.OK, result)
                    return

                # ── Underwriting (POST) ──────────────────────────
                m = re.match(r"^/api/underwriting/run/([^/]+)$", path)
                if m:
                    result = _start_underwriting(runtime, m.group(1))
                    self._send_json(HTTPStatus.OK, result)
                    return

                m = re.match(r"^/api/underwriting/refresh/([^/]+)$", path)
                if m:
                    result = _start_underwriting(runtime, m.group(1), refresh=True)
                    self._send_json(HTTPStatus.OK, result)
                    return

                # ── Call Recordings (POST) ───────────────────────

                if path == "/api/call-recordings":
                    content_type = self.headers.get("Content-Type", "")
                    if "multipart/form-data" in content_type:
                        result = _handle_recording_upload(self, runtime)
                        self._send_json(HTTPStatus.OK, result)
                    else:
                        body = self._read_json()
                        result = runtime.store.create_call_recording(body)
                        self._send_json(HTTPStatus.OK, result)
                    return

                m = re.match(r"^/api/call-recordings/(\d+)$", path)
                if m:
                    body = self._read_json()
                    result = runtime.store.update_call_recording(int(m.group(1)), body)
                    self._send_json(HTTPStatus.OK, result)
                    return

                m = re.match(r"^/api/call-recordings/(\d+)/delete$", path)
                if m:
                    result = runtime.store.delete_call_recording(int(m.group(1)))
                    self._send_json(HTTPStatus.OK, result)
                    return

                m = re.match(r"^/api/call-recordings/(\d+)/transcribe$", path)
                if m:
                    rec_id = int(m.group(1))
                    rec = runtime.store.get_call_recording(rec_id)
                    if not rec:
                        self._send_json(HTTPStatus.NOT_FOUND, {"error": "Recording not found"})
                        return
                    def _bg_transcribe():
                        _transcribe_and_grade(runtime, rec_id)
                    threading.Thread(target=_bg_transcribe, daemon=True).start()
                    self._send_json(HTTPStatus.OK, {"status": "started", "id": rec_id})
                    return

                m = re.match(r"^/api/call-recordings/(\d+)/grade$", path)
                if m:
                    rec_id = int(m.group(1))
                    rec = runtime.store.get_call_recording(rec_id)
                    if not rec or not rec.get("transcript"):
                        self._send_json(HTTPStatus.BAD_REQUEST, {"error": "No transcript to grade"})
                        return
                    def _bg_grade():
                        _grade_recording(runtime, rec_id, rec["transcript"])
                    threading.Thread(target=_bg_grade, daemon=True).start()
                    self._send_json(HTTPStatus.OK, {"status": "started", "id": rec_id})
                    return

                self._send_json(HTTPStatus.NOT_FOUND, {"error": "Not found"})

        return ThreadingHTTPServer((host, port), Handler)

    def serve_forever(self, host: str = "127.0.0.1", port: int = 8765) -> None:
        server = self.create_server(host=host, port=port)
        print(f"Hermes listening on {host}:{port}")

        # On startup, check for phoneless leads and auto-trigger pipeline
        def _startup_check():
            import time
            time.sleep(5)
            pending = runtime.store.pending_verification_stats()
            if pending["total_pending"] > 0:
                print(f"[startup] {pending['total_pending']} addresses pending PropStream verification")

        threading.Thread(target=_startup_check, daemon=True).start()

        try:
            server.serve_forever()
        finally:
            server.server_close()


def _trigger_pipeline(root: Path) -> dict[str, Any]:
    try:
        result = subprocess.run(
            [sys.executable, "-m", "lead_engine", "scan"],
            capture_output=True,
            text=True,
            timeout=120,
            cwd=root,
        )
        return {
            "status": "ok" if result.returncode == 0 else "error",
            "returncode": result.returncode,
            "stdout": result.stdout[-2000:] if result.stdout else "",
            "stderr": result.stderr[-1000:] if result.stderr else "",
        }
    except subprocess.TimeoutExpired:
        return {"status": "error", "message": "Pipeline timed out after 120s"}
    except Exception as e:
        return {"status": "error", "message": str(e)}


def _queue_skip_trace(
    runtime: HermesRuntime,
    lead_ids: list[str] | None = None,
    source: str | None = None,
    limit: int = 100,
) -> dict[str, Any]:
    """Queue leads without phones for PropStream skip trace via HARVEST commands.

    Groups leads by zip code and enqueues one HARVEST command per zip.
    Each HARVEST command tells the PropStream runner to run the full chain:
    SEARCH (by zip) -> SAVE (to list) -> SKIP_TRACE (the list) -> EXPORT (CSV with phones).
    Results flow back through ingest_envelope as result events.
    """
    try:
        with runtime.store._connect() as conn:
            if lead_ids:
                placeholders = ",".join("?" for _ in lead_ids)
                rows = conn.execute(
                    f"""
                    SELECT l.lead_id, p.address_full, p.address_street,
                           p.address_city, p.address_state, p.address_zip,
                           o.owner_name
                    FROM leads l
                    JOIN properties p ON p.property_id = l.property_id
                    JOIN owners o ON o.owner_id = l.owner_id
                    WHERE l.lead_id IN ({placeholders})
                    """,
                    lead_ids,
                ).fetchall()
            else:
                rows = conn.execute(
                    """
                    SELECT l.lead_id, p.address_full, p.address_street,
                           p.address_city, p.address_state, p.address_zip,
                           o.owner_name
                    FROM leads l
                    JOIN properties p ON p.property_id = l.property_id
                    JOIN owners o ON o.owner_id = l.owner_id
                    WHERE NOT EXISTS (
                        SELECT 1 FROM owner_phones op WHERE op.owner_id = l.owner_id
                    )
                    AND l.status NOT IN ('archived', 'dead')
                    LIMIT ?
                    """,
                    (limit,),
                ).fetchall()

            leads = [dict(r) for r in rows]

        if not leads:
            return {"status": "ok", "queued": 0, "message": "No leads need skip trace"}

        import uuid
        from collections import defaultdict

        by_zip: dict[str, list[dict]] = defaultdict(list)
        skipped = 0
        for lead in leads:
            zip_code = (lead.get("address_zip") or "").strip()[:5]
            if not zip_code or not zip_code.isdigit():
                skipped += 1
                continue
            by_zip[zip_code].append(lead)

        command_ids = []
        for zip_code, zip_leads in by_zip.items():
            list_name = f"harvest-{source or 'all'}-{zip_code}-{datetime.now().strftime('%Y%m%d')}"
            command = {
                "type": "command",
                "message_id": f"hv-{zip_code}-{uuid.uuid4().hex[:8]}",
                "envelope_version": "1.0",
                "source": "swarm",
                "lane": "houses",
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "correlation_id": None,
                "payload": {
                    "command_type": "HARVEST",
                    "zip": zip_code,
                    "list_name": list_name,
                    "max_results": min(len(zip_leads) * 3, 500),
                    "max_skip_traces": min(len(zip_leads) * 3, 500),
                    "filters": {},
                },
            }
            runtime.store.enqueue_command(command)
            command_ids.append(command["message_id"])

        return {
            "status": "ok",
            "queued": len(leads) - skipped,
            "skipped_no_zip": skipped,
            "zip_groups": len(by_zip),
            "command_ids": command_ids,
            "note": f"Queued {len(by_zip)} HARVEST commands by zip code. "
                    "Each runs the full chain: SEARCH -> SAVE -> SKIP_TRACE -> EXPORT. "
                    "Make sure the PropStream runner is active.",
        }

    except Exception as e:
        return {"status": "error", "message": str(e)}


def _trigger_scrape_and_ingest(
    runtime: HermesRuntime,
    portal_ids: list[str] | None = None,
    days_back: int = 30,
    limit: int = 2000,
) -> dict[str, Any]:
    """Code violations scrape → stage for PropStream verification.

    1. Scrape portals for code violations
    2. Dedup against existing leads — stack code_violation signal on matches
    3. Stage NEW addresses into pending_verification table
    4. Addresses verified via nightly batch (POST /api/verify-batch)
    """
    try:
        from lead_engine.sources.scrapers import scrape_all_portals
        import csv as csv_mod
        import uuid

        results = scrape_all_portals(
            days_back=days_back,
            limit=limit,
            portal_ids=portal_ids,
        )

        total_scraped = 0
        total_new = 0
        total_stacked = 0
        total_deduped = 0

        for r in results:
            if r.get("status") != "ok" or not r.get("csv_path"):
                continue
            csv_path = Path(r["csv_path"])
            if not csv_path.exists():
                continue

            harvest_dir = Path(r["harvest_dir"])
            manifest_path = harvest_dir / "manifest.json"
            with open(manifest_path) as f:
                manifest = json.load(f)

            with open(csv_path, "r") as f:
                reader = csv_mod.DictReader(f)
                all_rows = list(reader)

            total_scraped += len(all_rows)
            new_items = []

            with runtime.store._connect() as conn:
                for row in all_rows:
                    addr_street = (row.get("address_street") or "").strip()
                    city = (row.get("city") or "").strip()
                    state = (row.get("state") or "").strip()
                    zipcode = (row.get("zip") or "").strip()
                    if not addr_street or not city:
                        continue

                    street_norm = _normalize_address(addr_street)
                    city_norm = city.replace(" ", "").lower()

                    existing = conn.execute(
                        """
                        SELECT l.lead_id, l.distress_signals_json, p.address_street
                        FROM leads l
                        JOIN properties p ON p.property_id = l.property_id
                        WHERE LOWER(REPLACE(p.address_city, ' ', '')) = ?
                          AND l.status NOT IN ('archived', 'dead')
                          AND LOWER(REPLACE(p.address_street, ' ', '')) LIKE ?
                        """,
                        (city_norm, f"%{addr_street.split()[0].lower()}%" if addr_street.split() else "%"),
                    ).fetchall()
                    matched = None
                    for candidate in existing:
                        if _normalize_address(candidate["address_street"]) == street_norm:
                            matched = candidate
                            break
                    existing = matched

                    if existing:
                        signals = []
                        try:
                            signals = json.loads(existing["distress_signals_json"] or "[]")
                        except (json.JSONDecodeError, TypeError):
                            pass
                        if "code_violation" not in signals:
                            signals.append("code_violation")
                            conn.execute(
                                "UPDATE leads SET distress_signals_json = ?, updated_at = ? WHERE lead_id = ?",
                                (json.dumps(signals), datetime.now(timezone.utc).isoformat(), existing["lead_id"]),
                            )
                            total_stacked += 1
                        else:
                            total_deduped += 1
                        continue

                    full = ", ".join(p for p in [addr_street, city, state, zipcode] if p)
                    new_items.append({
                        "property_id": full,
                        "address_full": full,
                        "address_street": addr_street,
                        "address_city": city,
                        "address_state": state,
                        "address_zip": zipcode,
                        "parcel_number": (row.get("parcel") or "").strip(),
                        "owner_name": "",
                        "latitude": row.get("latitude"),
                        "longitude": row.get("longitude"),
                        "distress_signals": ["code_violation"],
                        "source": "code_violations",
                    })

            if new_items:
                batch_id = f"cv-{r['portal']}-{uuid.uuid4().hex[:8]}"
                addresses = [
                    {
                        "address_street": item["address_street"],
                        "address_city": item["address_city"],
                        "address_state": item.get("address_state", ""),
                        "address_zip": item.get("address_zip", ""),
                        "owner_name": item.get("owner_name", ""),
                        "source_ref": item.get("parcel_number", ""),
                    }
                    for item in new_items
                ]
                runtime.store.stage_for_verification("code_violations", addresses, batch_id)
                total_new += len(new_items)

            runtime.store.update_source_run(
                "code_violations",
                status="success",
                count=r.get("count", 0),
            )

        ok_portals = [r for r in results if r.get("status") == "ok"]
        return {
            "status": "ok",
            "portals_scraped": len(ok_portals),
            "portals_total": len(results),
            "total_scraped": total_scraped,
            "new_leads": total_new,
            "stacked_on_existing": total_stacked,
            "deduped": total_deduped,
            "details": results,
        }
    except Exception as e:
        return {"status": "error", "message": str(e)}


def _qualify_code_violation_leads(runtime: HermesRuntime) -> dict[str, Any]:
    """Post-enrichment qualifier for code_violation leads.

    Keeps leads that have phone numbers. code_violation itself is a strong
    distress signal — requiring an additional stacking signal caused 90%+ of
    CV leads to be archived before PropStream data could merge in.

    Leads with stacked signals (pre_foreclosure, probate, tax_lien) are
    prioritized via motivation_score but NOT required for qualification.
    Property type filter relaxed: unknown/empty types pass (municipal APIs
    rarely provide property type).
    """
    STACKING_SIGNALS = {"pre_foreclosure", "probate", "tax_lien"}
    NON_RESIDENTIAL = {"commercial", "industrial", "apartment", "condo", "multi-family"}

    archived_non_residential = 0
    archived_no_phone = 0
    queued_with_stack = 0
    queued_cv_only = 0
    ts = datetime.now(timezone.utc).isoformat()

    with runtime.store._connect() as conn:
        rows = conn.execute("""
            SELECT l.lead_id, l.distress_signals_json, p.property_type,
                   (SELECT COUNT(*) FROM owner_phones op WHERE op.owner_id = l.owner_id) as phone_count
            FROM leads l
            JOIN properties p ON p.property_id = l.property_id
            WHERE l.source = 'code_violations'
              AND l.status NOT IN ('archived', 'dead')
        """).fetchall()

        for row in rows:
            prop_type = (row["property_type"] or "").strip().lower()
            is_non_residential = any(p in prop_type for p in NON_RESIDENTIAL)

            signals = []
            try:
                signals = json.loads(row["distress_signals_json"] or "[]")
            except (json.JSONDecodeError, TypeError):
                pass
            has_stack = bool(set(signals) & STACKING_SIGNALS)

            if is_non_residential:
                conn.execute(
                    "UPDATE leads SET status = 'archived', updated_at = ? WHERE lead_id = ?",
                    (ts, row["lead_id"]),
                )
                archived_non_residential += 1
            elif row["phone_count"] == 0:
                conn.execute(
                    "UPDATE leads SET status = 'archived', updated_at = ? WHERE lead_id = ?",
                    (ts, row["lead_id"]),
                )
                archived_no_phone += 1
            else:
                conn.execute(
                    "UPDATE leads SET status = 'queued', updated_at = ? WHERE lead_id = ?",
                    (ts, row["lead_id"]),
                )
                if has_stack:
                    queued_with_stack += 1
                else:
                    queued_cv_only += 1

    return {
        "status": "ok",
        "total_reviewed": archived_non_residential + archived_no_phone + queued_with_stack + queued_cv_only,
        "kept": queued_with_stack + queued_cv_only,
        "queued_with_stacked_signal": queued_with_stack,
        "queued_code_violation_only": queued_cv_only,
        "archived_non_residential": archived_non_residential,
        "archived_no_phone": archived_no_phone,
    }


def _get_markets(runtime: HermesRuntime) -> dict[str, Any]:
    try:
        from lead_engine.markets import get_ranked_markets
        markets = get_ranked_markets()

        stats = runtime.store.get_pipeline_stats()
        by_source = stats.get("by_source", {})

        for m in markets:
            m["lead_count"] = 0
        if by_source:
            with runtime.store._connect() as conn:
                rows = conn.execute(
                    """
                    SELECT p.address_state, COUNT(*) as cnt
                    FROM leads l
                    JOIN properties p ON p.property_id = l.property_id
                    WHERE l.status NOT IN ('archived', 'dead')
                    GROUP BY p.address_state
                    """
                ).fetchall()
                state_counts = {r["address_state"]: r["cnt"] for r in rows}
            for m in markets:
                m["lead_count"] = state_counts.get(m["state"], 0)

        return {"status": "ok", "markets": markets}
    except Exception as e:
        return {"status": "error", "message": str(e)}


def _export_for_propstream(
    runtime: HermesRuntime,
    source: str | None = None,
    limit: int = 5000,
) -> dict[str, Any]:
    """Export leads without phones as a CSV file ready for PropStream upload.

    Creates a CSV in the PropStream upload format (Address, City, State, Zip)
    that can be directly uploaded to PropStream for skip tracing.
    When source is None, exports leads from ALL sources.
    """
    import csv as csv_mod
    import io

    try:
        with runtime.store._connect() as conn:
            if source:
                rows = conn.execute(
                    """
                    SELECT DISTINCT
                        p.address_street, p.address_city, p.address_state, p.address_zip
                    FROM leads l
                    JOIN properties p ON p.property_id = l.property_id
                    LEFT JOIN owner_phones op ON op.owner_id = l.owner_id
                    WHERE l.source = ?
                    AND op.id IS NULL
                    AND l.status NOT IN ('archived', 'dead')
                    AND p.address_street IS NOT NULL
                    AND p.address_street != ''
                    LIMIT ?
                    """,
                    (source, limit),
                ).fetchall()
            else:
                rows = conn.execute(
                    """
                    SELECT DISTINCT
                        p.address_street, p.address_city, p.address_state, p.address_zip
                    FROM leads l
                    JOIN properties p ON p.property_id = l.property_id
                    LEFT JOIN owner_phones op ON op.owner_id = l.owner_id
                    WHERE op.id IS NULL
                    AND l.status NOT IN ('archived', 'dead')
                    AND p.address_street IS NOT NULL
                    AND p.address_street != ''
                    LIMIT ?
                    """,
                    (limit,),
                ).fetchall()

        if not rows:
            return {"status": "ok", "message": "No leads need skip trace", "count": 0}

        output = io.StringIO()
        writer = csv_mod.writer(output)
        writer.writerow(["Address", "City", "State", "Zip"])
        for r in rows:
            writer.writerow([
                r["address_street"] or "",
                r["address_city"] or "",
                r["address_state"] or "",
                r["address_zip"] or "",
            ])

        csv_content = output.getvalue()
        export_dir = runtime.root / "data" / "exports"
        export_dir.mkdir(parents=True, exist_ok=True)
        label = source or "all"
        export_path = export_dir / f"skip-trace-upload-{label}-{datetime.now().strftime('%Y%m%d-%H%M%S')}.csv"
        export_path.write_text(csv_content, encoding="utf-8")

        return {
            "status": "ok",
            "count": len(rows),
            "csv_path": str(export_path),
            "message": (
                f"Exported {len(rows)} addresses to {export_path}. "
                "Upload this CSV to PropStream: Marketing Lists > Import List > Upload CSV. "
                "Then skip trace the list and export with phone numbers. "
                "Finally, place the exported CSV in lead-vault/acquisition/propstream/ "
                "and click 'Ingest PropStream CSVs' to import the phone numbers."
            ),
        }
    except Exception as e:
        return {"status": "error", "message": str(e)}


def _ingest_propstream_csvs(runtime: HermesRuntime) -> dict[str, Any]:
    """Scan existing PropStream CSV exports and ingest them as EXPORT events.

    This finds all CSV files in the lead-vault/acquisition/propstream directory,
    parses their phone/owner data, and feeds them through the ingest pipeline
    so they can be matched to existing leads (especially code violation leads)
    via address-based matching.
    """
    import csv as csv_mod
    import uuid

    csv_files: list[Path] = []
    propstream_root = runtime.root.parent / "lead-vault" / "acquisition" / "propstream"
    if propstream_root.is_dir():
        csv_files.extend(propstream_root.rglob("*.csv"))
    skip_trace_root = runtime.root.parent / "lead-vault" / "acquisition" / "skip-trace-results"
    if skip_trace_root.is_dir():
        csv_files.extend(skip_trace_root.rglob("*.csv"))
    if not csv_files:
        return {"status": "ok", "message": "No CSV files found in propstream/ or skip-trace-results/", "ingested": 0}

    total_rows = 0
    total_matched = 0
    files_processed = 0

    for csv_path in csv_files:
        try:
            with open(csv_path, "r", errors="replace") as f:
                reader = csv_mod.DictReader(f)
                items = []
                for row in reader:
                    addr_street = (row.get("Address") or "").strip()
                    city = (row.get("City") or "").strip()
                    state = (row.get("State") or "").strip()
                    zipcode = (row.get("Zip") or "").strip()[:5]
                    if not addr_street or not city:
                        continue

                    full = ", ".join(p for p in [addr_street, city, state, zipcode] if p)
                    owner1_first = (row.get("Owner 1 First Name") or "").strip()
                    owner1_last = (row.get("Owner 1 Last Name") or "").strip()
                    owner_name = f"{owner1_first} {owner1_last}".strip()

                    phones = []
                    for i in range(1, 6):
                        phone = (row.get(f"Phone {i}") or "").strip()
                        ptype = (row.get(f"Phone {i} Type") or "").strip()
                        dnc = (row.get(f"Phone {i} DNC") or "").strip()
                        if phone and len(phone) >= 10:
                            phones.append({
                                "value": phone,
                                "type": ptype.lower() if ptype else "unknown",
                                "dnc": dnc.lower() in ("yes", "true", "1", "y"),
                            })

                    emails = []
                    for i in range(1, 5):
                        email = (row.get(f"Email {i}") or "").strip()
                        if email and "@" in email:
                            emails.append(email)

                    item: dict[str, Any] = {
                        "property_id": full,
                        "address_full": full,
                        "address_street": addr_street,
                        "address_city": city,
                        "address_state": state,
                        "address_zip": zipcode,
                        "owner_name": owner_name,
                        "mailing_address": (row.get("Mailing Address") or "").strip(),
                        "phone_numbers": phones,
                        "email_addresses": emails,
                        "parcel_number": (row.get("APN") or "").strip(),
                        "property_type": (row.get("Property Type") or "").strip(),
                        "bedrooms": row.get("Bedrooms"),
                        "bathrooms": row.get("Total Bathrooms"),
                        "square_feet": row.get("Building Sqft"),
                        "lot_size_sqft": row.get("Lot Size Sqft"),
                        "year_built": row.get("Effective Year Built"),
                        "source": "propstream",
                        "lead_lifecycle_state": "imported",
                        "distress_signals": [],
                    }

                    # Parse distress signals from PropStream data
                    ps_signals: list[str] = []
                    foreclosure = (row.get("Foreclosure Factor") or "").strip().lower()
                    if foreclosure in ("very high", "high"):
                        ps_signals.append("pre_foreclosure")
                    lien_raw = (row.get("Lien Amount") or "").replace(",", "").replace("$", "").strip()
                    if lien_raw:
                        try:
                            if float(lien_raw) > 0:
                                ps_signals.append("tax_lien")
                        except (ValueError, TypeError):
                            pass
                    condition = (row.get("Total Condition") or "").strip().lower()
                    if condition in ("poor", "unsound"):
                        ps_signals.append("poor_condition")
                    ltv_raw = (row.get("Est. Loan-to-Value") or "").replace("%", "").replace(",", "").strip()
                    if ltv_raw:
                        try:
                            if float(ltv_raw) > 90:
                                ps_signals.append("underwater")
                        except (ValueError, TypeError):
                            pass
                    item["distress_signals"] = ps_signals

                    # Parse numeric fields
                    for key in ("bedrooms", "bathrooms", "square_feet", "lot_size_sqft", "year_built"):
                        val = item.get(key)
                        if val:
                            try:
                                item[key] = int(str(val).replace(",", "").split(".")[0])
                            except (ValueError, TypeError):
                                item[key] = None

                    est_value = (row.get("Est. Value") or "").replace(",", "").replace("$", "").strip()
                    if est_value:
                        try:
                            item["arv_estimate"] = int(float(est_value))
                        except (ValueError, TypeError):
                            pass

                    items.append(item)
                    total_rows += 1

            if not items:
                continue

            list_name = csv_path.parent.parent.name + " / " + csv_path.stem
            envelope = {
                "message_id": f"csv-ingest-{uuid.uuid4().hex[:8]}",
                "type": "event",
                "lane": "houses",
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "payload": {
                    "command_type": "EXPORT",
                    "status": "success",
                    "items": items,
                    "source_type": "propstream",
                    "list_name": list_name,
                    "record_count": len(items),
                },
            }
            runtime.store.ingest_envelope(envelope)
            files_processed += 1

            with runtime.store._connect() as conn:
                conn.execute(
                    "UPDATE leads SET propstream_verified = 1, propstream_verified_at = ? "
                    "WHERE source = 'propstream' AND propstream_verified != 1",
                    (datetime.now(timezone.utc).isoformat(),),
                )

        except Exception as e:
            continue

    # Merge PropStream distress signals onto matching code_violation leads
    cv_signals_merged = 0
    cv_phones_merged = 0
    with runtime.store._connect() as conn:
        cv_rows = conn.execute("""
            SELECT cv.lead_id, cv.owner_id, cv.distress_signals_json,
                   p.address_street, p.address_city, p.address_state
            FROM leads cv
            JOIN properties p ON p.property_id = cv.property_id
            WHERE cv.source = 'code_violations'
        """).fetchall()

        ps_index: dict[str, list] = {}
        ps_all = conn.execute("""
            SELECT ps.lead_id, ps.owner_id, ps.distress_signals_json,
                   pp.address_street, pp.address_city, pp.address_state
            FROM leads ps
            JOIN properties pp ON pp.property_id = ps.property_id
            WHERE ps.source = 'propstream'
        """).fetchall()
        for ps in ps_all:
            key = _normalize_address(ps["address_street"])
            ps_index.setdefault(key, []).append(ps)

        for cv in cv_rows:
            cv_norm = _normalize_address(cv["address_street"])
            candidates = ps_index.get(cv_norm, [])
            ps_row = None
            cv_city = cv["address_city"].replace(" ", "").lower()
            for c in candidates:
                if c["address_city"].replace(" ", "").lower() == cv_city:
                    ps_row = c
                    break

            if not ps_row:
                continue

            # Merge signals
            cv_signals = set(json.loads(cv["distress_signals_json"] or "[]"))
            ps_signals = set(json.loads(ps_row["distress_signals_json"] or "[]"))
            merged = cv_signals | ps_signals
            if merged != cv_signals:
                conn.execute(
                    "UPDATE leads SET distress_signals_json = ?, updated_at = ? WHERE lead_id = ?",
                    (json.dumps(sorted(merged)), datetime.now(timezone.utc).isoformat(), cv["lead_id"]),
                )
                cv_signals_merged += 1

            # Copy phones from propstream lead to code_violation lead if missing
            cv_phone_count = conn.execute(
                "SELECT COUNT(*) as c FROM owner_phones WHERE owner_id = ?", (cv["owner_id"],)
            ).fetchone()["c"]
            if cv_phone_count == 0:
                ps_phones = conn.execute(
                    "SELECT phone_value, phone_digits, phone_type, dnc FROM owner_phones WHERE owner_id = ?",
                    (ps_row["owner_id"],)
                ).fetchall()
                ts_now = datetime.now(timezone.utc).isoformat()
                for ph in ps_phones:
                    conn.execute(
                        "INSERT OR IGNORE INTO owner_phones (owner_id, phone_value, phone_digits, phone_type, dnc, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
                        (cv["owner_id"], ph["phone_value"], ph["phone_digits"], ph["phone_type"], ph["dnc"], ts_now),
                    )
                if ps_phones:
                    cv_phones_merged += 1

    with runtime.store._connect() as conn:
        result = conn.execute("""
            SELECT
                COUNT(DISTINCT l.lead_id) as total_leads,
                COUNT(DISTINCT CASE WHEN op.id IS NOT NULL THEN l.lead_id END) as with_phones
            FROM leads l
            LEFT JOIN owner_phones op ON op.owner_id = l.owner_id
            WHERE l.status NOT IN ('archived', 'dead')
        """).fetchone()
        total_leads = result["total_leads"]
        leads_with_phones = result["with_phones"]

    # Auto-trigger evaluation for imported leads
    with runtime.store._connect() as conn:
        imported_count = conn.execute(
            "SELECT COUNT(*) as cnt FROM leads WHERE status = 'imported'"
        ).fetchone()["cnt"]
    if imported_count > 0:
        threading.Thread(target=lambda: _start_evaluation(runtime), daemon=True).start()

    return {
        "status": "ok",
        "csv_files_found": len(csv_files),
        "files_processed": files_processed,
        "total_rows_parsed": total_rows,
        "total_leads": total_leads,
        "leads_with_phones": leads_with_phones,
        "cv_signals_merged": cv_signals_merged,
        "cv_phones_merged": cv_phones_merged,
        "imported_pending_evaluation": imported_count,
    }


def _run_skip_trace_pipeline(
    runtime: HermesRuntime,
    source: str | None = None,
) -> dict[str, Any]:
    """Full automated pipeline: export CSV → propstream-runner import-skip-trace → ingest.

    Spawns the propstream-runner as a visible subprocess so the user can watch
    the browser automation. Progress is available via /api/skip-trace/pipeline-status.
    When source is None, processes leads from ALL sources.
    """
    global _pipeline_state
    import uuid

    with _pipeline_lock:
        if _pipeline_state["running"]:
            return {"status": "error", "message": "Pipeline already running"}

    # Step 1: Export addresses to CSV
    export_result = _export_for_propstream(runtime, source=source)
    if export_result.get("count", 0) == 0:
        return {"status": "ok", "message": "No leads need skip trace — all leads already have phone numbers", "count": 0}

    csv_path = export_result["csv_path"]
    count = export_result["count"]
    job_id = uuid.uuid4().hex[:8]

    with _pipeline_lock:
        _pipeline_state.update({
            "running": True,
            "job_id": job_id,
            "log_lines": [
                f"[pipeline] Exported {count} addresses needing phone numbers",
                f"[pipeline] CSV saved to {csv_path}",
                f"[pipeline] Launching PropStream automation — a browser window will open...",
            ],
            "started_at": datetime.now(timezone.utc).isoformat(),
            "completed_at": None,
            "result": None,
            "error": None,
            "address_count": count,
            "phase": "launching",
        })

    runner_dir = runtime.root.parent / "propstream-runner"
    tsx_bin = runner_dir / "node_modules" / ".bin" / "tsx"

    def _run():
        global _pipeline_state
        try:
            with _pipeline_lock:
                _pipeline_state["phase"] = "running"

            proc = subprocess.Popen(
                [str(tsx_bin), "src/index.ts", "import-skip-trace", str(csv_path)],
                cwd=str(runner_dir),
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                bufsize=1,
            )
            for line in iter(proc.stdout.readline, ""):
                stripped = line.rstrip()
                if stripped:
                    with _pipeline_lock:
                        _pipeline_state["log_lines"].append(stripped)
            proc.wait()

            if proc.returncode == 0:
                with _pipeline_lock:
                    _pipeline_state["phase"] = "ingesting"
                    _pipeline_state["log_lines"].append("[pipeline] Runner complete — ingesting results back to Hermes...")

                ingest_result = _ingest_propstream_csvs(runtime)

                with _pipeline_lock:
                    _pipeline_state["phase"] = "qualifying"
                    _pipeline_state["log_lines"].append("[pipeline] Qualifying code violation leads (SFR + phone + stacked distress)...")

                qual_result = _qualify_code_violation_leads(runtime)

                with _pipeline_lock:
                    _pipeline_state["result"] = ingest_result
                    _pipeline_state["result"]["qualification"] = qual_result
                    phones = ingest_result.get("leads_with_phones", 0)
                    total = ingest_result.get("total_leads", 0)
                    kept = qual_result.get("kept", 0)
                    no_sfr = qual_result.get("archived_not_sfr", 0)
                    no_phone = qual_result.get("archived_no_phone", 0)
                    no_stack = qual_result.get("archived_no_stacked_signal", 0)
                    cv_merged = ingest_result.get("cv_signals_merged", 0)
                    cv_phones = ingest_result.get("cv_phones_merged", 0)
                    if cv_merged or cv_phones:
                        _pipeline_state["log_lines"].append(
                            f"[pipeline] Merged {cv_merged} distress signals + {cv_phones} phone sets onto code violation leads"
                        )
                    _pipeline_state["log_lines"].append(
                        f"[pipeline] Qualification: {kept} queued | {no_sfr} not SFR | {no_phone} no phone | {no_stack} no stacked signal"
                    )
                    _pipeline_state["log_lines"].append(
                        f"[pipeline] Done — {phones}/{total} leads now have phone numbers"
                    )
            else:
                with _pipeline_lock:
                    _pipeline_state["error"] = f"PropStream runner exited with code {proc.returncode}"
                    _pipeline_state["log_lines"].append(
                        f"[pipeline] ERROR: runner exited with code {proc.returncode}"
                    )
        except FileNotFoundError:
            with _pipeline_lock:
                _pipeline_state["error"] = (
                    f"PropStream runner not found at {runner_dir}. "
                    "Make sure propstream-runner has its dependencies installed (npm install)."
                )
                _pipeline_state["log_lines"].append(f"[pipeline] ERROR: {_pipeline_state['error']}")
        except Exception as e:
            with _pipeline_lock:
                _pipeline_state["error"] = str(e)
                _pipeline_state["log_lines"].append(f"[pipeline] ERROR: {e}")
        finally:
            with _pipeline_lock:
                _pipeline_state["running"] = False
                _pipeline_state["completed_at"] = datetime.now(timezone.utc).isoformat()
                if not _pipeline_state["error"]:
                    _pipeline_state["phase"] = "complete"
                else:
                    _pipeline_state["phase"] = "error"

    thread = threading.Thread(target=_run, daemon=True)
    thread.start()

    return {
        "status": "started",
        "job_id": job_id,
        "address_count": count,
        "csv_path": str(csv_path),
        "message": f"Pipeline started for {count} addresses. A browser window will open for PropStream automation.",
    }


def _run_batch_verification(
    runtime: HermesRuntime,
    batch_id: str | None = None,
) -> dict[str, Any]:
    """Verify all pending-stage leads through PropStream import-skip-trace.

    Exports addresses from pending_verification → CSV → PropStream runner → ingest back
    as verified leads. Runs in a background thread with progress logged to background_jobs.
    """
    import uuid

    csv_content, count = runtime.store.export_pending_as_csv(batch_id)
    if count == 0:
        return {"status": "ok", "message": "No pending addresses to verify", "count": 0}

    job_id = f"verify-{uuid.uuid4().hex[:8]}"
    runtime.store.create_job(job_id, "batch_verification")
    runtime.store.update_job(job_id, phase="exporting", log_line=f"Exported {count} addresses for PropStream verification")

    export_dir = runtime.root / "data" / "exports"
    export_dir.mkdir(parents=True, exist_ok=True)
    csv_path = export_dir / f"verify-batch-{datetime.now(timezone.utc).strftime('%Y%m%d-%H%M%S')}.csv"
    csv_path.write_text(csv_content, encoding="utf-8")

    runner_dir = runtime.root.parent / "propstream-runner"
    tsx_bin = runner_dir / "node_modules" / ".bin" / "tsx"

    def _run():
        try:
            runtime.store.update_job(job_id, phase="running", log_line="Launching PropStream runner...")

            proc = subprocess.Popen(
                [str(tsx_bin), "src/index.ts", "import-skip-trace", str(csv_path)],
                cwd=str(runner_dir),
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                bufsize=1,
            )
            for line in iter(proc.stdout.readline, ""):
                stripped = line.rstrip()
                if stripped:
                    runtime.store.update_job(job_id, log_line=stripped)
            proc.wait()

            if proc.returncode == 0:
                runtime.store.update_job(job_id, phase="ingesting", log_line="Runner complete — ingesting results...")
                ingest_result = _ingest_propstream_csvs(runtime)

                # Mark all ingested leads as propstream_verified
                with runtime.store._connect() as conn:
                    conn.execute(
                        "UPDATE leads SET propstream_verified = 1, propstream_verified_at = ? "
                        "WHERE propstream_verified != 1 AND source != 'propstream' "
                        "AND last_exported_at IS NOT NULL",
                        (datetime.now(timezone.utc).isoformat(),),
                    )

                runtime.store.update_job(
                    job_id, phase="qualifying", log_line="Qualifying code violation leads..."
                )
                qual_result = _qualify_code_violation_leads(runtime)

                runtime.store.update_job(
                    job_id,
                    status="completed",
                    phase="complete",
                    result={"ingest": ingest_result, "qualification": qual_result},
                    log_line=f"Done — {ingest_result.get('leads_with_phones', 0)} leads verified with phones",
                )
            else:
                runtime.store.update_job(
                    job_id,
                    status="failed",
                    phase="error",
                    error=f"PropStream runner exited with code {proc.returncode}",
                    log_line=f"ERROR: runner exited with code {proc.returncode}",
                )
        except FileNotFoundError:
            msg = f"PropStream runner not found at {runner_dir}. Run npm install in propstream-runner."
            runtime.store.update_job(job_id, status="failed", phase="error", error=msg, log_line=msg)
        except Exception as e:
            runtime.store.update_job(
                job_id, status="failed", phase="error", error=str(e), log_line=f"ERROR: {e}"
            )

    thread = threading.Thread(target=_run, daemon=True)
    thread.start()

    return {
        "status": "started",
        "job_id": job_id,
        "address_count": count,
        "csv_path": str(csv_path),
        "message": f"Batch verification started for {count} addresses. Track progress at /api/jobs/{job_id}",
    }


def _start_scout_pipeline(runtime: "HermesRuntime", batch_path: str) -> None:
    """Launch bulk-scout as a subprocess, stream logs, import results when done."""
    global _scout_state
    import uuid

    runner_dir = runtime.root.parent / "propstream-runner"
    scout_results_dir = runtime.root.parent / "lead-vault" / "acquisition" / "scouting"
    tsx_bin = runner_dir / "node_modules" / ".bin" / "tsx"
    job_id = f"scout-{uuid.uuid4().hex[:8]}"
    scout_date = datetime.now(timezone.utc).date().isoformat()
    results_path = scout_results_dir / scout_date / f"{job_id}-results.json"
    start_line = f"[scout] Starting bulk-scout with batch {batch_path}"

    runtime.store.create_job(job_id, "county_scout")
    runtime.store.update_job(job_id, phase="launching", log_line=start_line)
    runtime.store.update_job(job_id, phase="launching", log_line=f"[scout] Writing results to {results_path}")

    with _scout_lock:
        _scout_state.update({
            "running": True,
            "job_id": job_id,
            "log_lines": [start_line, f"[scout] Writing results to {results_path}"],
            "started_at": datetime.now(timezone.utc).isoformat(),
            "completed_at": None,
            "phase": "launching",
        })

    def _run():
        global _scout_state
        try:
            proc = subprocess.Popen(
                [str(tsx_bin), "src/index.ts", "bulk-scout", batch_path, str(results_path)],
                cwd=str(runner_dir),
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                bufsize=1,
            )
            for line in iter(proc.stdout.readline, ""):
                stripped = line.rstrip()
                if stripped:
                    runtime.store.update_job(job_id, phase="scouting", log_line=stripped)
                    with _scout_lock:
                        _scout_state["log_lines"].append(stripped)
                        _scout_state["phase"] = "scouting"

            proc.wait()
            if proc.returncode:
                runtime.store.update_job(
                    job_id,
                    phase="scouting",
                    log_line=f"[scout] Runner exited with code {proc.returncode}",
                )
            with _scout_lock:
                _scout_state["phase"] = "importing"
                _scout_state["log_lines"].append("[scout] Importing results...")
            runtime.store.update_job(job_id, phase="importing", log_line="[scout] Importing results...")

            if not results_path.exists():
                raise FileNotFoundError(f"Scout results file missing: {results_path}")

            results = json.loads(results_path.read_text())
            updated = runtime.store.import_scout_results(results)
            runtime.store.update_job(
                job_id,
                status="completed",
                phase="complete",
                result={"imported": updated, "results_path": str(results_path)},
                log_line=f"[scout] Imported {updated} county results from {results_path}",
            )
            with _scout_lock:
                _scout_state["phase"] = "complete"
                _scout_state["log_lines"].append(f"[scout] Imported {updated} county results")
        except Exception as exc:
            runtime.store.update_job(
                job_id,
                status="failed",
                phase="error",
                error=str(exc),
                log_line=f"[scout] ERROR: {exc}",
            )
            with _scout_lock:
                _scout_state["phase"] = "error"
                _scout_state["log_lines"].append(f"[scout] ERROR: {exc}")
        finally:
            with _scout_lock:
                _scout_state["running"] = False
                _scout_state["completed_at"] = datetime.now(timezone.utc).isoformat()
                if _scout_state["phase"] not in {"error", "complete"}:
                    _scout_state["phase"] = "idle"

    threading.Thread(target=_run, daemon=True).start()


def _start_harvest_pipeline(
    runtime: "HermesRuntime", signal: str, county_names: str,
    queue: list[dict[str, Any]],
) -> None:
    """Launch bulk-harvest for dynamically-selected counties."""
    global _pipeline_state

    runner_dir = runtime.root.parent / "propstream-runner"
    tsx_bin = runner_dir / "node_modules" / ".bin" / "tsx"

    with _pipeline_lock:
        if _pipeline_state["running"]:
            return
        _pipeline_state.update({
            "running": True,
            "log_lines": [f"[harvest] Starting nationwide harvest: {len(queue)} counties, signal={signal}"],
            "started_at": datetime.now(timezone.utc).isoformat(),
            "completed_at": None,
            "phase": "harvesting",
        })

    def _run():
        global _pipeline_state
        try:
            proc = subprocess.Popen(
                [str(tsx_bin), "src/index.ts", "bulk-harvest", signal, "1000", county_names],
                cwd=str(runner_dir),
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                bufsize=1,
            )
            for line in iter(proc.stdout.readline, ""):
                stripped = line.rstrip()
                if stripped:
                    with _pipeline_lock:
                        _pipeline_state["log_lines"].append(stripped)

            proc.wait()
            for entry in queue:
                runtime.store.record_harvest(entry["fips"])
            with _pipeline_lock:
                _pipeline_state["log_lines"].append(
                    f"[harvest] Complete — {len(queue)} counties harvested"
                )
        except Exception as exc:
            with _pipeline_lock:
                _pipeline_state["log_lines"].append(f"[harvest] ERROR: {exc}")
        finally:
            with _pipeline_lock:
                _pipeline_state["running"] = False
                _pipeline_state["completed_at"] = datetime.now(timezone.utc).isoformat()
                _pipeline_state["phase"] = "idle"

    threading.Thread(target=_run, daemon=True).start()


def _start_court_records_scrape(
    runtime: HermesRuntime,
    body: dict[str, Any],
) -> dict[str, Any]:
    """Launch the court-records CLI command as a subprocess with live log streaming."""
    global _court_records_state
    import uuid

    with _court_records_lock:
        if _court_records_state["running"]:
            return {"status": "error", "message": "Court records scrape already running"}

    county = body.get("county", "Greene")
    case_type = body.get("case_type", "Probate")
    days_back = str(body.get("days_back", 7))
    job_id = uuid.uuid4().hex[:8]

    with _court_records_lock:
        _court_records_state.update({
            "running": True,
            "job_id": job_id,
            "log_lines": [
                f"[court-records] Starting scrape: {county} / {case_type} / {days_back} days back",
            ],
            "started_at": datetime.now(timezone.utc).isoformat(),
            "completed_at": None,
            "result": None,
            "error": None,
            "phase": "launching",
        })

    runner_dir = runtime.root.parent / "propstream-runner"
    tsx_bin = runner_dir / "node_modules" / ".bin" / "tsx"

    def _run():
        global _court_records_state
        try:
            with _court_records_lock:
                _court_records_state["phase"] = "waiting_for_cloudflare"
                _court_records_state["log_lines"].append(
                    "[court-records] A browser window will open — pass the Cloudflare challenge to continue"
                )

            proc = subprocess.Popen(
                [str(tsx_bin), "src/index.ts", "court-records", county, case_type, days_back],
                cwd=str(runner_dir),
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                bufsize=1,
            )
            for line in iter(proc.stdout.readline, ""):
                stripped = line.rstrip()
                if stripped:
                    with _court_records_lock:
                        _court_records_state["log_lines"].append(stripped)
                        if "case.net ready" in stripped.lower():
                            _court_records_state["phase"] = "scraping"
                        elif "cross-referencing" in stripped.lower():
                            _court_records_state["phase"] = "cross_referencing"
                        elif "complete" in stripped.lower():
                            _court_records_state["phase"] = "importing"
            proc.wait()

            if proc.returncode == 0:
                with _court_records_lock:
                    _court_records_state["phase"] = "importing"
                    _court_records_state["log_lines"].append("[court-records] Scrape complete — importing results...")

                csv_dir = runtime.root.parent / "lead-vault" / "acquisition" / "court-records"
                county_slug = county.lower().replace(" ", "-")
                import glob
                csv_pattern = str(csv_dir / county_slug / "*" / "court-records.csv")
                csv_files = sorted(glob.glob(csv_pattern), reverse=True)

                if csv_files:
                    import csv as csv_mod
                    import io
                    csv_path = csv_files[0]
                    with open(csv_path, "r") as f:
                        reader = csv_mod.DictReader(f)
                        cases_to_import = []
                        for row in reader:
                            cases_to_import.append({
                                "case_number": row.get("case_number", ""),
                                "court_id": row.get("court_id", ""),
                                "case_type": row.get("case_type", "Probate"),
                                "file_date": row.get("file_date", ""),
                                "deceased_name": row.get("deceased_name", ""),
                                "pr_name": row.get("pr_name", ""),
                                "pr_address": row.get("pr_address", ""),
                                "pr_role": row.get("pr_role", ""),
                                "property_address": row.get("property_address", ""),
                                "property_city": row.get("property_city", ""),
                                "property_state": row.get("property_state", "MO"),
                                "property_zip": row.get("property_zip", ""),
                                "apn": row.get("apn", ""),
                                "assessed_value": float(row["assessed_value"]) if row.get("assessed_value") else None,
                                "market_value": float(row["market_value"]) if row.get("market_value") else None,
                                "match_confidence": row.get("match_confidence", ""),
                                "case_url": row.get("case_url", ""),
                            })

                    county_row = runtime.store.list_court_record_counties()
                    cid = None
                    for cr in county_row:
                        if cr["county"].lower() == county.lower():
                            cid = cr["id"]
                            break

                    import_result = runtime.store.import_court_record_cases(cases_to_import, county_id=cid)
                    with _court_records_lock:
                        _court_records_state["result"] = import_result
                        _court_records_state["log_lines"].append(
                            f"[court-records] Imported {import_result['imported']} cases ({import_result['duplicates']} duplicates)"
                        )
                else:
                    with _court_records_lock:
                        _court_records_state["log_lines"].append("[court-records] No CSV output found")
            else:
                with _court_records_lock:
                    _court_records_state["error"] = f"Court records runner exited with code {proc.returncode}"
                    _court_records_state["log_lines"].append(
                        f"[court-records] ERROR: runner exited with code {proc.returncode}"
                    )
        except FileNotFoundError:
            with _court_records_lock:
                _court_records_state["error"] = (
                    f"PropStream runner not found at {runner_dir}. "
                    "Make sure propstream-runner has its dependencies installed (npm install)."
                )
                _court_records_state["log_lines"].append(f"[court-records] ERROR: {_court_records_state['error']}")
        except Exception as e:
            with _court_records_lock:
                _court_records_state["error"] = str(e)
                _court_records_state["log_lines"].append(f"[court-records] ERROR: {e}")
        finally:
            with _court_records_lock:
                _court_records_state["running"] = False
                _court_records_state["completed_at"] = datetime.now(timezone.utc).isoformat()
                if not _court_records_state["error"]:
                    _court_records_state["phase"] = "complete"
                else:
                    _court_records_state["phase"] = "error"

    thread = threading.Thread(target=_run, daemon=True)
    thread.start()

    return {
        "status": "started",
        "job_id": job_id,
        "message": f"Court records scrape started for {county} ({case_type}, {days_back} days back). A browser window will open.",
    }


def _start_fsbo_scrape(
    runtime: HermesRuntime,
    body: dict[str, Any],
) -> dict[str, Any]:
    """Launch the FSBO Zillow scraper as a subprocess with live log streaming."""
    global _fsbo_scrape_state
    import uuid

    with _fsbo_scrape_lock:
        if _fsbo_scrape_state["running"]:
            return {"status": "error", "message": "FSBO scrape already running"}

    job_id = uuid.uuid4().hex[:8]

    with _fsbo_scrape_lock:
        _fsbo_scrape_state.update({
            "running": True,
            "job_id": job_id,
            "log_lines": [
                "[fsbo] Starting FSBO scrape across all active markets",
            ],
            "started_at": datetime.now(timezone.utc).isoformat(),
            "completed_at": None,
            "result": None,
            "error": None,
            "phase": "launching",
        })

    runner_dir = runtime.root.parent / "propstream-runner"
    tsx_bin = runner_dir / "node_modules" / ".bin" / "tsx"

    def _run():
        global _fsbo_scrape_state
        try:
            with _fsbo_scrape_lock:
                _fsbo_scrape_state["phase"] = "waiting_for_browser"
                _fsbo_scrape_state["log_lines"].append(
                    "[fsbo] A browser window will open — solve any captchas if prompted"
                )

            proc = subprocess.Popen(
                [str(tsx_bin), "src/index.ts", "fsbo"],
                cwd=str(runner_dir),
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                bufsize=1,
            )
            for line in iter(proc.stdout.readline, ""):
                stripped = line.rstrip()
                if stripped:
                    with _fsbo_scrape_lock:
                        _fsbo_scrape_state["log_lines"].append(stripped)
                        low = stripped.lower()
                        if "page ready" in low or "scraping page" in low:
                            _fsbo_scrape_state["phase"] = "scraping"
                        elif "enriching" in low:
                            _fsbo_scrape_state["phase"] = "enriching"
                        elif "importing to hermes" in low:
                            _fsbo_scrape_state["phase"] = "importing"
                        elif "auto-ingest" in low:
                            _fsbo_scrape_state["phase"] = "ingesting"
            proc.wait()

            if proc.returncode == 0:
                with _fsbo_scrape_lock:
                    _fsbo_scrape_state["log_lines"].append("[fsbo] Scrape complete")
            else:
                with _fsbo_scrape_lock:
                    _fsbo_scrape_state["error"] = f"FSBO runner exited with code {proc.returncode}"
                    _fsbo_scrape_state["log_lines"].append(
                        f"[fsbo] ERROR: runner exited with code {proc.returncode}"
                    )
        except FileNotFoundError:
            with _fsbo_scrape_lock:
                _fsbo_scrape_state["error"] = (
                    f"PropStream runner not found at {runner_dir}. "
                    "Make sure propstream-runner has its dependencies installed (npm install)."
                )
                _fsbo_scrape_state["log_lines"].append(f"[fsbo] ERROR: {_fsbo_scrape_state['error']}")
        except Exception as e:
            with _fsbo_scrape_lock:
                _fsbo_scrape_state["error"] = str(e)
                _fsbo_scrape_state["log_lines"].append(f"[fsbo] ERROR: {e}")
        finally:
            with _fsbo_scrape_lock:
                _fsbo_scrape_state["running"] = False
                _fsbo_scrape_state["completed_at"] = datetime.now(timezone.utc).isoformat()
                if not _fsbo_scrape_state["error"]:
                    _fsbo_scrape_state["phase"] = "complete"
                else:
                    _fsbo_scrape_state["phase"] = "error"

    thread = threading.Thread(target=_run, daemon=True)
    thread.start()

    return {
        "status": "started",
        "job_id": job_id,
        "message": "FSBO scrape started across all active markets. A browser window will open.",
    }


# ── Evaluation background runner ─────────────────────────────────

def _start_evaluation(runtime: "HermesRuntime") -> dict[str, Any]:
    with _eval_lock:
        if _eval_state["running"]:
            return {"status": "already_running", "phase": _eval_state["phase"]}

    def _run():
        import sqlite3 as _sqlite3

        with _eval_lock:
            _eval_state.update(
                running=True, started_at=datetime.now(timezone.utc).isoformat(),
                completed_at=None, log_lines=[], total=0, processed=0,
                passed=0, failed=0, phase="loading",
            )

        try:
            from lead_engine.evaluate import evaluate_lead

            with runtime.store._connect() as conn:
                rows = conn.execute(
                    "SELECT l.lead_id, l.source, l.status, l.distress_signals_json, l.owner_id, "
                    "l.property_id FROM leads l WHERE l.status = 'imported'"
                ).fetchall()

            leads = [dict(r) for r in rows]
            with _eval_lock:
                _eval_state["total"] = len(leads)
                _eval_state["phase"] = "evaluating"
                _eval_state["log_lines"].append(f"[eval] Found {len(leads)} imported leads to evaluate")

            for lead_row in leads:
                try:
                    with runtime.store._connect() as conn:
                        prop = conn.execute(
                            "SELECT * FROM properties WHERE property_id = ?",
                            (lead_row["property_id"],),
                        ).fetchone()
                        owner = conn.execute(
                            "SELECT * FROM owners WHERE owner_id = ?",
                            (lead_row["owner_id"],),
                        ).fetchone()
                        phone_count = conn.execute(
                            "SELECT COUNT(*) as cnt FROM owner_phones WHERE owner_id = ?",
                            (lead_row["owner_id"],),
                        ).fetchone()["cnt"]

                    if not prop:
                        continue

                    result = evaluate_lead(lead_row, dict(prop), dict(owner) if owner else None, phone_count)

                    with runtime.store._connect() as conn:
                        conn.execute(
                            "UPDATE leads SET evaluation_json = ? WHERE lead_id = ?",
                            (json.dumps(result), lead_row["lead_id"]),
                        )
                        if result["passed"]:
                            runtime.store.update_lead_status_api(
                                lead_row["lead_id"], "new", f"Evaluation passed: {result['reason']}",
                            )
                            with _eval_lock:
                                _eval_state["passed"] += 1
                        else:
                            with _eval_lock:
                                _eval_state["failed"] += 1

                except Exception as e:
                    with _eval_lock:
                        _eval_state["log_lines"].append(f"[eval] Error on {lead_row['lead_id']}: {e}")

                with _eval_lock:
                    _eval_state["processed"] += 1

            with _eval_lock:
                _eval_state["log_lines"].append(
                    f"[eval] Complete: {_eval_state['passed']} passed, {_eval_state['failed']} failed "
                    f"out of {_eval_state['total']}"
                )
        except Exception as e:
            with _eval_lock:
                _eval_state["log_lines"].append(f"[eval] Fatal error: {e}")
        finally:
            with _eval_lock:
                _eval_state["running"] = False
                _eval_state["completed_at"] = datetime.now(timezone.utc).isoformat()
                _eval_state["phase"] = "complete"

    threading.Thread(target=_run, daemon=True).start()
    return {"status": "started"}


# ── Underwriting background runner ──────────────────────────────

def _run_underwriting_bg(runtime: "HermesRuntime", lead_id: str) -> None:
    try:
        from lead_engine.underwrite import underwrite_lead

        runtime.store.create_underwriting_report(lead_id)

        with runtime.store._connect() as conn:
            lead_row = conn.execute("SELECT * FROM leads WHERE lead_id = ?", (lead_id,)).fetchone()
            if not lead_row:
                return
            prop_row = conn.execute(
                "SELECT * FROM properties WHERE property_id = ?", (lead_row["property_id"],),
            ).fetchone()
            owner_row = conn.execute(
                "SELECT * FROM owners WHERE owner_id = ?", (lead_row["owner_id"],),
            ).fetchone()
            notes = [
                dict(r) for r in conn.execute(
                    "SELECT * FROM lead_notes WHERE lead_id = ? ORDER BY created_at DESC", (lead_id,),
                ).fetchall()
            ]

        if not prop_row:
            runtime.store.update_underwriting_report(lead_id, {
                "status": "error", "recommendation": "No property data found",
            })
            return

        report_data = underwrite_lead(
            dict(lead_row), dict(prop_row), dict(owner_row) if owner_row else None, notes,
        )
        runtime.store.update_underwriting_report(lead_id, report_data)

    except Exception as e:
        try:
            runtime.store.update_underwriting_report(lead_id, {
                "status": "error", "recommendation": f"Underwriting failed: {e}",
            })
        except Exception:
            pass


def _start_underwriting(runtime: "HermesRuntime", lead_id: str, refresh: bool = False) -> dict[str, Any]:
    if refresh:
        with runtime.store._connect() as conn:
            conn.execute("DELETE FROM underwriting_reports WHERE lead_id = ?", (lead_id,))

    existing = runtime.store.get_underwriting_report(lead_id)
    if existing and existing.get("status") == "complete" and not refresh:
        return {"status": "already_complete", "lead_id": lead_id}

    threading.Thread(
        target=_run_underwriting_bg, args=(runtime, lead_id), daemon=True,
    ).start()
    return {"status": "started", "lead_id": lead_id}


def serve_in_thread(
    root: Path,
    host: str = "127.0.0.1",
    port: int = 8765,
) -> tuple[HermesRuntime, ThreadingHTTPServer, threading.Thread]:
    runtime = HermesRuntime(root)
    server = runtime.create_server(host=host, port=port)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return runtime, server, thread
