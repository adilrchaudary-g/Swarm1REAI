from __future__ import annotations

import base64
import hashlib
import hmac
import json
import mimetypes
import os
import re
import shutil
import subprocess
import sys
import threading
import time
from datetime import datetime, timedelta, timezone
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlparse, unquote

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


def _transcribe_and_grade(runtime: "HermesRuntime", rec_id: int, grade: bool = True) -> None:
    """Transcribe audio locally with whisper, then (optionally) grade the transcript.
    Pass grade=False to transcribe only — used by the power dialer, which defers
    grading to an end-of-day batch to save tokens."""
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
    _auto_link_recording(runtime, rec_id)
    if grade:
        _grade_recording(runtime, rec_id, transcript)


def _grade_pending_recordings(runtime: "HermesRuntime") -> int:
    """End-of-day batch: grade every recording that has a real transcript but no
    grade yet. Returns the number processed. Safe to call repeatedly (idempotent —
    already-graded rows are skipped)."""
    with runtime.store._connect() as conn:
        rows = conn.execute(
            """SELECT id, transcript FROM call_recordings
               WHERE transcript IS NOT NULL
                 AND transcript NOT LIKE '(transcription failed%'
                 AND (call_score IS NULL OR call_score = '')
               ORDER BY created_at ASC"""
        ).fetchall()
    pending = [(r["id"], r["transcript"]) for r in rows]
    if pending:
        print(f"[pd-recording] grading {len(pending)} pending recording(s)…", flush=True)
    for rec_id, transcript in pending:
        try:
            _grade_recording(runtime, rec_id, transcript)
        except Exception as exc:
            print(f"[pd-recording] grade failed for {rec_id}: {exc}", flush=True)
    return len(pending)


def _pd_grade_scheduler(runtime: "HermesRuntime") -> None:
    """Nightly batch-grade at PD_GRADE_HOUR_ET (default 21:00 America/New_York).
    Mirrors the daily-stats scheduler pattern; runs in a daemon thread."""
    from zoneinfo import ZoneInfo
    et = ZoneInfo("America/New_York")
    try:
        hour = int(os.environ.get("PD_GRADE_HOUR_ET", "21"))
    except (ValueError, TypeError):
        hour = 21
    hour = max(0, min(hour, 23))
    while True:
        now = datetime.now(et)
        target = now.replace(hour=hour, minute=0, second=0, microsecond=0)
        if target <= now:
            target = target + timedelta(days=1)
        sleep_s = max(60, (target - now).total_seconds())
        print(f"[pd-recording] next nightly grading at {target:%Y-%m-%d %I:%M %p %Z} "
              f"({int(sleep_s)}s)", flush=True)
        time.sleep(sleep_s)
        try:
            _grade_pending_recordings(runtime)
        except Exception as exc:
            print(f"[pd-recording] nightly grading error: {exc}", flush=True)


def _auto_link_recording(runtime: "HermesRuntime", rec_id: int) -> None:
    """Try to match a recording to a lead by seller name + property address."""
    rec = runtime.store.get_call_recording(rec_id)
    if not rec or rec.get("lead_id"):
        return
    name = rec.get("seller_name", "")
    addr = rec.get("property_address", "")
    if not name or name == "Unknown":
        return
    try:
        with runtime.store._connect() as conn:
            name_clauses = []
            name_params = []
            for part in name.lower().split():
                if len(part) > 2:
                    name_clauses.append("lower(o.owner_name) LIKE ?")
                    name_params.append(f"%{part}%")
            addr_clauses = []
            addr_params = []
            if addr:
                street_part = addr.split(",")[0].strip()
                for word in street_part.lower().split():
                    if len(word) > 2 and word not in ("ave", "avenue", "st", "street", "rd", "road", "dr", "drive", "blvd", "ct", "ln", "pl", "way", "circle", "court", "lane", "place"):
                        addr_clauses.append("lower(p.address_street) LIKE ?")
                        addr_params.append(f"%{word}%")
            if not name_clauses:
                return
            if name_clauses and addr_clauses:
                where = f"({' AND '.join(name_clauses)}) AND ({' AND '.join(addr_clauses)})"
                params = name_params + addr_params
            else:
                where = " AND ".join(name_clauses)
                params = name_params
            rows = conn.execute(
                f"""SELECT l.lead_id FROM leads l
                    JOIN owners o ON l.owner_id = o.owner_id
                    JOIN properties p ON l.property_id = p.property_id
                    WHERE {where} LIMIT 2""",
                params,
            ).fetchall()
            if len(rows) == 1:
                runtime.store.update_call_recording(rec_id, {"lead_id": rows[0]["lead_id"]})
                print(f"[call-recordings] Auto-linked recording {rec_id} to lead {rows[0]['lead_id'][:40]}")
    except Exception as exc:
        print(f"[call-recordings] Auto-link failed for {rec_id}: {exc}")


_GRADE_PROMPT_TEMPLATE = """You are a real estate wholesaling call coach. Grade this cold call on two axes: the caller's battle performance and the seller's motivation.

TRANSCRIPT:
{transcript}

CRITICAL CONTEXT: This caller is hunting for the needle in the haystack — motivated sellers. They dial hundreds of leads. The SMART play on a dead seller is to qualify fast, stay professional, and move on. Do NOT penalize short calls when the seller clearly has zero motivation. Reserve harsh grades for calls where there WAS seller motivation or openness and the caller failed to capitalize.

BATTLE SCORE — grade the caller (1-10) relative to the opportunity on this call:

- objection_handling: If seller showed ANY crack or hesitation, did the caller push through? On a hard dead seller, did they at least probe once before moving on? Score relative to what was possible.
- conversation_control: Did they lead the call structure? Ask qualifying questions? On short dead-seller calls, did they efficiently qualify? That's good control.
- kept_on_phone: Did they keep the seller talking as long as was PRODUCTIVE? Staying on with a dead seller wastes time. Keeping a warm seller engaged is skill. Grade relative to opportunity.
- stayed_grounded: Were they calm, confident, professional? Did they handle rejection without getting rattled?

SCORING GUIDE:
- Dead seller + professional quick exit = 6-8 range (smart qualifying)
- Dead seller + no probe at all = 4-5 (missed a chance to check)
- Warm/Hot seller + extended conversation + good probing = 7-10
- Warm/Hot seller + gave up too fast = 2-4 (missed real opportunity)

SELLER MOTIVATION — how motivated is this seller to sell?

Respond with ONLY valid JSON:
{{
  "battle_score": {{
    "objection_handling": 6,
    "objection_notes": "brief explanation",
    "conversation_control": 7,
    "control_notes": "brief explanation",
    "kept_on_phone": 5,
    "phone_notes": "brief explanation",
    "stayed_grounded": 8,
    "grounded_notes": "brief explanation",
    "overall": 7,
    "summary": "1-2 sentence honest assessment"
  }},
  "seller_motivation": {{
    "core_reason": "why they would or wouldn't sell",
    "motivation_level": 2,
    "overall_sentiment": "Cold",
    "summary": "1-2 sentence read on this seller"
  }},
  "call_score": "Average"
}}

For call_score use exactly one of: "Strong", "Average", "Needs Work"
For overall_sentiment use exactly one of: "Hot", "Warm", "Cold", "Dead"
"""


def _parse_grade_json(text: str) -> dict | None:
    start = text.find("{")
    end = text.rfind("}") + 1
    if start >= 0 and end > start:
        return json.loads(text[start:end])
    return None


def _grade_recording(runtime: "HermesRuntime", rec_id: int, transcript: str) -> None:
    """Grade a call transcript using Claude CLI proxy first, API key fallback."""
    prompt = _GRADE_PROMPT_TEMPLATE.format(transcript=transcript)
    grades = None

    # Try 1: Claude CLI proxy (no API key needed)
    claude_bin = shutil.which("claude")
    if claude_bin:
        try:
            print(f"[call-recordings] Grading {rec_id} via Claude CLI...")
            result = subprocess.run(
                [claude_bin, "-p", prompt],
                capture_output=True, text=True, timeout=120,
            )
            if result.returncode == 0 and result.stdout.strip():
                grades = _parse_grade_json(result.stdout)
        except Exception as exc:
            print(f"[call-recordings] CLI grading failed for {rec_id}: {exc}")

    # Try 2: Anthropic API (if CLI failed and key is available)
    if not grades:
        api_key = os.environ.get("ANTHROPIC_API_KEY", "")
        if api_key:
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
                    body = json.loads(resp.read().decode())
                text = "".join(b["text"] for b in body.get("content", []) if b.get("type") == "text")
                grades = _parse_grade_json(text)
            except Exception as exc:
                print(f"[call-recordings] API grading failed for {rec_id}: {exc}")

    if grades:
        runtime.store.update_call_recording(rec_id, {
            "my_performance_json": grades.get("battle_score"),
            "seller_motivation_json": grades.get("seller_motivation"),
            "call_score": grades.get("call_score", "Average"),
        })
        overall = grades.get("battle_score", {}).get("overall", "?")
        print(f"[call-recordings] Graded {rec_id}: {grades.get('call_score', '?')} (battle: {overall}/10)")
        from .discord_notify import notify_recording_graded
        notify_recording_graded(runtime.store, rec_id)
    else:
        print(f"[call-recordings] Skipping grading for {rec_id} — no CLI or API key available")


_SESSION_SPLIT_PROMPT = """You are analyzing a timestamped transcript from a real estate wholesaling dialing session. The recording contains multiple phone calls separated by silence, dial tones, or ringing.

TIMESTAMPED TRANSCRIPT:
{transcript}

Split this into individual phone calls. For each call, identify:
1. start_time: seconds offset where this call begins in the recording
2. end_time: seconds offset where this call ends
3. seller_name: the seller's name if mentioned (or "Unknown")
4. property_address: the property address if mentioned (or null)
5. disposition: one of: "answered" (talked but unclear outcome), "interested" (seller showed interest), "not_interested" (seller declined), "voicemail" (left a voicemail or got machine), "no_answer" (rang out, no pickup), "bad_number" (disconnected/wrong number)
6. summary: 1-2 sentence summary of what happened on this call
7. transcript: the portion of the transcript for just this call

Respond with ONLY valid JSON — an array of call objects:
[
  {{
    "start_time": 0,
    "end_time": 45,
    "seller_name": "John Smith",
    "property_address": "123 Main St, Cleveland, OH",
    "disposition": "not_interested",
    "summary": "Seller said not interested in selling, owns property free and clear.",
    "transcript": "Hello, is this John? Yes... I was calling about your property on Main Street..."
  }}
]

Important rules:
- Silence gaps, ringing, or dial tones between calls are NOT calls — skip them
- If you hear "the number you have reached is not in service" or similar, that's "bad_number"
- If it goes to voicemail/answering machine, that's "voicemail"
- If they talk and show genuine interest or agree to a follow-up, that's "interested"
- Be precise with start_time/end_time — use the timestamps from the transcript
"""


def _handle_session_upload(handler: Any, runtime: "HermesRuntime") -> dict[str, Any]:
    """Parse multipart upload of a dialing session recording."""
    content_type = handler.headers.get("Content-Type", "")
    length = int(handler.headers.get("Content-Length", 0))
    raw = handler.rfile.read(length)

    boundary = ""
    for part in content_type.split(";"):
        part = part.strip()
        if part.startswith("boundary="):
            boundary = part.split("=", 1)[1].strip('"')
            break

    file_data: bytes | None = None
    file_name: str | None = None
    file_type: str | None = None
    parts: dict[str, str] = {}

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

    if not file_data or not file_name:
        return {"error": "No file uploaded"}

    recordings_dir = runtime.store.data_dir / "recordings"
    recordings_dir.mkdir(parents=True, exist_ok=True)
    import uuid as _uuid
    safe_name = f"session_{_uuid.uuid4().hex}_{file_name}"
    file_path = str(recordings_dir / safe_name)
    Path(file_path).write_bytes(file_data)

    session_date = parts.get("session_date")

    session_id = f"session-{_uuid.uuid4().hex[:8]}"
    print(f"[session] Saved session recording: {file_path} ({len(file_data)} bytes)")

    t = threading.Thread(
        target=_process_session_recording,
        args=(runtime, file_path, file_type or "mp4", session_id, session_date),
        daemon=True,
    )
    t.start()

    return {"status": "processing", "session_id": session_id, "file": file_name}


def _process_session_recording(
    runtime: "HermesRuntime",
    file_path: str,
    file_type: str,
    session_id: str,
    session_date: str | None,
) -> None:
    """Transcribe full session with timestamps, split into calls, log each one."""
    fp = Path(file_path)
    if not fp.is_file():
        print(f"[session] File not found: {file_path}")
        return

    # 1) Convert to wav if needed
    audio_path = str(fp)
    tmp_wav = None
    if fp.suffix.lower() in (".mov", ".mp4", ".m4a", ".webm", ".mp3", ".ogg"):
        tmp_wav = str(fp.with_suffix(".wav"))
        try:
            result = subprocess.run(
                ["ffmpeg", "-y", "-i", audio_path, "-ar", "16000", "-ac", "1",
                 "-c:a", "pcm_s16le", tmp_wav],
                capture_output=True, text=True, timeout=600,
            )
            if result.returncode == 0:
                audio_path = tmp_wav
            else:
                print(f"[session] ffmpeg failed: {result.stderr[:500]}")
        except Exception as exc:
            print(f"[session] ffmpeg error: {exc}")

    # 2) Transcribe with whisper — get timestamped segments
    segments_text = ""
    try:
        import whisper as _whisper
        print(f"[session] Transcribing session with whisper (medium)...")
        model = _whisper.load_model("medium")
        result = model.transcribe(audio_path, verbose=False)
        segments = result.get("segments", [])
        lines = []
        for seg in segments:
            start = seg.get("start", 0)
            end = seg.get("end", 0)
            text = seg.get("text", "").strip()
            if text:
                lines.append(f"[{start:.1f}s - {end:.1f}s] {text}")
        segments_text = "\n".join(lines)
        print(f"[session] Transcription done: {len(segments)} segments, {len(segments_text)} chars")
    except Exception as exc:
        print(f"[session] Whisper failed: {exc}")

    if tmp_wav and Path(tmp_wav).exists():
        try:
            Path(tmp_wav).unlink()
        except OSError:
            pass

    if not segments_text:
        print(f"[session] No transcript — aborting session split")
        return

    # 3) Use Claude to split into individual calls
    prompt = _SESSION_SPLIT_PROMPT.format(transcript=segments_text)
    calls_json = None

    claude_bin = shutil.which("claude")
    if claude_bin:
        try:
            print(f"[session] Splitting calls via Claude CLI...")
            result = subprocess.run(
                [claude_bin, "-p", prompt],
                capture_output=True, text=True, timeout=180,
            )
            if result.returncode == 0 and result.stdout.strip():
                text = result.stdout.strip()
                start = text.find("[")
                end = text.rfind("]") + 1
                if start >= 0 and end > start:
                    calls_json = json.loads(text[start:end])
        except Exception as exc:
            print(f"[session] CLI split failed: {exc}")

    if not calls_json:
        api_key = os.environ.get("ANTHROPIC_API_KEY", "")
        if api_key:
            try:
                import urllib.request
                req_body = json.dumps({
                    "model": "claude-sonnet-4-6",
                    "max_tokens": 4096,
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
                with urllib.request.urlopen(req, timeout=120) as resp:
                    body = json.loads(resp.read().decode())
                text = "".join(b["text"] for b in body.get("content", []) if b.get("type") == "text")
                start = text.find("[")
                end = text.rfind("]") + 1
                if start >= 0 and end > start:
                    calls_json = json.loads(text[start:end])
            except Exception as exc:
                print(f"[session] API split failed: {exc}")

    if not calls_json:
        print(f"[session] Could not split transcript — creating single recording")
        runtime.store.create_call_recording({
            "seller_name": "Dialing Session",
            "call_date": session_date,
            "file_path": file_path,
            "file_name": Path(file_path).name,
            "file_type": file_type,
            "transcript": segments_text,
            "notes": f"Session {session_id} — automatic split failed, full transcript attached",
        })
        return

    # 4) Create individual recordings and call attempts
    print(f"[session] Found {len(calls_json)} calls in session")
    created = 0
    for i, call in enumerate(calls_json):
        seller = call.get("seller_name", "Unknown")
        addr = call.get("property_address")
        disposition = call.get("disposition", "answered")
        summary = call.get("summary", "")
        call_transcript = call.get("transcript", "")

        rec_result = runtime.store.create_call_recording({
            "seller_name": seller,
            "property_address": addr,
            "call_date": session_date,
            "file_path": file_path,
            "file_name": Path(file_path).name,
            "file_type": file_type,
            "transcript": call_transcript,
            "notes": f"Session {session_id} call #{i+1} — {summary}",
        })
        rec_id = rec_result.get("id")
        if rec_id:
            _auto_link_recording(runtime, rec_id)
            rec = runtime.store.get_call_recording(rec_id)
            lead_id = rec.get("lead_id") if rec else None

            if lead_id:
                runtime.store.log_call_attempt(lead_id, disposition, summary)
                print(f"[session] Call #{i+1}: {seller} → {disposition}, linked to {lead_id[:40]}")
            else:
                print(f"[session] Call #{i+1}: {seller} → {disposition}, no lead match")

            if call_transcript:
                _grade_recording(runtime, rec_id, call_transcript)

        created += 1

    print(f"[session] Session {session_id} complete: {created} calls processed")


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

        from .agents import AgentOrchestrator
        self.orchestrator = AgentOrchestrator(self.store, self)
        self.orchestrator.start_scheduler()

        from .discord_notify import start_daily_scheduler
        start_daily_scheduler(self.store)

        # Nightly batch-grading of power-dialer recordings (transcribed-but-ungraded).
        threading.Thread(target=_pd_grade_scheduler, args=(self,), daemon=True).start()

        from .agents.mega_orchestrator import MegaOrchestrator
        self.mega = MegaOrchestrator(self.store, self)

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

        self.store.upsert_source_adapter(
            "zillow_fsbo",
            "Zillow FSBO (For Sale By Owner)",
            "PARTIAL",
        )

    def create_server(self, host: str = "127.0.0.1", port: int = 8765) -> ThreadingHTTPServer:
        runtime = self

        def _execute_runtime_action(rt: 'HermesRuntime', payload: dict) -> None:
            action = payload.get("action", "")
            if action == "run_skip_trace":
                def _bg():
                    try:
                        _run_skip_trace_pipeline(rt)
                    except Exception:
                        pass
                threading.Thread(target=_bg, daemon=True).start()
            elif action == "run_underwriting":
                lead_id = payload.get("lead_id")
                if lead_id:
                    def _bg():
                        try:
                            _run_underwriting_bg(rt, lead_id)
                        except Exception:
                            pass
                    threading.Thread(target=_bg, daemon=True).start()
            elif action == "run_evaluation":
                def _bg():
                    try:
                        _start_evaluation(rt)
                    except Exception:
                        pass
                threading.Thread(target=_bg, daemon=True).start()
            elif action == "run_scrape":
                source = payload.get("source", "code_violations")
                if source == "code_violations":
                    def _bg():
                        try:
                            _trigger_scrape_and_ingest(rt)
                        except Exception:
                            pass
                    threading.Thread(target=_bg, daemon=True).start()
            elif action == "run_verification":
                def _bg():
                    try:
                        _run_batch_verification(rt, f"agent-verify-{uuid.uuid4().hex[:8]}")
                    except Exception:
                        pass
                threading.Thread(target=_bg, daemon=True).start()
            elif action == "grade_recording":
                rec_id = payload.get("recording_id")
                if rec_id:
                    rec = rt.store.get_call_recording(int(rec_id))
                    if rec and rec.get("transcript"):
                        def _bg():
                            _grade_recording(rt, int(rec_id), rec["transcript"])
                        threading.Thread(target=_bg, daemon=True).start()
            elif action == "transcribe_recording":
                rec_id = payload.get("recording_id")
                if rec_id:
                    def _bg():
                        _transcribe_and_grade(rt, int(rec_id))
                    threading.Thread(target=_bg, daemon=True).start()

        class Handler(BaseHTTPRequestHandler):
            server_version = "HermesRuntime/0.1"

            def log_message(self, format: str, *args: Any) -> None:  # noqa: A003
                return

            def _cors_headers(self) -> None:
                self.send_header("Access-Control-Allow-Origin", "*")
                self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
                self.send_header("Access-Control-Allow-Headers", "Content-Type, X-Export-CSV-Path, Authorization")

            def _send_json(self, status: int, payload: Any) -> None:
                body = json.dumps(payload, indent=2, sort_keys=True, default=str).encode("utf-8")
                self.send_response(status)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Content-Length", str(len(body)))
                self._cors_headers()
                self.end_headers()
                self.wfile.write(body)

            def _send_html(self, status: int, html: str) -> None:
                body = html.encode("utf-8")
                self.send_response(status)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.send_header("Content-Length", str(len(body)))
                self._cors_headers()
                self.end_headers()
                self.wfile.write(body)

            def _send_xml(self, xml: str, status: int = HTTPStatus.OK) -> None:
                body = xml.encode("utf-8")
                self.send_response(status)
                self.send_header("Content-Type", "text/xml; charset=utf-8")
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

            def _get_current_user(self) -> dict[str, Any] | None:
                auth = self.headers.get("Authorization", "")
                if auth.startswith("Bearer "):
                    token = auth[7:]
                    return runtime.store.validate_session(token)
                parsed = urlparse(self.path)
                qs = parse_qs(parsed.query)
                if "token" in qs:
                    return runtime.store.validate_session(qs["token"][0])
                return None

            def _require_auth(self) -> dict[str, Any] | None:
                user = self._get_current_user()
                if not user:
                    self._send_json(HTTPStatus.UNAUTHORIZED, {"error": "Authentication required"})
                return user

            def _require_role(self, *roles: str) -> dict[str, Any] | None:
                user = self._require_auth()
                if user and user["role"] not in roles:
                    self._send_json(HTTPStatus.FORBIDDEN, {"error": "Insufficient permissions"})
                    return None
                return user

            def _user_has_permission(self, user: dict[str, Any], perm: str) -> bool:
                perms = json.loads(user.get("permissions_json") or "[]")
                return "*" in perms or perm in perms

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

                # ── Auth endpoints (no auth required) ─────────────────
                if path == "/api/auth/me":
                    user = self._get_current_user()
                    if user:
                        self._send_json(HTTPStatus.OK, user)
                    else:
                        self._send_json(HTTPStatus.UNAUTHORIZED, {"error": "Not authenticated"})
                    return

                if path == "/api/users":
                    user = self._require_role("admin")
                    if not user:
                        return
                    self._send_json(HTTPStatus.OK, runtime.store.list_users())
                    return

                # ── Auth gate for dashboard API ───────────────────────
                if path.startswith("/api/"):
                    user = self._require_auth()
                    if not user:
                        return

                # ── Twilio Voice (browser dialer) ─────────────────────
                if path == "/api/twilio/status":
                    cfg = _twilio_config()
                    has_creds = all([
                        cfg["account_sid"], cfg["api_key_sid"],
                        cfg["api_key_secret"], cfg["phone_number"],
                    ])
                    self._send_json(HTTPStatus.OK, {
                        "configured": _twilio_ready(),
                        "has_credentials": has_creds,
                        "twiml_app_configured": bool(cfg["twiml_app_sid"]),
                        "account_sid": cfg["account_sid"] or None,
                        "phone_number": cfg["phone_number"] or None,
                    })
                    return

                # Live Twilio balance + confirmed spend (for the Finances tab).
                if path == "/api/twilio/usage":
                    self._send_json(HTTPStatus.OK, _twilio_usage())
                    return

                if path == "/api/twilio/token":
                    if not _twilio_ready():
                        self._send_json(HTTPStatus.SERVICE_UNAVAILABLE, {
                            "error": "Twilio not fully configured (missing TwiML App SID?)",
                        })
                        return
                    identity = f"user_{user['id']}"
                    token = _twilio_voice_token(identity)
                    if not token:
                        self._send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {
                            "error": "Failed to mint Twilio token",
                        })
                        return
                    self._send_json(HTTPStatus.OK, {"token": token, "identity": identity})
                    return

                # Power dialer: state for the logged-in agent.
                if path == "/api/pd/state":
                    self._send_json(HTTPStatus.OK, _get_power_dialer(runtime).agent_state(str(user["id"])))
                    return

                # Power dialer metrics (§14). Per-agent by default; scope=all gives the
                # account-wide roll-up for the KPI dashboard.
                if path == "/api/pd/metrics":
                    try:
                        hours = int(query.get("hours", ["24"])[0])
                    except (ValueError, TypeError):
                        hours = 24
                    hours = max(1, min(hours, 720))
                    scope = (query.get("scope", ["mine"])[0] or "mine").lower()
                    agent = None if scope == "all" else str(user["id"])
                    self._send_json(HTTPStatus.OK,
                                    _get_power_dialer(runtime).metrics(agent, hours))
                    return

                # Auto-dialer: current session state for the logged-in caller.
                if path == "/api/dialer/session/state":
                    st = _dialer.state(user["id"])
                    self._send_json(HTTPStatus.OK, st or {"status": "idle"})
                    return

                # Setup helper: returns the public URL to paste into the TwiML App.
                if path == "/api/twilio/voice-url":
                    public = _public_base_url()
                    base = public or "http://localhost:8765"
                    self._send_json(HTTPStatus.OK, {
                        "tunnel_url": public,
                        "voice_url": f"{base}/twilio/voice",
                        "is_public": bool(public),
                    })
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

                # ── Schedule API (GET) ────────────────────────────────

                if path == "/api/schedule":
                    date_from = self._query_first(query, "date_from", "")
                    date_to = self._query_first(query, "date_to", "")
                    data = runtime.store.get_caller_availability(user["id"], date_from, date_to)
                    self._send_json(HTTPStatus.OK, data)
                    return

                if path == "/api/schedule/all":
                    if user["role"] != "admin":
                        self._send_json(HTTPStatus.FORBIDDEN, {"error": "Admin only"})
                        return
                    date_from = self._query_first(query, "date_from", "")
                    date_to = self._query_first(query, "date_to", "")
                    data = runtime.store.get_all_caller_availability(date_from, date_to)
                    self._send_json(HTTPStatus.OK, data)
                    return

                # ── Finances API (GET) ────────────────────────────────

                if path == "/api/finances/summary":
                    if user["role"] != "admin":
                        self._send_json(HTTPStatus.FORBIDDEN, {"error": "Admin only"})
                        return
                    self._send_json(HTTPStatus.OK, runtime.store.get_finance_summary())
                    return

                if path == "/api/finances/expenses":
                    if user["role"] != "admin":
                        self._send_json(HTTPStatus.FORBIDDEN, {"error": "Admin only"})
                        return
                    self._send_json(HTTPStatus.OK, runtime.store.list_expenses())
                    return

                if path == "/api/finances/revenue":
                    if user["role"] != "admin":
                        self._send_json(HTTPStatus.FORBIDDEN, {"error": "Admin only"})
                        return
                    self._send_json(HTTPStatus.OK, runtime.store.list_revenue())
                    return

                if path == "/api/finances/payroll":
                    if user["role"] != "admin":
                        self._send_json(HTTPStatus.FORBIDDEN, {"error": "Admin only"})
                        return
                    week = self._query_first(query, "week_start")
                    self._send_json(HTTPStatus.OK, runtime.store.list_payroll(week))
                    return

                # ── Activity Tracking API (GET) ──────────────────────

                if path == "/api/activity/live-status":
                    self._send_json(HTTPStatus.OK, runtime.store.get_caller_live_status())
                    return

                if path == "/api/activity/tracker":
                    target_id = int(self._query_first(query, "user_id", "0"))
                    date = self._query_first(query, "date", "")
                    if user["role"] != "admin" and target_id and target_id != user["id"]:
                        self._send_json(HTTPStatus.FORBIDDEN, {"error": "Can only view own activity"})
                        return
                    uid = target_id or user["id"]
                    self._send_json(HTTPStatus.OK, runtime.store.get_caller_activity(uid, date))
                    return

                if path == "/api/activity/summary":
                    date_from = self._query_first(query, "date_from", "")
                    date_to = self._query_first(query, "date_to", "")
                    target_id = int(self._query_first(query, "user_id", "0")) or None
                    if user["role"] != "admin" and target_id and target_id != user["id"]:
                        self._send_json(HTTPStatus.FORBIDDEN, {"error": "Can only view own activity"})
                        return
                    if user["role"] != "admin":
                        target_id = user["id"]
                    self._send_json(HTTPStatus.OK, runtime.store.get_activity_summary(date_from, date_to, target_id))
                    return

                if path == "/api/activity/integrity":
                    if user["role"] != "admin":
                        self._send_json(HTTPStatus.FORBIDDEN, {"error": "Admin only"})
                        return
                    date_from = self._query_first(query, "date_from", "")
                    date_to = self._query_first(query, "date_to", "")
                    self._send_json(HTTPStatus.OK, runtime.store.get_integrity_report(date_from, date_to))
                    return

                if path == "/api/activity/daily-logs":
                    date_from = self._query_first(query, "date_from", "")
                    date_to = self._query_first(query, "date_to", "")
                    target_id = int(self._query_first(query, "user_id", "0")) or None
                    if user["role"] != "admin":
                        target_id = user["id"]
                    self._send_json(HTTPStatus.OK, runtime.store.get_daily_logs(target_id, date_from, date_to))
                    return

                # ── Dashboard API (GET) ──────────────────────────────

                if path == "/api/leads/assignments":
                    if user["role"] != "admin":
                        self._send_json(HTTPStatus.FORBIDDEN, {"error": "Admin only"})
                        return
                    self._send_json(HTTPStatus.OK, runtime.store.get_assignment_stats())
                    return

                if path == "/api/leads/lists":
                    if user["role"] != "admin":
                        self._send_json(HTTPStatus.FORBIDDEN, {"error": "Admin only"})
                        return
                    self._send_json(HTTPStatus.OK, runtime.store.get_list_overview())
                    return

                if path == "/api/leads/assignments/compare":
                    if user["role"] != "admin":
                        self._send_json(HTTPStatus.FORBIDDEN, {"error": "Admin only"})
                        return
                    ids_raw = self._query_first(query, "caller_ids", "")
                    caller_ids = [int(x) for x in ids_raw.split(",") if x.strip()]
                    self._send_json(HTTPStatus.OK, runtime.store.get_assignment_comparison(caller_ids))
                    return

                if path == "/api/leads":
                    exclude_raw = self._query_first(query, "exclude_statuses")
                    exclude_list = [s.strip() for s in exclude_raw.split(",") if s.strip()] if exclude_raw else None
                    assigned_filter = None
                    if user["role"] == "caller":
                        assigned_filter = user["id"]
                    elif self._query_first(query, "assigned_to"):
                        assigned_filter = int(self._query_first(query, "assigned_to"))
                    data = runtime.store.list_all_leads(
                        status=self._query_first(query, "status"),
                        exclude_statuses=exclude_list,
                        tier=self._query_first(query, "tier"),
                        source=self._query_first(query, "source"),
                        persona=self._query_first(query, "persona"),
                        assigned_to=assigned_filter,
                        limit=int(self._query_first(query, "limit", "100")),
                        offset=int(self._query_first(query, "offset", "0")),
                    )
                    self._send_json(HTTPStatus.OK, data)
                    return

                if path == "/api/leads/lookup-by-phone":
                    phone = self._query_first(query, "phone", "")
                    result = runtime.store.lookup_lead_by_phone(phone)
                    if result:
                        self._send_json(HTTPStatus.OK, result)
                    else:
                        self._send_json(HTTPStatus.NOT_FOUND, {"error": "No lead found for that phone number"})
                    return

                m = re.match(r"^/api/leads/([^/]+)/calls$", path)
                if m:
                    history = runtime.store.get_call_history(m.group(1))
                    self._send_json(HTTPStatus.OK, history)
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

                if path == "/api/sources/zillow_fsbo/status":
                    status = getattr(runtime, '_zillow_fsbo_status', {
                        "running": False, "log": [], "markets": [],
                    })
                    self._send_json(HTTPStatus.OK, status)
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

                if path == "/api/kpi/dial-check":
                    minutes = int(self._query_first(query, "minutes", "15"))
                    self._send_json(HTTPStatus.OK, runtime.store.get_dial_check(minutes))
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

                if path == "/api/kpi/tracker":
                    self._send_json(HTTPStatus.OK, runtime.store.get_tracker_kpis())
                    return

                if path == "/api/kpi/dial-streak":
                    self._send_json(HTTPStatus.OK, runtime.store.get_dial_streak())
                    return

                if path == "/api/leads/attempt-counts":
                    self._send_json(HTTPStatus.OK, runtime.store.get_lead_attempt_counts())
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

                m = re.match(r"^/api/call-recordings/by-lead/(.+)$", path)
                if m:
                    lid = unquote(m.group(1))
                    with runtime.store._connect() as conn:
                        rows = conn.execute(
                            "SELECT * FROM call_recordings WHERE lead_id = ? ORDER BY call_date DESC", (lid,)
                        ).fetchall()
                    self._send_json(HTTPStatus.OK, [dict(r) for r in rows])
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
                    file_size = fp.stat().st_size
                    range_header = self.headers.get("Range")
                    if range_header:
                        range_match = re.match(r"bytes=(\d+)-(\d*)", range_header)
                        if range_match:
                            start = int(range_match.group(1))
                            end = int(range_match.group(2)) if range_match.group(2) else file_size - 1
                            end = min(end, file_size - 1)
                            length = end - start + 1
                            self.send_response(206)
                            self.send_header("Content-Type", ct)
                            self.send_header("Content-Length", str(length))
                            self.send_header("Content-Range", f"bytes {start}-{end}/{file_size}")
                            self.send_header("Accept-Ranges", "bytes")
                            self._cors_headers()
                            self.end_headers()
                            with open(fp, "rb") as f:
                                f.seek(start)
                                self.wfile.write(f.read(length))
                            return
                    self.send_response(HTTPStatus.OK)
                    self.send_header("Content-Type", ct)
                    self.send_header("Content-Length", str(file_size))
                    self.send_header("Accept-Ranges", "bytes")
                    self._cors_headers()
                    self.end_headers()
                    with open(fp, "rb") as f:
                        while True:
                            chunk = f.read(65536)
                            if not chunk:
                                break
                            self.wfile.write(chunk)
                    return

                # ── Chat / Mega-Agent (GET) ───────────────────────
                if path == "/api/chat/conversations":
                    convos = runtime.store.list_conversations(user["id"])
                    self._send_json(HTTPStatus.OK, convos)
                    return

                m = re.match(r"^/api/chat/conversations/(\d+)$", path)
                if m:
                    cid = int(m.group(1))
                    messages = runtime.store.get_conversation_messages(cid)
                    self._send_json(HTTPStatus.OK, {"conversation_id": cid, "messages": messages})
                    return

                # ── Agents (GET) ──────────────────────────────────
                if path == "/api/agents":
                    self._send_json(HTTPStatus.OK, runtime.store.list_agent_definitions())
                    return

                if path == "/api/agents/proposals/pending/count":
                    self._send_json(HTTPStatus.OK, {"count": runtime.store.pending_proposal_count()})
                    return

                if path == "/api/agents/proposals":
                    data = runtime.store.list_proposals(
                        status=self._query_first(query, "status"),
                        agent_type=self._query_first(query, "agent_type"),
                        limit=int(self._query_first(query, "limit", "50")),
                    )
                    self._send_json(HTTPStatus.OK, data)
                    return

                m = re.match(r"^/api/agents/proposals/(\d+)$", path)
                if m:
                    proposal = runtime.store.get_proposal(int(m.group(1)))
                    if proposal:
                        self._send_json(HTTPStatus.OK, proposal)
                    else:
                        self._send_json(HTTPStatus.NOT_FOUND, {"error": "Proposal not found"})
                    return

                if path == "/api/agents/proxy-status":
                    self._send_json(HTTPStatus.OK, runtime.orchestrator.get_status())
                    return

                m = re.match(r"^/api/agents/([a-z_]+)/runs$", path)
                if m:
                    self._send_json(HTTPStatus.OK,
                                    runtime.store.list_agent_runs(m.group(1)))
                    return

                m = re.match(r"^/api/agents/([a-z_]+)/runs/([a-z0-9-]+)$", path)
                if m:
                    run = runtime.store.get_agent_run(m.group(2))
                    if run:
                        self._send_json(HTTPStatus.OK, run)
                    else:
                        self._send_json(HTTPStatus.NOT_FOUND, {"error": "Run not found"})
                    return

                m = re.match(r"^/api/agents/([a-z_]+)$", path)
                if m:
                    defn = runtime.store.get_agent_definition(m.group(1))
                    if defn:
                        defn["running"] = runtime.orchestrator.is_running(m.group(1))
                        self._send_json(HTTPStatus.OK, defn)
                    else:
                        self._send_json(HTTPStatus.NOT_FOUND, {"error": "Agent not found"})
                    return

                # ── Contracts (GET) ──────────────────────────────
                if path == "/api/contracts":
                    data = runtime.store.list_contracts(
                        lead_id=self._query_first(query, "lead_id"),
                        status=self._query_first(query, "status"),
                        limit=int(self._query_first(query, "limit", "100")),
                    )
                    self._send_json(HTTPStatus.OK, data)
                    return

                m = re.match(r"^/api/contracts/(\d+)$", path)
                if m:
                    contract = runtime.store.get_contract(int(m.group(1)))
                    if contract:
                        self._send_json(HTTPStatus.OK, contract)
                    else:
                        self._send_json(HTTPStatus.NOT_FOUND, {"error": "Contract not found"})
                    return

                m = re.match(r"^/api/contracts/(\d+)/pdf$", path)
                if m:
                    contract = runtime.store.get_contract(int(m.group(1)))
                    if not contract:
                        self._send_json(HTTPStatus.NOT_FOUND, {"error": "Contract not found"})
                        return
                    pdf_key = "signed_pdf_path" if contract.get("signed_pdf_path") else "pdf_path"
                    pdf_path = contract.get(pdf_key)
                    if not pdf_path or not Path(pdf_path).is_file():
                        self._send_json(HTTPStatus.NOT_FOUND, {"error": "PDF not generated yet"})
                        return
                    body = Path(pdf_path).read_bytes()
                    self.send_response(HTTPStatus.OK)
                    self.send_header("Content-Type", "application/pdf")
                    self.send_header("Content-Length", str(len(body)))
                    self.send_header("Content-Disposition", f'inline; filename="contract-{m.group(1)}.pdf"')
                    self._cors_headers()
                    self.end_headers()
                    self.wfile.write(body)
                    return

                # ── Settings (GET) ───────────────────────────────
                if path == "/api/settings":
                    self._send_json(HTTPStatus.OK, runtime.store.get_user_settings())
                    return

                # ── Seller Signing Page (GET) ────────────────────
                m = re.match(r"^/sign/([a-f0-9]+)$", path)
                if m:
                    token = m.group(1)
                    contract = runtime.store.get_contract_by_token(token)
                    if not contract:
                        self._send_html(HTTPStatus.NOT_FOUND, "<h1>Contract not found</h1><p>This signing link is invalid or has expired.</p>")
                        return
                    if contract["status"] == "fully_signed":
                        self._send_html(HTTPStatus.OK, "<h1>Already Signed</h1><p>This contract has already been fully signed. Thank you!</p>")
                        return
                    if contract["status"] == "voided":
                        self._send_html(HTTPStatus.OK, "<h1>Contract Voided</h1><p>This contract has been voided and is no longer valid.</p>")
                        return
                    html = _render_signing_page(contract)
                    self._send_html(HTTPStatus.OK, html)
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

                # ── Auth endpoints (no auth required) ─────────────────
                if path == "/api/auth/login":
                    body = self._read_json()
                    result = runtime.store.authenticate(
                        body.get("username", ""), body.get("password", ""),
                    )
                    if result:
                        self._send_json(HTTPStatus.OK, result)
                    else:
                        self._send_json(HTTPStatus.UNAUTHORIZED, {"error": "Invalid username or password"})
                    return

                if path == "/api/auth/logout":
                    auth = self.headers.get("Authorization", "")
                    if auth.startswith("Bearer "):
                        runtime.store.logout(auth[7:])
                    self._send_json(HTTPStatus.OK, {"status": "ok"})
                    return

                # ── Twilio voice webhooks (called BY Twilio, no auth) ──
                # The TwiML App's Voice Request URL points here. Twilio POSTs
                # form-encoded params and expects TwiML back.
                #  - Mode=session  → agent's browser leg joining the auto-dialer conference
                #  - otherwise     → single manual click-to-dial (dials "To")
                if path == "/twilio/voice":
                    length = int(self.headers.get("Content-Length") or "0")
                    raw = self.rfile.read(length) if length else b""
                    form = parse_qs(raw.decode("utf-8", "replace"))
                    mode = (form.get("Mode") or [""])[0]
                    from_id = (form.get("From") or [""])[0]
                    if mode == "session" and from_id.startswith("client:user_"):
                        try:
                            cid = int(from_id.split("user_", 1)[1])
                            xml = _twilio_conference_twiml(
                                _DialerManager.conference_name(cid), is_agent=True)
                        except (ValueError, IndexError):
                            xml = _twilio_hangup_twiml()
                    else:
                        xml = _twilio_voice_twiml((form.get("To") or [""])[0])
                    self._send_xml(xml)
                    return

                # Auto-dialer: a lead call was answered — Twilio has run AMD and
                # passes AnsweredBy. Bridge humans into the conference, hang up machines.
                if path == "/twilio/lead-answer":
                    q = parse_qs(urlparse(self.path).query)
                    length = int(self.headers.get("Content-Length") or "0")
                    raw = self.rfile.read(length) if length else b""
                    form = parse_qs(raw.decode("utf-8", "replace"))
                    caller_id = int((q.get("caller") or ["0"])[0] or 0)
                    lead_id = (q.get("lead") or [""])[0]
                    answered_by = (form.get("AnsweredBy") or [""])[0]
                    xml = _dialer.on_lead_answer(caller_id, lead_id, answered_by, runtime.store)
                    self._send_xml(xml)
                    return

                # ── Power dialer webhooks (called BY Twilio, no auth) ──
                if path in ("/pd/answer", "/pd/amd", "/pd/status", "/pd/agent-join"):
                    q = parse_qs(urlparse(self.path).query)
                    length = int(self.headers.get("Content-Length") or "0")
                    raw = self.rfile.read(length) if length else b""
                    form = parse_qs(raw.decode("utf-8", "replace"))
                    pd = _get_power_dialer(runtime)
                    leg = (q.get("leg") or [""])[0]
                    if path == "/pd/answer":
                        self._send_xml(pd.handle_answer(leg))
                    elif path == "/pd/agent-join":
                        self._send_xml(pd.agent_join_twiml((q.get("conf") or [""])[0]))
                    elif path == "/pd/amd":
                        pd.handle_amd(leg, (form.get("AnsweredBy") or [""])[0])
                        self._send_json(HTTPStatus.OK, {"status": "ok"})
                    else:  # /pd/status
                        try:
                            dur = int((form.get("CallDuration") or ["0"])[0] or 0)
                        except ValueError:
                            dur = 0
                        pd.handle_status(leg, (form.get("CallStatus") or [""])[0], dur)
                        self._send_json(HTTPStatus.OK, {"status": "ok"})
                    return

                # Power dialer: completed call recording (called BY Twilio, no auth).
                # Ack immediately, then download+ingest off-thread so Twilio isn't held.
                if path == "/pd/recording":
                    q = parse_qs(urlparse(self.path).query)
                    length = int(self.headers.get("Content-Length") or "0")
                    raw = self.rfile.read(length) if length else b""
                    form = parse_qs(raw.decode("utf-8", "replace"))
                    leg = (q.get("leg") or [""])[0]
                    rec_url = (form.get("RecordingUrl") or [""])[0]
                    rec_sid = (form.get("RecordingSid") or [""])[0]
                    call_sid = (form.get("CallSid") or [""])[0]
                    self._send_json(HTTPStatus.OK, {"status": "ok"})
                    if rec_url and rec_sid:
                        threading.Thread(
                            target=_pd_ingest_recording,
                            args=(runtime, leg, call_sid, rec_sid, rec_url),
                            daemon=True,
                        ).start()
                    return

                # Auto-dialer: terminal call status (no-answer/busy/failed/completed).
                if path == "/twilio/call-status":
                    q = parse_qs(urlparse(self.path).query)
                    length = int(self.headers.get("Content-Length") or "0")
                    raw = self.rfile.read(length) if length else b""
                    form = parse_qs(raw.decode("utf-8", "replace"))
                    caller_id = int((q.get("caller") or ["0"])[0] or 0)
                    lead_id = (q.get("lead") or [""])[0]
                    call_status = (form.get("CallStatus") or [""])[0]
                    try:
                        duration_sec = int((form.get("CallDuration") or ["0"])[0] or 0)
                    except ValueError:
                        duration_sec = 0
                    _dialer.on_call_status(caller_id, lead_id, call_status, runtime.store, duration_sec)
                    self._send_json(HTTPStatus.OK, {"status": "ok"})
                    return

                # ── User management (admin only) ──────────────────────
                if path == "/api/users":
                    user = self._require_role("admin")
                    if not user:
                        return
                    body = self._read_json()
                    try:
                        new_user = runtime.store.create_user(
                            username=body["username"],
                            display_name=body.get("display_name", body["username"]),
                            password=body["password"],
                            role=body.get("role", "caller"),
                            permissions=body.get("permissions"),
                        )
                        self._send_json(HTTPStatus.CREATED, new_user)
                    except Exception as exc:
                        self._send_json(HTTPStatus.BAD_REQUEST, {"error": str(exc)})
                    return

                m = re.match(r"^/api/users/(\d+)$", path)
                if m:
                    user = self._require_role("admin")
                    if not user:
                        return
                    user_id = int(m.group(1))
                    body = self._read_json()
                    if body.get("_delete"):
                        runtime.store.delete_user(user_id)
                        self._send_json(HTTPStatus.OK, {"status": "deleted"})
                    else:
                        updated = runtime.store.update_user(user_id, **body)
                        if updated:
                            self._send_json(HTTPStatus.OK, updated)
                        else:
                            self._send_json(HTTPStatus.NOT_FOUND, {"error": "User not found"})
                    return

                # ── Auth gate for dashboard API ───────────────────────
                if path.startswith("/api/"):
                    user = self._require_auth()
                    if not user:
                        return

                # ── Auto-dialer session control (POST) ────────────────
                # ── Power dialer control (authed) ─────────────────────
                if path == "/api/pd/start":
                    if not _twilio_ready():
                        self._send_json(HTTPStatus.SERVICE_UNAVAILABLE, {"error": "Twilio not configured"})
                        return
                    _get_power_dialer(runtime).start_agent(str(user["id"]))
                    self._send_json(HTTPStatus.OK, {"status": "started"})
                    return
                if path == "/api/pd/stop":
                    _get_power_dialer(runtime).stop_agent(str(user["id"]))
                    self._send_json(HTTPStatus.OK, {"status": "stopped"})
                    return
                if path == "/api/pd/disposition":
                    body = self._read_json()
                    ok = _get_power_dialer(runtime).submit_disposition(
                        str(user["id"]), str(body.get("code") or "contact_made"),
                        body.get("notes"), body.get("callback_at"), bool(body.get("dnc_request")))
                    self._send_json(HTTPStatus.OK, {"ok": ok})
                    return

                # End-of-day: grade all recordings that are transcribed but ungraded.
                if path == "/api/pd/recordings/grade-pending":
                    stats = runtime.store.call_recording_stats()
                    pending = stats.get("pending_grade", 0)
                    threading.Thread(target=_grade_pending_recordings,
                                     args=(runtime,), daemon=True).start()
                    self._send_json(HTTPStatus.OK, {"queued": pending})
                    return

                if path == "/api/dialer/session/start":
                    if not _twilio_ready():
                        self._send_json(HTTPStatus.SERVICE_UNAVAILABLE,
                                        {"error": "Twilio not configured"})
                        return
                    body = self._read_json()
                    raw_queue = body.get("queue") or []
                    queue = [
                        {"lead_id": str(item.get("lead_id")),
                         "phone": item.get("phone"),
                         "name": item.get("name")}
                        for item in raw_queue
                        if item.get("lead_id") and item.get("phone")
                    ]
                    if not queue:
                        self._send_json(HTTPStatus.BAD_REQUEST,
                                        {"error": "Empty queue (no leads with phone numbers)"})
                        return
                    base = _public_base_url() or "http://localhost:8765"
                    lines = int(body.get("lines") or 3)
                    st = _dialer.start(user["id"], queue, runtime.store, base, lines)
                    self._send_json(HTTPStatus.OK, st)
                    return

                if path == "/api/dialer/session/pause":
                    st = _dialer.pause(user["id"])
                    self._send_json(HTTPStatus.OK, st or {"status": "idle"})
                    return

                if path == "/api/dialer/session/resume":
                    st = _dialer.resume(user["id"], runtime.store)
                    self._send_json(HTTPStatus.OK, st or {"status": "idle"})
                    return

                if path == "/api/dialer/session/stop":
                    st = _dialer.stop(user["id"])
                    self._send_json(HTTPStatus.OK, st or {"status": "stopped"})
                    return

                if path == "/api/dialer/disposition":
                    body = self._read_json()
                    lead_id = str(body.get("lead_id") or "")
                    disposition = str(body.get("disposition") or "")
                    note = body.get("note")
                    if not lead_id or not disposition:
                        self._send_json(HTTPStatus.BAD_REQUEST,
                                        {"error": "lead_id and disposition required"})
                        return
                    st = _dialer.disposition(user["id"], lead_id, disposition, note, runtime.store)
                    self._send_json(HTTPStatus.OK, st or {"status": "idle"})
                    return

                # ── Schedule API (POST) ───────────────────────────────

                if path == "/api/schedule":
                    body = self._read_json()
                    target_user_id = user["id"]
                    if user["role"] == "admin" and body.get("user_id"):
                        target_user_id = int(body["user_id"])
                    entries = body.get("entries", [])
                    result = runtime.store.bulk_upsert_caller_availability(target_user_id, entries)
                    self._send_json(HTTPStatus.OK, result)
                    return

                if path == "/api/schedule/delete":
                    body = self._read_json()
                    target_user_id = user["id"]
                    if user["role"] == "admin" and body.get("user_id"):
                        target_user_id = int(body["user_id"])
                    result = runtime.store.delete_caller_availability(
                        target_user_id, body.get("date", ""), body.get("start_time"),
                    )
                    self._send_json(HTTPStatus.OK, result)
                    return

                # ── Lead Assignment API (POST) ────────────────────────

                if path == "/api/leads/assignments/auto":
                    if user["role"] != "admin":
                        self._send_json(HTTPStatus.FORBIDDEN, {"error": "Admin only"})
                        return
                    body = self._read_json()
                    caller_ids = body.get("caller_ids", [])
                    count = int(body.get("count_per_caller", 1000))
                    result = runtime.store.auto_assign_lists(caller_ids, count)
                    self._send_json(HTTPStatus.OK, result)
                    return

                if path == "/api/leads/assignments/assign":
                    if user["role"] != "admin":
                        self._send_json(HTTPStatus.FORBIDDEN, {"error": "Admin only"})
                        return
                    body = self._read_json()
                    result = runtime.store.assign_leads_to_caller(
                        int(body["user_id"]), body.get("lead_ids", []),
                    )
                    self._send_json(HTTPStatus.OK, result)
                    return

                if path == "/api/leads/assignments/assign-list":
                    if user["role"] != "admin":
                        self._send_json(HTTPStatus.FORBIDDEN, {"error": "Admin only"})
                        return
                    body = self._read_json()
                    uid_raw = body.get("user_id")
                    from_raw = body.get("from_user_id")
                    result = runtime.store.assign_list_to_caller(
                        body["list_name"],
                        int(uid_raw) if uid_raw is not None else None,
                        int(from_raw) if from_raw is not None else None,
                    )
                    self._send_json(HTTPStatus.OK, result)
                    return

                if path == "/api/leads/assignments/unassign":
                    if user["role"] != "admin":
                        self._send_json(HTTPStatus.FORBIDDEN, {"error": "Admin only"})
                        return
                    body = self._read_json()
                    result = runtime.store.unassign_leads(body.get("lead_ids", []))
                    self._send_json(HTTPStatus.OK, result)
                    return

                # ── Activity Tracking API (POST) ─────────────────────

                if path == "/api/activity/daily-log":
                    body = self._read_json()
                    target_id = user["id"]
                    if user["role"] == "admin" and body.get("user_id"):
                        target_id = int(body["user_id"])
                    result = runtime.store.submit_daily_log(
                        target_id,
                        body.get("log_date", ""),
                        float(body.get("hours_claimed", 0)),
                        int(body.get("dials_claimed", 0)),
                        int(body.get("leads_set_claimed", 0)),
                        body.get("notes"),
                    )
                    self._send_json(HTTPStatus.OK, result)
                    return

                # ── Finances API (POST) ───────────────────────────────

                if path == "/api/finances/expenses":
                    if user["role"] != "admin":
                        self._send_json(HTTPStatus.FORBIDDEN, {"error": "Admin only"})
                        return
                    body = self._read_json()
                    if body.get("_delete"):
                        result = runtime.store.delete_expense(int(body["id"]))
                    else:
                        result = runtime.store.upsert_expense(**body)
                    self._send_json(HTTPStatus.OK, result)
                    return

                if path == "/api/finances/revenue":
                    if user["role"] != "admin":
                        self._send_json(HTTPStatus.FORBIDDEN, {"error": "Admin only"})
                        return
                    body = self._read_json()
                    if body.get("_delete"):
                        result = runtime.store.delete_revenue(int(body["id"]))
                    else:
                        result = runtime.store.add_revenue(**body)
                    self._send_json(HTTPStatus.OK, result)
                    return

                if path == "/api/finances/payroll":
                    if user["role"] != "admin":
                        self._send_json(HTTPStatus.FORBIDDEN, {"error": "Admin only"})
                        return
                    body = self._read_json()
                    if body.get("_mark_paid"):
                        result = runtime.store.mark_payroll_paid(int(body["id"]))
                    else:
                        result = runtime.store.upsert_payroll(**body)
                    self._send_json(HTTPStatus.OK, result)
                    return

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
                        from .discord_notify import notify_set
                        _caller = user["display_name"] if user else "Unknown"
                        threading.Thread(
                            target=notify_set, args=(runtime.store, lead_id, _caller), daemon=True,
                        ).start()
                    self._send_json(HTTPStatus.OK, result)
                    return

                m = re.match(r"^/api/leads/([^/]+)/set$", path)
                if m:
                    lead_id = m.group(1)
                    body = self._read_json()
                    appointment_at = body.get("appointment_at", "")
                    notes = body.get("notes", "")
                    phone_number = body.get("phone_number")
                    caller_name = user["display_name"] if user else "Unknown"
                    caller_id = user["id"] if user else None
                    if notes:
                        runtime.store.add_lead_note(lead_id, "call_note", notes)
                    runtime.store.log_call_attempt(lead_id, "interested", notes or None, phone_number, caller_id=caller_id)
                    result = runtime.store.update_lead_status_api(lead_id, "interested", "Set booked — dial time")
                    if result.get("status") == "ok":
                        threading.Thread(
                            target=_run_underwriting_bg, args=(runtime, lead_id), daemon=True,
                        ).start()
                        if appointment_at:
                            runtime.store.create_follow_up(lead_id, "set", appointment_at, notes or None)
                        from .discord_notify import notify_set_appointment
                        threading.Thread(
                            target=notify_set_appointment,
                            args=(runtime.store, lead_id, caller_name, appointment_at, notes),
                            daemon=True,
                        ).start()
                    self._send_json(HTTPStatus.OK, {**result, "discord_sent": True})
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

                m = re.match(r"^/api/leads/([^/]+)/calls$", path)
                if m:
                    body = self._read_json()
                    result = runtime.store.log_call_attempt(
                        m.group(1),
                        body.get("disposition", "unknown"),
                        body.get("notes"),
                        body.get("phone_number"),
                        caller_id=user["id"] if user else None,
                    )
                    self._send_json(HTTPStatus.OK, result)
                    return

                if path == "/api/leads/attempt-counts":
                    body = self._read_json()
                    lead_ids = body.get("lead_ids")
                    result = runtime.store.get_lead_attempt_counts(lead_ids)
                    self._send_json(HTTPStatus.OK, result)
                    return

                if path == "/api/queue/requeue-stale":
                    body = self._read_json()
                    days = body.get("days_threshold", 10)
                    result = runtime.store.requeue_stale_leads(days_threshold=days)
                    self._send_json(HTTPStatus.OK, result)
                    return

                if path == "/api/queue/clean-bad-numbers":
                    result = runtime.store.clean_queue_bad_numbers()
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

                if path == "/api/sources/zillow_fsbo/scrape":
                    body = self._read_json()
                    markets = body.get("markets")
                    max_pages = body.get("max_pages", 3)

                    # Track status for the dashboard
                    runtime._zillow_fsbo_status = {
                        "running": True, "log": [], "markets": markets or ["cleveland-oh"],
                        "started_at": __import__('datetime').datetime.now().isoformat(),
                    }

                    def _log(msg: str) -> None:
                        print(msg)
                        if hasattr(runtime, '_zillow_fsbo_status'):
                            runtime._zillow_fsbo_status["log"].append(msg)

                    def _bg() -> None:
                        try:
                            from .zillow_fsbo import scrape_zillow_fsbo, ingest_fsbo_listings
                            listings = scrape_zillow_fsbo(
                                markets=markets,
                                max_pages=max_pages,
                                headless=False,
                                log_fn=_log,
                            )
                            result = ingest_fsbo_listings(runtime.store, listings, log_fn=_log)
                            runtime._zillow_fsbo_status["result"] = result
                        except Exception as exc:
                            _log(f"[zillow-fsbo] FATAL: {exc}")
                            runtime._zillow_fsbo_status["error"] = str(exc)
                        finally:
                            runtime._zillow_fsbo_status["running"] = False

                    threading.Thread(target=_bg, daemon=True).start()
                    self._send_json(HTTPStatus.OK, {
                        "status": "started",
                        "markets": markets or ["cleveland-oh"],
                    })
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

                if path == "/api/recordings/session":
                    result = _handle_session_upload(self, runtime)
                    self._send_json(HTTPStatus.OK, result)
                    return

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

                m = re.match(r"^/api/call-recordings/(\d+)/auto-link$", path)
                if m:
                    rec_id = int(m.group(1))
                    rec = runtime.store.get_call_recording(rec_id)
                    if not rec:
                        self._send_json(HTTPStatus.NOT_FOUND, {"error": "Recording not found"})
                        return
                    name = rec.get("seller_name", "")
                    addr = rec.get("property_address", "")
                    with runtime.store._connect() as conn:
                        name_clauses = []
                        name_params = []
                        for part in name.lower().split():
                            if len(part) > 2:
                                name_clauses.append("lower(o.owner_name) LIKE ?")
                                name_params.append(f"%{part}%")
                        addr_clauses = []
                        addr_params = []
                        if addr:
                            street_part = addr.split(",")[0].strip()
                            for word in street_part.lower().split():
                                if len(word) > 2 and word not in ("ave", "avenue", "st", "street", "rd", "road", "dr", "drive", "blvd", "ct", "ln", "pl", "way", "circle", "court", "lane", "place"):
                                    addr_clauses.append("lower(p.address_street) LIKE ?")
                                    addr_params.append(f"%{word}%")
                        if not name_clauses and not addr_clauses:
                            self._send_json(HTTPStatus.OK, {"status": "no_match", "matches": []})
                            return
                        if name_clauses and addr_clauses:
                            where = f"({' AND '.join(name_clauses)}) AND ({' AND '.join(addr_clauses)})"
                            params = name_params + addr_params
                        elif name_clauses:
                            where = " AND ".join(name_clauses)
                            params = name_params
                        else:
                            where = " AND ".join(addr_clauses)
                            params = addr_params
                        rows = conn.execute(
                            f"""SELECT l.lead_id, o.owner_name, p.address_street, p.address_city,
                                       p.address_state, l.status
                                FROM leads l
                                JOIN owners o ON l.owner_id = o.owner_id
                                JOIN properties p ON l.property_id = p.property_id
                                WHERE {where} LIMIT 5""",
                            params,
                        ).fetchall()
                    matches = [dict(r) for r in rows]
                    if len(matches) == 1:
                        runtime.store.update_call_recording(rec_id, {"lead_id": matches[0]["lead_id"]})
                        self._send_json(HTTPStatus.OK, {"status": "linked", "lead_id": matches[0]["lead_id"], "matches": matches})
                    else:
                        self._send_json(HTTPStatus.OK, {"status": "multiple" if matches else "no_match", "matches": matches})
                    return

                # ── Chat / Mega-Agent (POST) ──────────────────────
                if path == "/api/chat":
                    body = self._read_json()
                    message = body.get("message", "").strip()
                    if not message:
                        self._send_json(HTTPStatus.BAD_REQUEST, {"error": "message required"})
                        return
                    conversation_id = body.get("conversation_id")
                    result = runtime.mega.handle_message(
                        message=message,
                        user=user,
                        conversation_id=conversation_id,
                    )
                    self._send_json(HTTPStatus.OK, result)
                    return

                m = re.match(r"^/api/chat/confirm/(\d+)$", path)
                if m:
                    if user["role"] != "admin":
                        self._send_json(HTTPStatus.FORBIDDEN, {"error": "Admin only"})
                        return
                    self._read_json()
                    cid = int(m.group(1))
                    result = runtime.mega.handle_confirmation(cid, confirmed=True, user=user)
                    self._send_json(HTTPStatus.OK, result)
                    return

                m = re.match(r"^/api/chat/cancel/(\d+)$", path)
                if m:
                    self._read_json()
                    cid = int(m.group(1))
                    result = runtime.mega.handle_confirmation(cid, confirmed=False, user=user)
                    self._send_json(HTTPStatus.OK, result)
                    return

                # ── Agents (POST) ─────────────────────────────────
                m = re.match(r"^/api/agents/([a-z_]+)/run$", path)
                if m:
                    result = runtime.orchestrator.run_agent(m.group(1))
                    self._send_json(HTTPStatus.OK, result)
                    return

                m = re.match(r"^/api/agents/([a-z_]+)/stop$", path)
                if m:
                    result = runtime.orchestrator.stop_agent(m.group(1))
                    self._send_json(HTTPStatus.OK, result)
                    return

                m = re.match(r"^/api/agents/([a-z_]+)/toggle$", path)
                if m:
                    payload = self._read_json()
                    result = runtime.store.update_agent_config(
                        m.group(1), enabled=payload.get("enabled", True)
                    )
                    self._send_json(HTTPStatus.OK, result)
                    return

                m = re.match(r"^/api/agents/([a-z_]+)/config$", path)
                if m:
                    payload = self._read_json()
                    result = runtime.store.update_agent_config(
                        m.group(1),
                        schedule=payload.get("schedule"),
                        enabled=payload.get("enabled"),
                        config_json=json.dumps(payload.get("config")) if "config" in payload else None,
                        prompt_template=payload.get("prompt_template"),
                    )
                    self._send_json(HTTPStatus.OK, result)
                    return

                m = re.match(r"^/api/agents/proposals/(\d+)/approve$", path)
                if m:
                    pid = int(m.group(1))
                    runtime.store.resolve_proposal(pid, "approved")
                    result = runtime.store.execute_proposal_payload(pid)
                    proposal = runtime.store.get_proposal(pid)
                    if proposal:
                        pl = json.loads(proposal.get("payload_json", "{}"))
                        _execute_runtime_action(runtime, pl)
                    self._send_json(HTTPStatus.OK, result)
                    return

                m = re.match(r"^/api/agents/proposals/(\d+)/deny$", path)
                if m:
                    pid = int(m.group(1))
                    payload = self._read_json()
                    result = runtime.store.resolve_proposal(
                        pid, "denied", notes=payload.get("reason")
                    )
                    self._send_json(HTTPStatus.OK, result)
                    return

                m = re.match(r"^/api/agents/proposals/(\d+)/revise$", path)
                if m:
                    pid = int(m.group(1))
                    payload = self._read_json()
                    result = runtime.store.resolve_proposal(
                        pid, "revised", notes=payload.get("notes", "")
                    )
                    self._send_json(HTTPStatus.OK, result)
                    return

                if path == "/api/agents/proposals/bulk-approve":
                    payload = self._read_json()
                    ids = payload.get("ids", [])
                    results = []
                    for pid in ids:
                        runtime.store.resolve_proposal(pid, "approved")
                        results.append(runtime.store.execute_proposal_payload(pid))
                    self._send_json(HTTPStatus.OK, {"approved": len(ids), "results": results})
                    return

                if path == "/api/agents/proposals/bulk-deny":
                    payload = self._read_json()
                    ids = payload.get("ids", [])
                    reason = payload.get("reason")
                    for pid in ids:
                        runtime.store.resolve_proposal(pid, "denied", notes=reason)
                    self._send_json(HTTPStatus.OK, {"denied": len(ids)})
                    return

                # ── Contracts (POST) ─────────────────────────────
                if path == "/api/contracts":
                    body = self._read_json()
                    result = runtime.store.create_contract(body)
                    self._send_json(HTTPStatus.OK, result)
                    return

                m = re.match(r"^/api/contracts/(\d+)/sign$", path)
                if m:
                    body = self._read_json()
                    result = runtime.store.sign_contract(
                        int(m.group(1)),
                        body.get("role", "purchaser"),
                        body.get("signature", ""),
                    )
                    self._send_json(HTTPStatus.OK, result)
                    return

                m = re.match(r"^/api/contracts/(\d+)/send$", path)
                if m:
                    contract_id = int(m.group(1))
                    contract = runtime.store.get_contract(contract_id)
                    if not contract:
                        self._send_json(HTTPStatus.NOT_FOUND, {"error": "Contract not found"})
                        return
                    body = self._read_json()
                    seller_email = body.get("seller_email") or contract.get("seller_email")
                    if not seller_email:
                        self._send_json(HTTPStatus.BAD_REQUEST, {"error": "No seller email provided"})
                        return
                    runtime.store.update_contract(contract_id, {"seller_email": seller_email})
                    result = _send_contract_email(runtime, contract_id, seller_email)
                    self._send_json(HTTPStatus.OK, result)
                    return

                m = re.match(r"^/api/contracts/(\d+)/void$", path)
                if m:
                    result = runtime.store.void_contract(int(m.group(1)))
                    self._send_json(HTTPStatus.OK, result)
                    return

                m = re.match(r"^/api/contracts/(\d+)/upload-pdf$", path)
                if m:
                    contract_id = int(m.group(1))
                    length = int(self.headers.get("Content-Length") or "0")
                    pdf_data = self.rfile.read(length) if length else b""
                    contracts_dir = runtime.store.data_dir / "contracts"
                    contracts_dir.mkdir(parents=True, exist_ok=True)
                    pdf_path = str(contracts_dir / f"contract-{contract_id}.pdf")
                    Path(pdf_path).write_bytes(pdf_data)
                    contract = runtime.store.get_contract(contract_id)
                    key = "signed_pdf_path" if contract and contract.get("seller_signature") else "pdf_path"
                    runtime.store.update_contract(contract_id, {key: pdf_path})
                    self._send_json(HTTPStatus.OK, {"status": "ok", "path": pdf_path})
                    return

                # ── Settings (POST) ──────────────────────────────
                if path == "/api/settings":
                    body = self._read_json()
                    result = runtime.store.update_user_settings(body)
                    self._send_json(HTTPStatus.OK, result)
                    return

                # ── Seller Signing Page (POST) ───────────────────
                m = re.match(r"^/sign/([a-f0-9]+)$", path)
                if m:
                    token = m.group(1)
                    body = self._read_json()
                    result = runtime.store.sign_contract_by_token(
                        token, body.get("signature", ""),
                    )
                    self._send_json(HTTPStatus.OK, result)
                    return

                self._send_json(HTTPStatus.NOT_FOUND, {"error": "Not found"})

        return ThreadingHTTPServer((host, port), Handler)

    def serve_forever(self, host: str = "127.0.0.1", port: int = 8765) -> None:
        server = self.create_server(host=host, port=port)
        print(f"Hermes listening on {host}:{port}")

        # ── Twilio dialer readiness banner ────────────────────────
        # When Twilio creds are present the dialer needs a public tunnel up so
        # Twilio can reach /twilio/voice. Start it in the background (non-blocking)
        # and print the exact URL to paste into the TwiML App.
        _tw = _twilio_config()
        if _tw["account_sid"]:
            def _twilio_banner():
                url = _public_base_url(port)
                voice_url = (
                    f"{url}/twilio/voice" if url
                    else "http://localhost:8765/twilio/voice  (no public URL — set PUBLIC_BASE_URL or install cloudflared)"
                )
                # Persist the current voice URL so it's trivial to read each run
                # (the quick-tunnel URL rotates on every restart).
                try:
                    Path("/tmp/hermes-twilio-voice-url.txt").write_text(voice_url + "\n")
                except OSError:
                    pass
                if _twilio_ready():
                    synced = bool(url) and _twilio_sync_twiml_app(voice_url)
                    print(f"[twilio] Dialer READY. Voice webhook: {voice_url}", flush=True)
                    if synced:
                        print("[twilio] TwiML App Voice URL auto-synced to current tunnel. ✓", flush=True)
                    elif url:
                        print("[twilio] WARNING: could not auto-sync TwiML App Voice URL — check it in the console.", flush=True)
                else:
                    print("[twilio] Credentials loaded, but TWILIO_TWIML_APP_SID is not set yet.", flush=True)
                    print(f"[twilio] 1. Create a TwiML App with Voice Request URL = {voice_url}", flush=True)
                    print("[twilio] 2. Put its SID in .env as TWILIO_TWIML_APP_SID, then restart.", flush=True)
            threading.Thread(target=_twilio_banner, daemon=True).start()

        # On startup, check for phoneless leads and auto-trigger pipeline
        def _startup_check():
            import time
            time.sleep(5)
            pending = self.store.pending_verification_stats()
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


# ── Twilio Voice (browser dialer) ─────────────────────────────────

def _twilio_config() -> dict[str, str]:
    """Read Twilio credentials from the environment (loaded from repo .env)."""
    return {
        "account_sid": os.environ.get("TWILIO_ACCOUNT_SID", "").strip(),
        "auth_token": os.environ.get("TWILIO_AUTH_TOKEN", "").strip(),
        "api_key_sid": os.environ.get("TWILIO_API_KEY_SID", "").strip(),
        "api_key_secret": os.environ.get("TWILIO_API_KEY_SECRET", "").strip(),
        "phone_number": os.environ.get("TWILIO_PHONE_NUMBER", "").strip(),
        "twiml_app_sid": os.environ.get("TWILIO_TWIML_APP_SID", "").strip(),
    }


def _twilio_ready() -> bool:
    """True when every credential needed to place a browser call is present."""
    cfg = _twilio_config()
    return all([
        cfg["account_sid"], cfg["api_key_sid"], cfg["api_key_secret"],
        cfg["phone_number"], cfg["twiml_app_sid"],
    ])


def _b64url(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def _twilio_voice_token(identity: str, ttl: int = 3600) -> str | None:
    """Mint a Twilio Voice access token (JWT, HS256) in pure Python.

    The twilio SDK isn't installed and the rest of this server hand-rolls its
    dependencies, so we build the token directly: a standard JWT signed with the
    API Key Secret, carrying a Voice grant that points at our TwiML App.
    """
    cfg = _twilio_config()
    if not (cfg["account_sid"] and cfg["api_key_sid"]
            and cfg["api_key_secret"] and cfg["twiml_app_sid"]):
        return None
    now = int(time.time())
    header = {"typ": "JWT", "alg": "HS256", "cty": "twilio-fpa;v=1"}
    payload = {
        "jti": f"{cfg['api_key_sid']}-{now}",
        "iss": cfg["api_key_sid"],
        "sub": cfg["account_sid"],
        "iat": now,
        "nbf": now,
        "exp": now + ttl,
        "grants": {
            "identity": identity,
            "voice": {
                "incoming": {"allow": True},
                "outgoing": {"application_sid": cfg["twiml_app_sid"]},
            },
        },
    }
    signing_input = (
        _b64url(json.dumps(header, separators=(",", ":")).encode())
        + "."
        + _b64url(json.dumps(payload, separators=(",", ":")).encode())
    )
    signature = hmac.new(
        cfg["api_key_secret"].encode(), signing_input.encode(), hashlib.sha256,
    ).digest()
    return signing_input + "." + _b64url(signature)


def _twilio_sync_twiml_app(voice_url: str) -> bool:
    """Point our TwiML App's Voice URL at the current tunnel via the Twilio API.

    The cloudflared quick-tunnel URL rotates on every restart, so we re-sync the
    TwiML App on startup — this keeps browser calls working without any manual
    console edits after the one-time setup.
    """
    import urllib.request
    import urllib.parse
    import urllib.error

    cfg = _twilio_config()
    if not (cfg["account_sid"] and cfg["auth_token"] and cfg["twiml_app_sid"]):
        return False
    api = (
        f"https://api.twilio.com/2010-04-01/Accounts/{cfg['account_sid']}"
        f"/Applications/{cfg['twiml_app_sid']}.json"
    )
    data = urllib.parse.urlencode({"VoiceUrl": voice_url, "VoiceMethod": "POST"}).encode()
    auth = base64.b64encode(
        f"{cfg['account_sid']}:{cfg['auth_token']}".encode()
    ).decode()
    req = urllib.request.Request(api, data=data, headers={"Authorization": f"Basic {auth}"})
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            return 200 <= resp.status < 300
    except (urllib.error.URLError, OSError):
        return False


def _twilio_api_post(path: str, params: dict[str, str]) -> dict[str, Any] | None:
    """POST to the Twilio REST API with account basic auth. Returns parsed JSON or None."""
    import urllib.request
    import urllib.parse
    import urllib.error

    cfg = _twilio_config()
    if not (cfg["account_sid"] and cfg["auth_token"]):
        return None
    url = f"https://api.twilio.com/2010-04-01/Accounts/{cfg['account_sid']}{path}"
    data = urllib.parse.urlencode(params).encode()
    auth = base64.b64encode(f"{cfg['account_sid']}:{cfg['auth_token']}".encode()).decode()
    req = urllib.request.Request(url, data=data, headers={"Authorization": f"Basic {auth}"})
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        try:
            return {"_error": json.loads(exc.read().decode("utf-8"))}
        except Exception:
            return {"_error": {"status": exc.code}}
    except (urllib.error.URLError, OSError):
        return None


def _twilio_api_get(path: str) -> dict[str, Any] | None:
    """GET from the Twilio REST API with account basic auth. Returns parsed JSON or None."""
    import urllib.request
    import urllib.error

    cfg = _twilio_config()
    if not (cfg["account_sid"] and cfg["auth_token"]):
        return None
    url = f"https://api.twilio.com/2010-04-01/Accounts/{cfg['account_sid']}{path}"
    auth = base64.b64encode(f"{cfg['account_sid']}:{cfg['auth_token']}".encode()).decode()
    req = urllib.request.Request(url, headers={"Authorization": f"Basic {auth}"})
    try:
        with urllib.request.urlopen(req, timeout=12) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        try:
            return {"_error": json.loads(exc.read().decode("utf-8"))}
        except Exception:
            return {"_error": {"status": exc.code}}
    except (urllib.error.URLError, OSError):
        return None


def _twilio_api_delete(path: str) -> bool:
    """DELETE a Twilio REST resource (e.g. /Recordings/{sid}.json). Twilio returns
    HTTP 204 with an empty body on success, so treat any 2xx as deleted. Returns
    True on success. Used to purge the cloud-side recording copy after local download."""
    import urllib.request
    import urllib.error

    cfg = _twilio_config()
    if not (cfg["account_sid"] and cfg["auth_token"]):
        return False
    url = f"https://api.twilio.com/2010-04-01/Accounts/{cfg['account_sid']}{path}"
    auth = base64.b64encode(f"{cfg['account_sid']}:{cfg['auth_token']}".encode()).decode()
    req = urllib.request.Request(url, method="DELETE", headers={"Authorization": f"Basic {auth}"})
    try:
        with urllib.request.urlopen(req, timeout=12) as resp:
            return 200 <= resp.status < 300
    except urllib.error.HTTPError as exc:
        return 200 <= exc.code < 300
    except (urllib.error.URLError, OSError):
        return False


def _twilio_download(url: str, dest_path: str) -> bool:
    """Download a Twilio media URL (e.g. a RecordingUrl) to a local path using account
    basic auth. Returns True on success. The audio never persists off-machine — this
    pulls it local so the Twilio copy can be deleted."""
    import urllib.request
    import urllib.error

    cfg = _twilio_config()
    if not (cfg["account_sid"] and cfg["auth_token"]):
        return False
    auth = base64.b64encode(f"{cfg['account_sid']}:{cfg['auth_token']}".encode()).decode()
    req = urllib.request.Request(url, headers={"Authorization": f"Basic {auth}"})
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            data = resp.read()
        Path(dest_path).write_bytes(data)
        return len(data) > 0
    except (urllib.error.URLError, urllib.error.HTTPError, OSError) as exc:
        print(f"[pd-recording] download failed: {exc}", flush=True)
        return False


def _pd_ingest_recording(runtime: "HermesRuntime", leg_ref: str, call_sid: str,
                         recording_sid: str, recording_url: str) -> None:
    """Ingest a completed PowerDialer call recording: download the audio locally,
    DELETE the Twilio-side copy, register it in the recordings store linked to its
    lead, then transcribe immediately (grading is deferred to end-of-day)."""
    if not (recording_url and recording_sid):
        return
    import uuid
    recordings_dir = runtime.store.data_dir / "recordings"
    recordings_dir.mkdir(parents=True, exist_ok=True)
    file_name = f"pd_{call_sid or recording_sid}.mp3"
    safe_name = f"{uuid.uuid4().hex}_{file_name}"
    file_path = str(recordings_dir / safe_name)

    # Twilio media URL: append .mp3 for the audio (the callback URL has no extension).
    media_url = recording_url if recording_url.endswith(".mp3") else recording_url + ".mp3"
    if not _twilio_download(media_url, file_path):
        return

    # Purge the cloud copy — the recording now lives only on this machine.
    if not _twilio_api_delete(f"/Recordings/{recording_sid}.json"):
        print(f"[pd-recording] WARN: could not delete Twilio copy {recording_sid}", flush=True)

    ctx = None
    try:
        ctx = _get_power_dialer(runtime).recording_context(call_sid)
    except Exception as exc:
        print(f"[pd-recording] lead lookup failed for {call_sid}: {exc}", flush=True)

    data = {
        "seller_name": (ctx or {}).get("seller_name") or "Unknown",
        "property_address": (ctx or {}).get("property_address"),
        "call_date": datetime.now(timezone.utc).isoformat(),
        "file_path": file_path,
        "file_name": file_name,
        "file_type": "mp3",
        "lead_id": (ctx or {}).get("lead_id"),
        "notes": "Power dialer (auto)",
    }
    result = runtime.store.create_call_recording(data)
    rec_id = result.get("id")
    if not rec_id:
        return
    # Transcribe now (local whisper) for a live transcript; DEFER grading to the
    # end-of-day batch (manual button / nightly scheduler).
    threading.Thread(target=_transcribe_and_grade, args=(runtime, rec_id),
                     kwargs={"grade": False}, daemon=True).start()


def _twilio_usage() -> dict[str, Any]:
    """Live Twilio account balance + actual spend (today / this month), straight
    from Twilio — these are CONFIRMED charges, not the dialer's estimate. Balance
    is real remaining funds; spend lags a few minutes as Twilio prices each call."""
    def _spend(subresource: str) -> float:
        rec = _twilio_api_get(f"/Usage/Records/{subresource}.json?Category=totalprice")
        rows = (rec or {}).get("usage_records") or []
        try:
            return abs(float(rows[0].get("price"))) if rows and rows[0].get("price") else 0.0
        except (TypeError, ValueError):
            return 0.0

    bal = _twilio_api_get("/Balance.json") or {}
    balance = None
    try:
        balance = float(bal.get("balance")) if bal.get("balance") is not None else None
    except (TypeError, ValueError):
        balance = None
    return {
        "configured": bool(_twilio_config()["account_sid"] and _twilio_config()["auth_token"]),
        "balance": balance,
        "currency": bal.get("currency") or "USD",
        "spend_today": _spend("Today"),
        "spend_this_month": _spend("ThisMonth"),
        "spend_last_30d": _spend("LastMonth") + _spend("ThisMonth"),
        "as_of": datetime.now(timezone.utc).isoformat(),
    }


def _twilio_create_call(
    to_number: str, answer_url: str, status_callback: str, *, amd: bool = True,
) -> str | None:
    """Originate an outbound call via Twilio. Returns the Call SID, or None on failure.

    With machine detection enabled, Twilio delays the request to `answer_url`
    until it has classified the pickup, passing `AnsweredBy` — so we can bridge
    humans to the agent and hang up on machines before any audio reaches them.
    """
    cfg = _twilio_config()
    if not cfg["phone_number"]:
        return None
    params = {
        "To": to_number,
        "From": cfg["phone_number"],
        "Url": answer_url,
        "Method": "POST",
        "StatusCallback": status_callback,
        "StatusCallbackMethod": "POST",
        "StatusCallbackEvent": "completed",
        "Timeout": "22",
    }
    if amd:
        # Give AMD enough time to classify carrier "not in service" intercepts and
        # long machine greetings as machines (a 5s cap timed out to 'unknown', which
        # then bridged robots to the agent). A clear human is still detected in ~2-4s.
        params["MachineDetection"] = "Enable"
        params["MachineDetectionTimeout"] = "12"
    resp = _twilio_api_post("/Calls.json", params)
    if resp and resp.get("sid"):
        return resp["sid"]
    return None


def _twilio_hangup_call(call_sid: str) -> bool:
    """Force-complete an in-progress call (used to drop machines / extra pickups)."""
    if not call_sid:
        return False
    resp = _twilio_api_post(f"/Calls/{call_sid}.json", {"Status": "completed"})
    return bool(resp and not resp.get("_error"))


def _twilio_voice_twiml(to_number: str) -> str:
    """Build the TwiML that dials the lead, using our Twilio number as caller ID."""
    cfg = _twilio_config()

    def _esc(s: str) -> str:
        return (s.replace("&", "&amp;").replace("<", "&lt;")
                 .replace(">", "&gt;").replace('"', "&quot;"))

    to_number = (to_number or "").strip()
    if not to_number:
        return ('<?xml version="1.0" encoding="UTF-8"?>'
                "<Response><Say>No number was provided to dial.</Say></Response>")
    return (
        '<?xml version="1.0" encoding="UTF-8"?>'
        f'<Response><Dial answerOnBridge="true" callerId="{_esc(cfg["phone_number"])}">'
        f"<Number>{_esc(to_number)}</Number></Dial></Response>"
    )


def _twilio_hangup_twiml() -> str:
    return '<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>'


def _twilio_conference_twiml(conference_name: str, *, is_agent: bool) -> str:
    """TwiML that joins a caller into the agent's session conference.

    The agent leg opens/holds the conference (hearing hold music between leads);
    a lead leg joins an already-running conference and leaving it doesn't end
    the agent's session.
    """
    esc = (conference_name.replace("&", "&amp;").replace("<", "&lt;")
           .replace(">", "&gt;").replace('"', "&quot;"))
    if is_agent:
        return (
            '<?xml version="1.0" encoding="UTF-8"?>'
            '<Response><Dial><Conference startConferenceOnEnter="true" '
            'endConferenceOnExit="true" beep="false">'
            f"{esc}</Conference></Dial></Response>"
        )
    return (
        '<?xml version="1.0" encoding="UTF-8"?>'
        '<Response><Dial><Conference startConferenceOnEnter="false" '
        'endConferenceOnExit="false" beep="false">'
        f"{esc}</Conference></Dial></Response>"
    )


def _to_e164(phone: str | None) -> str | None:
    """Best-effort normalize a US phone string to E.164 (+1XXXXXXXXXX)."""
    if not phone:
        return None
    p = phone.strip()
    if p.startswith("+"):
        digits = re.sub(r"\D", "", p)
        return f"+{digits}" if len(digits) >= 11 else None
    digits = re.sub(r"\D", "", p)
    if len(digits) == 10:
        return f"+1{digits}"
    if len(digits) == 11 and digits.startswith("1"):
        return f"+{digits}"
    return None


# Dispositions the agent picks that should also transition the lead's pipeline status.
_DISPOSITION_STATUS = {"interested": "interested", "not_interested": "not_interested"}

# Approximate Twilio rates (USD) for the live cost meter. US defaults — adjust if
# your account's rates differ. Exact billing always shows in the Twilio console.
_RATE_OUTBOUND_PER_MIN = 0.014   # server-originated call to the lead
_RATE_CLIENT_PER_MIN = 0.004     # agent's browser leg sitting in the conference
_FEE_AMD_PER_CALL = 0.0075       # answering-machine detection, per dialed number


class _DialerManager:
    """Event-driven, per-caller auto-dialer session state machine (Phase 1: single line).

    No polling loop: each Twilio webhook (AMD result, call status) or agent action
    (disposition) drives the next dial synchronously. A caller sits in a private
    conference the whole session; humans get bridged in, machines/no-answers get
    auto-logged and skipped, and the next lead is dialed automatically.
    """

    def __init__(self) -> None:
        self._lock = threading.RLock()
        self._sessions: dict[int, dict[str, Any]] = {}

    @staticmethod
    def conference_name(caller_id: int) -> str:
        return f"session-{caller_id}"

    # ── lifecycle ────────────────────────────────────────────────
    def start(self, caller_id: int, queue: list[dict], store: Any, base_url: str,
              lines: int = 3) -> dict:
        with self._lock:
            session = {
                "caller_id": caller_id,
                "conference": self.conference_name(caller_id),
                "status": "active",   # active|dialing|connected|paused|stopped|completed
                "queue": queue,
                "cursor": 0,
                "lines": max(1, min(int(lines or 3), 5)),
                "inflight": {},       # lead_id -> {phone, name, call_sid}: calls dialed, not resolved
                "connected": None,    # {lead_id, phone, name, call_sid}: the bridged human
                "feed": [],           # recent auto-dispositions for the UI
                "stats": {"dialed": 0, "connected": 0, "machine": 0, "no_answer": 0, "bad": 0},
                "started_at": time.time(),
                "billable_minutes": 0,   # sum of ceil(CallDuration/60) across lead legs
                "base_url": base_url.rstrip("/"),
            }
            self._sessions[caller_id] = session
            print(f"[dialer] session start caller={caller_id} queue={len(queue)} lines={session['lines']}", flush=True)
            self._fill(session, store)
            print(f"[dialer] after fill: status={session['status']} dialing_lines={len(session['inflight'])} dialed={session['stats']['dialed']}", flush=True)
            return self._public(session)

    def pause(self, caller_id: int) -> dict | None:
        with self._lock:
            s = self._sessions.get(caller_id)
            if not s:
                return None
            if s["status"] != "connected":
                s["status"] = "paused"
            s["paused_flag"] = True
            return self._public(s)

    def resume(self, caller_id: int, store: Any) -> dict | None:
        with self._lock:
            s = self._sessions.get(caller_id)
            if not s:
                return None
            s["paused_flag"] = False
            if s["status"] == "paused":
                s["status"] = "active"
                self._fill(s, store)
            return self._public(s)

    def stop(self, caller_id: int) -> dict | None:
        with self._lock:
            s = self._sessions.pop(caller_id, None)
            if not s:
                return None
            if s.get("connected") and s["connected"].get("call_sid"):
                _twilio_hangup_call(s["connected"]["call_sid"])
            for info in s.get("inflight", {}).values():
                if info.get("call_sid"):
                    _twilio_hangup_call(info["call_sid"])
            s["inflight"] = {}
            s["connected"] = None
            s["status"] = "stopped"
            return self._public(s)

    def state(self, caller_id: int) -> dict | None:
        with self._lock:
            s = self._sessions.get(caller_id)
            return self._public(s) if s else None

    # ── Twilio webhook hooks ─────────────────────────────────────
    def on_lead_answer(self, caller_id: int, lead_id: str, answered_by: str | None, store: Any) -> str:
        """TwiML for an answered lead call. First human wins the race → bridged and
        the other in-flight lines are cancelled (and re-queued). Machines get logged
        as voicemail and hung up; a human that answers while we're already on a call
        is re-queued for a later round."""
        with self._lock:
            s = self._sessions.get(caller_id)
            if not s:
                return _twilio_hangup_twiml()
            info = s["inflight"].get(lead_id)
            if not info:
                return _twilio_hangup_twiml()   # already cancelled / stale

            answered = (answered_by or "").lower()
            # STRICT: only a confirmed human is bridged to the agent. Machine
            # greetings, fax, carrier "not in service" intercepts, and 'unknown'
            # (AMD couldn't confirm a human) are all auto-dropped — the agent never
            # hears a robot. Machines log as voicemail; unclassified as no-answer
            # (re-queued for a later retry in case it was a hard-to-detect human).
            if answered != "human":
                if answered.startswith(("machine", "fax")):
                    self._log(s, store, {"lead_id": lead_id, **info}, "voicemail")
                    s["stats"]["machine"] += 1
                else:
                    self._log(s, store, {"lead_id": lead_id, **info}, "no_answer")
                    s["stats"]["no_answer"] += 1
                del s["inflight"][lead_id]
                self._fill(s, store)
                return _twilio_hangup_twiml()

            # Confirmed human.
            if s.get("connected") is None:
                s["connected"] = {"lead_id": lead_id, **info}
                del s["inflight"][lead_id]
                s["status"] = "connected"
                s["stats"]["connected"] += 1
                self._cancel_inflight(s)   # drop the other racing lines
                return _twilio_conference_twiml(s["conference"], is_agent=False)

            # We already have a live human — re-queue this extra pickup and hang up.
            s["queue"].append({"lead_id": lead_id, "phone": info["phone"], "name": info.get("name")})
            del s["inflight"][lead_id]
            return _twilio_hangup_twiml()

    def on_call_status(self, caller_id: int, lead_id: str, call_status: str,
                       store: Any, duration_sec: int = 0) -> None:
        with self._lock:
            s = self._sessions.get(caller_id)
            if not s:
                return
            # Twilio bills each connected leg rounded up to the next minute (session-level).
            if duration_sec > 0:
                s["billable_minutes"] += (duration_sec + 59) // 60
            # The bridged human's call ending: keep it until the agent dispositions.
            if s.get("connected") and s["connected"]["lead_id"] == lead_id:
                return
            info = s["inflight"].get(lead_id)
            if not info:
                return   # cancelled sibling or already handled
            if call_status in ("no-answer", "busy", "canceled"):
                self._log(s, store, {"lead_id": lead_id, **info}, "no_answer")
                s["stats"]["no_answer"] += 1
            elif call_status == "failed":
                self._log(s, store, {"lead_id": lead_id, **info}, "bad_number")
                s["stats"]["bad"] += 1
            # 'completed' with no human was handled in on_lead_answer already.
            s["inflight"].pop(lead_id, None)
            self._fill(s, store)

    # ── agent action ─────────────────────────────────────────────
    def disposition(self, caller_id: int, lead_id: str, disposition: str, note: str | None, store: Any) -> dict | None:
        with self._lock:
            s = self._sessions.get(caller_id)
            if not s:
                return None
            conn = s.get("connected")
            lead = conn if (conn and conn["lead_id"] == lead_id) else {"lead_id": lead_id}
            self._log(s, store, lead, disposition, note)
            if conn and conn.get("call_sid"):
                _twilio_hangup_call(conn["call_sid"])
            s["connected"] = None
            if s.get("paused_flag"):
                s["status"] = "paused"
            else:
                s["status"] = "active"
                self._fill(s, store)   # start the next round
            return self._public(s)

    # ── internals (must hold lock) ───────────────────────────────
    def _cancel_inflight(self, s: dict) -> None:
        """Hang up every still-ringing line and re-queue those leads for a later round."""
        for lid, info in list(s["inflight"].items()):
            if info.get("call_sid"):
                _twilio_hangup_call(info["call_sid"])
            s["queue"].append({"lead_id": lid, "phone": info["phone"], "name": info.get("name")})
        s["inflight"] = {}

    def _fill(self, s: dict, store: Any) -> None:
        """Keep up to `lines` calls in flight while searching for a human."""
        import urllib.parse
        if s["status"] in ("paused", "stopped", "connected") or s.get("paused_flag"):
            return
        while len(s["inflight"]) < s["lines"] and s["cursor"] < len(s["queue"]):
            lead = s["queue"][s["cursor"]]
            s["cursor"] += 1
            lead_id = lead["lead_id"]
            if lead_id in s["inflight"]:
                continue
            phone = _to_e164(lead.get("phone"))
            if not phone:
                self._log(s, store, lead, "bad_number")
                s["stats"]["bad"] += 1
                continue
            q = urllib.parse.urlencode({"caller": s["caller_id"], "lead": lead_id})
            answer_url = f"{s['base_url']}/twilio/lead-answer?{q}"
            status_cb = f"{s['base_url']}/twilio/call-status?{q}"
            call_sid = _twilio_create_call(phone, answer_url, status_cb, amd=True)
            if not call_sid:
                print(f"[dialer] dial FAILED {lead_id} -> {phone}", flush=True)
                self._log(s, store, lead, "bad_number")
                s["stats"]["bad"] += 1
                continue
            print(f"[dialer] dialing {lead_id} -> {phone} sid={call_sid}", flush=True)
            s["inflight"][lead_id] = {"phone": phone, "name": lead.get("name"), "call_sid": call_sid}
            s["stats"]["dialed"] += 1
        # Nothing in flight and nothing left to dial → the list is done.
        if not s["inflight"] and s["cursor"] >= len(s["queue"]) and not s.get("connected"):
            s["status"] = "completed"
        elif s["status"] != "connected":
            s["status"] = "dialing" if s["inflight"] else "active"

    def _log(self, s: dict, store: Any, lead: dict, disposition: str, note: str | None = None) -> None:
        lead_id = lead.get("lead_id")
        if not lead_id:
            return
        digits = re.sub(r"\D", "", lead.get("phone") or "") or None
        try:
            store.log_call_attempt(lead_id, disposition, note, phone_number=digits, caller_id=s["caller_id"])
            if disposition in _DISPOSITION_STATUS:
                store.update_lead_status_api(lead_id, _DISPOSITION_STATUS[disposition], "Auto-dialer disposition")
        except Exception as exc:  # never let a logging failure break the dial loop
            print(f"[dialer] log_call_attempt failed for {lead_id}: {exc}", flush=True)
        s["feed"].append({
            "lead_id": lead_id, "name": lead.get("name"),
            "disposition": disposition, "at": datetime.now(timezone.utc).isoformat(),
        })
        s["feed"] = s["feed"][-25:]

    def _cost(self, s: dict) -> dict:
        agent_min = max(0.0, (time.time() - s.get("started_at", time.time())) / 60.0)
        detection = s["stats"]["dialed"] * _FEE_AMD_PER_CALL
        talk = s["billable_minutes"] * _RATE_OUTBOUND_PER_MIN
        agent = agent_min * _RATE_CLIENT_PER_MIN
        return {
            "total": round(detection + talk + agent, 2),
            "detection": round(detection, 2),
            "talk": round(talk, 2),
            "session_leg": round(agent, 2),
            "billable_minutes": s["billable_minutes"],
            "session_minutes": round(agent_min, 1),
        }

    def _public(self, s: dict) -> dict:
        conn = s.get("connected")
        return {
            "status": s["status"],
            "paused": bool(s.get("paused_flag")),
            "conference": s["conference"],
            "lines": s.get("lines", 3),
            "dialing_lines": len(s.get("inflight", {})),
            "current": ({"lead_id": conn["lead_id"], "name": conn.get("name"), "phone": conn.get("phone")}
                        if conn else None),
            "cursor": s["cursor"],
            "total": len(s["queue"]),
            "feed": s["feed"][-25:],
            "stats": s["stats"],
            "cost": self._cost(s),
        }


_dialer = _DialerManager()

# ── Power dialer (spec build) — lazy singleton ────────────────────
_power_dialer = None


def _get_power_dialer(runtime: "HermesRuntime"):
    global _power_dialer
    if _power_dialer is None:
        from .power_dialer_engine import PowerDialer
        from .carrier import TwilioCarrierAdapter
        _power_dialer = PowerDialer(str(runtime.store.db_path), TwilioCarrierAdapter())
        try:
            _power_dialer.recover_orphans()   # spec §12: clean up any crash-stranded state
        except Exception as exc:
            print(f"[pd] orphan recovery skipped: {exc}", flush=True)
        try:
            n = _power_dialer.sync_did_pool()   # PD-7: local-presence caller-ID pool
            if n:
                print(f"[pd] DID pool synced: {n} owned number(s)", flush=True)
        except Exception as exc:
            print(f"[pd] DID pool sync skipped: {exc}", flush=True)
    return _power_dialer


_tunnel_process: subprocess.Popen | None = None
_tunnel_url: str | None = None


def _start_tunnel(port: int = 8765) -> str | None:
    """Start a cloudflared quick tunnel and return the public URL."""
    global _tunnel_process, _tunnel_url
    if _tunnel_process and _tunnel_process.poll() is None:
        return _tunnel_url

    try:
        _tunnel_process = subprocess.Popen(
            ["cloudflared", "tunnel", "--url", f"http://localhost:{port}"],
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
        )
        import time as _time
        deadline = _time.time() + 15
        while _time.time() < deadline:
            line = _tunnel_process.stdout.readline()
            if not line:
                break
            m = re.search(r"(https://[a-z0-9\-]+\.trycloudflare\.com)", line)
            if m:
                _tunnel_url = m.group(1)
                return _tunnel_url
    except FileNotFoundError:
        pass
    return None


def _public_base_url(port: int = 8765) -> str | None:
    """Preferred public base URL (scheme+host, no trailing slash) for webhooks/links.

    Uses PUBLIC_BASE_URL — the stable cloudflared named-tunnel domain
    (https://api.swarmdispo.com) — when set. Falls back to a rotating quick
    tunnel only if no stable domain is configured.
    """
    explicit = os.environ.get("PUBLIC_BASE_URL", "").strip().rstrip("/")
    if explicit:
        return explicit
    return _start_tunnel(port)


def _send_contract_email(
    runtime: "HermesRuntime", contract_id: int, seller_email: str
) -> dict[str, Any]:
    """Send the contract signing link to the seller via Gmail SMTP."""
    import smtplib
    from email.mime.text import MIMEText
    from email.mime.multipart import MIMEMultipart

    settings = runtime.store.get_user_settings()
    gmail_user = settings.get("gmail_user", "")
    gmail_app_password = settings.get("gmail_app_password", "")
    if not gmail_user or not gmail_app_password:
        return {"status": "error", "message": "Gmail credentials not configured. Go to Settings to set up."}

    contract = runtime.store.get_contract(contract_id)
    if not contract:
        return {"status": "error", "message": "Contract not found"}

    base_url = _public_base_url()
    if base_url:
        signing_url = f"{base_url}/sign/{contract['signing_token']}"
    else:
        signing_url = f"http://localhost:8765/sign/{contract['signing_token']}"

    runtime.store.update_contract(contract_id, {"signing_url": signing_url, "status": "pending_seller"})

    purchaser_name = contract.get("purchaser_name") or "the buyer"
    property_addr = contract.get("property_address") or "the property"

    msg = MIMEMultipart("alternative")
    msg["Subject"] = f"Option Agreement for {property_addr} - Signature Required"
    msg["From"] = gmail_user
    msg["To"] = seller_email

    html_body = f"""
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
      <h2 style="color: #1e293b;">Option Agreement - Signature Required</h2>
      <p>Hello {contract.get('seller_name', 'there')},</p>
      <p>You have received an Option Agreement from <strong>{purchaser_name}</strong> for the property at:</p>
      <p style="font-size: 18px; font-weight: bold; color: #4f46e5; padding: 12px; background: #f1f5f9; border-radius: 8px;">
        {property_addr}
      </p>
      <p><strong>Purchase Price:</strong> ${contract.get('purchase_price', 0):,}</p>
      <p><strong>Option Fee:</strong> ${contract.get('option_fee', 0):,}</p>
      <p>Please review and sign the contract by clicking the button below:</p>
      <a href="{signing_url}"
         style="display: inline-block; padding: 14px 28px; background: #4f46e5; color: white;
                text-decoration: none; border-radius: 8px; font-weight: bold; font-size: 16px;">
        Review &amp; Sign Contract
      </a>
      <p style="margin-top: 24px; color: #64748b; font-size: 13px;">
        If the button doesn't work, copy and paste this link into your browser:<br>
        <a href="{signing_url}" style="color: #4f46e5;">{signing_url}</a>
      </p>
    </div>
    """

    msg.attach(MIMEText(html_body, "html"))

    now = datetime.now(timezone.utc).isoformat()

    try:
        with smtplib.SMTP_SSL("smtp.gmail.com", 465) as server:
            server.login(gmail_user, gmail_app_password)
            server.send_message(msg)
        runtime.store.update_contract(contract_id, {"signing_email_sent_at": now})
        return {"status": "ok", "signing_url": signing_url, "email_sent_to": seller_email}
    except Exception as e:
        return {"status": "error", "message": f"Email failed: {e}"}


def _number_to_words(n: int) -> str:
    """Convert an integer to English words for contract text."""
    if n == 0:
        return "Zero"
    ones = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
            "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen",
            "Seventeen", "Eighteen", "Nineteen"]
    tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"]
    if n < 0:
        return "Negative " + _number_to_words(-n)
    result = ""
    if n >= 1_000_000:
        result += _number_to_words(n // 1_000_000) + " Million "
        n %= 1_000_000
    if n >= 1_000:
        result += _number_to_words(n // 1_000) + " Thousand "
        n %= 1_000
    if n >= 100:
        result += ones[n // 100] + " Hundred "
        n %= 100
    if n >= 20:
        result += tens[n // 10] + " "
        n %= 10
    if n > 0:
        result += ones[n] + " "
    return result.strip()


def _render_signing_page(contract: dict[str, Any]) -> str:
    """Render a self-contained HTML signing page with the full contract text."""
    contract_data = {}
    try:
        contract_data = json.loads(contract.get("contract_data_json") or "{}")
    except Exception:
        pass

    purchaser_name = contract.get("purchaser_name") or contract_data.get("purchaser_name", "")
    purchaser_address = contract.get("purchaser_address") or contract_data.get("purchaser_address", "")
    seller_name = contract.get("seller_name") or contract_data.get("seller_name", "")
    seller_address = contract.get("seller_address") or contract_data.get("seller_address", "")
    property_address = contract.get("property_address") or contract_data.get("property_address", "")
    property_county = contract.get("property_county") or contract_data.get("property_county", "")
    property_state = contract.get("property_state") or contract_data.get("property_state", "")
    purchase_price = contract.get("purchase_price") or 0
    option_fee = contract.get("option_fee") or 0
    amount_due = contract.get("amount_due_at_closing") or (purchase_price - option_fee)
    option_term_end = contract.get("option_term_end_date") or contract_data.get("option_term_end_date", "")
    closing_date = contract.get("closing_date") or contract_data.get("closing_date", "")
    token = contract["signing_token"]

    now = datetime.now()
    day = contract_data.get("contract_date_day", str(now.day))
    month = contract_data.get("contract_date_month", now.strftime("%B"))
    year_raw = contract_data.get("contract_date_year", str(now.year))
    yr = str(int(year_raw) % 100) if year_raw.isdigit() else year_raw

    purchase_words = _number_to_words(purchase_price)
    amount_due_words = _number_to_words(amount_due)

    purchaser_sig_html = ""
    if contract.get("purchaser_signature"):
        purchaser_sig_html = f'<img src="{contract["purchaser_signature"]}" style="height: 48px;" />'
    else:
        purchaser_sig_html = '<div style="height: 48px; border-bottom: 1px solid #333;"></div>'

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Sign Contract - {property_address}</title>
<style>
  * {{ margin: 0; padding: 0; box-sizing: border-box; }}
  body {{ font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
         background: #f8fafc; color: #1e293b; padding: 16px; }}
  .container {{ max-width: 680px; margin: 0 auto; }}
  .card {{ background: white; border-radius: 12px; padding: 24px; margin-bottom: 16px;
           box-shadow: 0 1px 3px rgba(0,0,0,0.1); }}
  h1 {{ font-size: 22px; margin-bottom: 4px; }}
  h2 {{ font-size: 18px; margin-bottom: 12px; color: #334155; }}
  .subtitle {{ color: #64748b; font-size: 14px; margin-bottom: 16px; }}
  .contract-text {{ font-family: 'Times New Roman', Times, Georgia, serif; font-size: 15px;
                     line-height: 1.7; color: #1e293b; }}
  .contract-text h2 {{ font-size: 16px; margin-top: 20px; margin-bottom: 8px; font-family: inherit; color: #1e293b; }}
  .contract-text p {{ margin-bottom: 10px; }}
  .contract-text u {{ text-decoration-thickness: 1px; text-underline-offset: 2px; }}
  .sig-area {{ border: 2px dashed #cbd5e1; border-radius: 8px; margin: 12px 0;
               background: white; position: relative; touch-action: none; }}
  canvas {{ display: block; width: 100%; height: 200px; border-radius: 6px; cursor: crosshair; }}
  .btn {{ display: inline-block; padding: 14px 28px; border: none; border-radius: 8px;
          font-size: 16px; font-weight: 600; cursor: pointer; width: 100%; }}
  .btn-primary {{ background: #4f46e5; color: white; }}
  .btn-primary:disabled {{ background: #94a3b8; cursor: not-allowed; }}
  .btn-secondary {{ background: #e2e8f0; color: #475569; margin-bottom: 8px; }}
  .success {{ text-align: center; padding: 48px 24px; }}
  .success h2 {{ color: #059669; font-size: 24px; margin-bottom: 8px; }}
  .disclaimer {{ font-size: 12px; color: #94a3b8; margin-top: 12px; text-align: center; }}
  .hidden {{ display: none; }}
  .sig-block {{ display: flex; gap: 32px; margin-top: 32px; }}
  .sig-block > div {{ flex: 1; }}
  .sig-line {{ border-bottom: 1px solid #333; height: 48px; margin-top: 4px; }}
</style>
</head>
<body>
<div class="container">
  <div id="signing-form">
    <!-- Full Contract Text -->
    <div class="card">
      <div class="contract-text">
        <p style="text-align: center; font-size: 11px; color: #666; margin-bottom: 4px;">OPTION AGREEMENT FOR PURCHASE OF REAL PROPERTY</p>
        <h1 style="text-align: center; font-size: 20px; margin-bottom: 20px; font-weight: bold;">
          OPTION AGREEMENT FOR PURCHASE OF REAL PROPERTY
        </h1>

        <p>
          THIS OPTION AGREEMENT FOR PURCHASE OF REAL PROPERTY (this &ldquo;Agreement&rdquo;) is made and
          entered into as of the <u>{day}</u> day of <u>{month}</u>, 20<u>{yr}</u>, by and between
          <u>{seller_name}</u>, whose mailing address is
          <u>{seller_address}</u> (&ldquo;Seller&rdquo;), and
          <u>{purchaser_name}</u>, whose mailing address is
          <u>{purchaser_address}</u> (&ldquo;Purchaser&rdquo;). Seller and Purchaser may be
          referred to individually as a &ldquo;Party&rdquo; and collectively as the &ldquo;Parties.&rdquo;
        </p>

        <h2 style="text-align: center;">RECITALS</h2>

        <p>
          A. Seller represents that Seller is the fee simple owner of the real property located in the County/City of
          <u>{property_county}</u>, State/Commonwealth of <u>{property_state}</u>,
          commonly known as <u>{property_address}</u> (the &ldquo;Property&rdquo;).
        </p>

        <p>
          B. The Property is more particularly described by the legal description attached as Exhibit A, or, if no exhibit is
          attached, by the following legal description:<br/>
          <u>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</u>
        </p>

        <p>
          C. Purchaser desires to obtain from Seller the exclusive option to purchase the Property on the terms stated in
          this Agreement, and Seller desires to grant that option.
        </p>

        <p>
          NOW, THEREFORE, for good and valuable consideration, the receipt and sufficiency of which are
          acknowledged, the Parties agree as follows:
        </p>

        <p>
          <strong>1. GRANT OF OPTION.</strong> Seller hereby grants to Purchaser the exclusive and assignable right and option to
          purchase the Property (the &ldquo;Option&rdquo;) during the Option Term on the terms and conditions stated in this
          Agreement. During the Option Term, Seller shall not sell, contract to sell, lease, encumber, transfer, or
          otherwise dispose of the Property, except as expressly permitted by this Agreement or agreed to in writing by
          Purchaser.
        </p>

        <p>
          <strong>2. OPTION FEE.</strong> As consideration for the Option, Purchaser shall pay an option fee in the amount of
          ${option_fee:,} (the &ldquo;Option Fee&rdquo;) on or before the date this Agreement is fully executed. The Option Fee
          shall be paid to: [X] Seller directly; [ ] the escrow/title company identified in Section 11; or [ ] other:
          ______________________________. Unless this Agreement expressly states otherwise, the Option Fee is
          non-refundable to Purchaser if Purchaser does not exercise the Option before expiration of the Option Term. If
          Purchaser exercises the Option and closing occurs, the Option Fee shall be credited toward the Purchase
          Price at closing.
        </p>

        <p>
          <strong>3. OPTION TERM.</strong> The Option shall begin on the date this Agreement is fully executed by both Parties (the
          &ldquo;Execution Date&rdquo;) and shall expire at 5:00 p.m. local time for the Property on
          <u>{option_term_end}</u>, 20<u>{yr}</u> (the &ldquo;Option Expiration Date&rdquo;), unless extended in writing by both
          Parties. The period between the Execution Date and the Option Expiration Date is the &ldquo;Option Term.&rdquo; Time is of
          the essence for all deadlines in this Agreement.
        </p>

        <p>
          <strong>4. EXERCISE OF OPTION.</strong> Purchaser may exercise the Option at any time during the Option Term by
          delivering written notice to Seller before the Option expires (the &ldquo;Exercise Notice&rdquo;). The date Purchaser sends
          or delivers the Exercise Notice is the &ldquo;Option Exercise Date.&rdquo; Upon timely exercise of the Option, this
          Agreement shall automatically become a binding contract for Seller to sell and Purchaser, or Purchaser&rsquo;s
          assignee, to purchase the Property on the terms stated in this Agreement. The Parties shall execute customary
          closing documents required by the title company, settlement agent, lender, or applicable law, but no separate
          purchase agreement shall be required unless the Parties both agree in writing.
        </p>

        <p>
          <strong>5. PURCHASE PRICE.</strong> The purchase price for the Property shall be ${purchase_price:,} (the &ldquo;Purchase
          Price&rdquo;). At closing, Purchaser shall receive a credit against the Purchase Price for the Option Fee actually paid.
          The balance due at closing, before prorations, adjustments, closing costs, credits, and lender charges, shall be
          ${amount_due:,}.
        </p>

        <p>
          <strong>6. CLOSING.</strong> Closing shall occur on or before the earlier of (a) ______ days after the Option Exercise Date, or
          (b) <u>{closing_date}</u>, 20<u>{yr}</u>, unless the Parties agree in writing to a different closing date
          (the &ldquo;Closing Date&rdquo;). Closing shall occur through a licensed title company, settlement agent, escrow agent, or
          attorney selected by Purchaser, unless applicable law requires otherwise. Seller shall convey title by a deed
          customarily used in the jurisdiction where the Property is located, subject only to permitted exceptions
          approved by Purchaser.
        </p>

        <p>
          <strong>7. CLOSING COSTS AND PRORATIONS.</strong> Unless otherwise required by law or agreed in writing: (a)
          Purchaser shall pay Purchaser-side closing costs, lender charges, recording fees for Purchaser&rsquo;s documents,
          and title insurance premiums requested by Purchaser; (b) Seller shall pay Seller-side closing costs, costs to
          release liens or encumbrances, deed preparation charges customarily paid by sellers, and any transfer taxes
          or grantor taxes customarily paid by sellers in the Property&rsquo;s jurisdiction; and (c) real estate taxes, rents,
          homeowner association dues, utilities, and other property-related charges shall be prorated as of the Closing
          Date.
        </p>

        <p>
          <strong>8. TITLE.</strong> Seller shall convey good, marketable, and insurable title to the Property, free and clear of all liens,
          judgments, deeds of trust, mortgages, leases, occupancy rights, code violations, and encumbrances, except for
          matters accepted in writing by Purchaser. Purchaser may obtain a title search or title commitment. If title
          defects are discovered, Seller shall use commercially reasonable efforts to cure them before closing and may
          use closing proceeds to satisfy monetary liens. If Seller cannot deliver title as required, Purchaser may
          terminate this Agreement and receive a return of all amounts paid by Purchaser, without limiting any other
          remedies available for Seller default.
        </p>

        <p>
          <strong>9. DUE DILIGENCE; ACCESS; CONDITION.</strong> During the Option Term and, if the Option is exercised, until
          closing, Purchaser and Purchaser&rsquo;s representatives, inspectors, contractors, lenders, partners, agents,
          prospective assignees, and consultants may access the Property upon reasonable notice for inspections,
          measurements, photographs, videos, repair estimates, appraisals, surveys, financing, title review, and other
          due diligence. Seller shall reasonably cooperate with such access. Purchaser shall be responsible for damage
          to the Property caused by Purchaser or Purchaser&rsquo;s representatives during access. Unless otherwise agreed in
          writing, the Property is sold in its present &ldquo;as-is&rdquo; condition, subject to Seller&rsquo;s representations, required
          disclosures, title obligations, and any written repair agreements.
        </p>

        <p>
          <strong>10. ASSIGNMENT; INVESTOR DISCLOSURE.</strong> Purchaser may assign this Agreement and/or Purchaser&rsquo;s
          rights under the Option, in whole or in part, to any person or entity without Seller&rsquo;s further consent. Purchaser
          shall provide Seller written notice of any assignment before closing. Any assignee shall assume Purchaser&rsquo;s
          obligations for closing from and after the effective date of the assignment. Seller acknowledges that Purchaser
          may be a real estate investor, may seek to assign this Agreement or the Option for a fee or profit, and is not
          acting as Seller&rsquo;s real estate broker, agent, fiduciary, or representative unless a separate written agency
          agreement states otherwise. Purchaser shall comply with all applicable licensing, disclosure, advertising, and
          real estate laws.
        </p>

        <p>
          <strong>11. ESCROW / TITLE COMPANY.</strong> If any funds are to be held in escrow, they shall be held by: Name:
          ______________________________________________; Address:
          ______________________________________________; Phone/Email:
          ______________________________________________ (the &ldquo;Escrow Agent&rdquo;). The Escrow Agent shall apply
          funds at closing or release funds according to this Agreement, written instructions signed by the Parties, or
          applicable law.
        </p>

        <p>
          <strong>12. SELLER REPRESENTATIONS.</strong> Seller represents, to Seller&rsquo;s actual knowledge, that: (a) Seller has full
          authority to enter into and perform this Agreement; (b) no other person or entity has a superior right to
          purchase the Property; (c) Seller has not entered into any other contract, option, lease-option, or agreement to
          sell the Property that conflicts with this Agreement; (d) there are no undisclosed tenants, occupants, leases,
          rental agreements, or possession rights affecting the Property, except:
          ______________________________________________; (e) Seller has not received written notice of pending
          condemnation, litigation, code enforcement, or governmental action affecting the Property, except:
          ______________________________________________; and (f) Seller will not intentionally impair title or
          materially change the condition of the Property before closing, ordinary wear and tear excepted.
        </p>

        <p>
          <strong>13. REQUIRED DISCLOSURES.</strong> Seller shall provide Purchaser all disclosures required by federal, state, and
          local law, including, if applicable, lead-based paint disclosures for residential property built before 1978,
          property condition disclosures, homeowner association or condominium disclosures, septic/well disclosures,
          and any other notices required in the jurisdiction where the Property is located. Required disclosures are
          incorporated into this Agreement by reference.
        </p>

        <p>
          <strong>14. RISK OF LOSS; MAINTENANCE.</strong> Risk of loss or material damage to the Property shall remain with Seller
          until closing. Seller shall maintain the Property in substantially the same condition as of the Execution Date,
          reasonable wear and tear excepted, and shall not remove fixtures, appliances, or personal property included in
          the sale unless this Agreement states otherwise.
        </p>

        <p>
          <strong>15. PURCHASER DEFAULT.</strong> If Purchaser timely exercises the Option and then fails to close in violation of this
          Agreement, and such failure is not caused by Seller default, title defect, casualty, failure of a contingency, or
          other permitted termination right, Seller&rsquo;s sole and exclusive remedy shall be to retain the Option Fee as
          liquidated damages. The Parties agree that actual damages would be difficult to determine and that the Option
          Fee is a reasonable estimate of Seller&rsquo;s damages. Seller shall have no further claim against Purchaser for
          money damages, consequential damages, or specific performance.
        </p>

        <p>
          <strong>16. SELLER DEFAULT.</strong> If Seller fails or refuses to perform under this Agreement, including by refusing to
          honor the Option, refusing to close after timely exercise, entering into a conflicting agreement, or failing to
          deliver title as required, Purchaser may pursue any remedies available at law or in equity, including specific
          performance, injunctive relief, return of amounts paid, costs, and money damages, subject to applicable
          law.
        </p>

        <p>
          <strong>17. MEMORANDUM OF OPTION.</strong> At Purchaser&rsquo;s request, Seller shall execute a short-form memorandum of
          this Agreement suitable for recording in the land records of the jurisdiction where the Property is located. The
          memorandum shall not disclose the Purchase Price unless required by law. If the Option expires without
          exercise or this Agreement is terminated, Purchaser shall reasonably cooperate in recording a release of the
          memorandum.
        </p>

        <p>
          <strong>18. NOTICES.</strong> Any notice required or permitted under this Agreement shall be in writing and delivered by
          personal delivery, recognized overnight courier, certified mail, or email to the addresses below, or to any
          updated address provided by written notice. Notice shall be deemed given upon delivery, refusal of delivery,
          confirmed email transmission, or attempted delivery to the correct address. Seller notice address/email:
          <u>{seller_address}</u>. Purchaser notice address/email:
          <u>{purchaser_address}</u>.
        </p>

        <p>
          <strong>19. BROKERS.</strong> Each Party represents that no broker, agent, or finder is entitled to a commission or fee in
          connection with this Agreement, except: ______________________________. The Party
          whose conduct creates a broker claim shall indemnify the other Party from that claim, subject to applicable law.
        </p>

        <p>
          <strong>20. GOVERNING LAW; VENUE.</strong> This Agreement shall be governed by and construed according to the laws of
          the State/Commonwealth where the Property is located. Venue for any legal action shall be in a court of competent jurisdiction in
          the county or city where the Property is located, unless applicable law requires otherwise.
        </p>

        <p>
          <strong>21. SUCCESSORS AND ASSIGNS.</strong> This Agreement shall bind and benefit the Parties and their respective
          heirs, personal representatives, successors, permitted assigns, and legal representatives.
        </p>

        <p>
          <strong>22. ENTIRE AGREEMENT; AMENDMENTS.</strong> This Agreement contains the entire agreement between the
          Parties regarding the Option and purchase of the Property and supersedes all prior oral or written discussions,
          offers, negotiations, and agreements. This Agreement may be amended only by a written document signed by
          both Parties.
        </p>

        <p>
          <strong>23. COUNTERPARTS; ELECTRONIC SIGNATURES.</strong> This Agreement may be signed in counterparts, each of
          which is deemed an original and all of which together constitute one agreement. Signatures delivered
          electronically, by scanned copy, or through an electronic signature platform shall be effective as originals to the
          fullest extent permitted by applicable law.
        </p>

        <p>
          <strong>24. SEVERABILITY.</strong> If any provision of this Agreement is held invalid or unenforceable, the remaining
          provisions shall remain in effect to the greatest extent permitted by law, and the invalid or unenforceable
          provision shall be modified to the minimum extent necessary to make it valid and enforceable.
        </p>

        <p>
          <strong>25. AUTHORITY; VOLUNTARY AGREEMENT.</strong> Each person signing this Agreement represents that such
          person has authority to sign and bind the Party on whose behalf the person signs. The Parties acknowledge
          that they have had the opportunity to consult legal counsel and that they are signing this Agreement voluntarily.
        </p>

        <p style="margin-top: 28px;">
          IN WITNESS WHEREOF, the Parties have executed this Agreement as of the dates written below.
        </p>

        <div style="margin-top: 36px;">
          <h2>SIGNATURES</h2>
          <div class="sig-block">
            <div>
              <p><strong>SELLER:</strong></p>
              <div class="sig-line"></div>
              <p style="margin-top: 4px;">{seller_name}</p>
              <p style="font-size: 12px; color: #666;">Title/Capacity, if any: ______________________</p>
              <p style="font-size: 12px; color: #666;">Date: _______________</p>
            </div>
            <div>
              <p><strong>PURCHASER:</strong></p>
              {purchaser_sig_html}
              <p style="margin-top: 4px;">{purchaser_name}</p>
              <p style="font-size: 12px; color: #666;">Title/Capacity, if any: ______________________</p>
              <p style="font-size: 12px; color: #666;">Date: {month} {day}, 20{yr}</p>
            </div>
          </div>
        </div>

        <div style="margin-top: 48px;">
          <h2 style="text-align: center;">EXHIBIT A</h2>
          <p style="text-align: center; margin-bottom: 16px;">LEGAL DESCRIPTION OF PROPERTY</p>
          <div style="border-bottom: 1px solid #333; height: 24px; margin-bottom: 8px;"></div>
          <div style="border-bottom: 1px solid #333; height: 24px; margin-bottom: 8px;"></div>
          <div style="border-bottom: 1px solid #333; height: 24px; margin-bottom: 8px;"></div>
          <div style="border-bottom: 1px solid #333; height: 24px; margin-bottom: 8px;"></div>
        </div>
      </div>
    </div>

    <!-- Signature Capture -->
    <div class="card">
      <h2>Your Signature</h2>
      <p class="subtitle">After reviewing the contract above, draw your signature below</p>
      <div class="sig-area">
        <canvas id="sig-canvas"></canvas>
      </div>
      <button class="btn btn-secondary" onclick="clearSig()">Clear Signature</button>
      <button class="btn btn-primary" id="sign-btn" onclick="submitSignature()" disabled>
        I Agree &amp; Sign
      </button>
      <p class="disclaimer">
        By signing, you agree to the terms of this Option Agreement as shown above.
      </p>
    </div>
  </div>
  <div id="success-view" class="hidden">
    <div class="card success">
      <h2>Contract Signed!</h2>
      <p>Thank you for signing the Option Agreement for <strong>{property_address}</strong>.</p>
      <p style="margin-top: 12px; color: #64748b;">You can close this window now.</p>
    </div>
  </div>
</div>
<script>
(function() {{
  const canvas = document.getElementById('sig-canvas');
  const ctx = canvas.getContext('2d');
  const signBtn = document.getElementById('sign-btn');
  let drawing = false;
  let hasDrawn = false;

  function resize() {{
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * 2;
    canvas.height = rect.height * 2;
    ctx.scale(2, 2);
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#1e293b';
  }}
  resize();
  window.addEventListener('resize', resize);

  function getPos(e) {{
    const rect = canvas.getBoundingClientRect();
    const t = e.touches ? e.touches[0] : e;
    return {{ x: t.clientX - rect.left, y: t.clientY - rect.top }};
  }}

  function start(e) {{
    e.preventDefault();
    drawing = true;
    const p = getPos(e);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
  }}
  function move(e) {{
    if (!drawing) return;
    e.preventDefault();
    const p = getPos(e);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    hasDrawn = true;
    signBtn.disabled = false;
  }}
  function end() {{ drawing = false; }}

  canvas.addEventListener('mousedown', start);
  canvas.addEventListener('mousemove', move);
  canvas.addEventListener('mouseup', end);
  canvas.addEventListener('mouseleave', end);
  canvas.addEventListener('touchstart', start, {{ passive: false }});
  canvas.addEventListener('touchmove', move, {{ passive: false }});
  canvas.addEventListener('touchend', end);

  window.clearSig = function() {{
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    hasDrawn = false;
    signBtn.disabled = true;
  }};

  window.submitSignature = async function() {{
    if (!hasDrawn) return;
    signBtn.disabled = true;
    signBtn.textContent = 'Submitting...';
    try {{
      const dataUrl = canvas.toDataURL('image/png');
      const res = await fetch('/sign/{token}', {{
        method: 'POST',
        headers: {{ 'Content-Type': 'application/json' }},
        body: JSON.stringify({{ signature: dataUrl }}),
      }});
      const data = await res.json();
      if (data.status === 'ok') {{
        document.getElementById('signing-form').classList.add('hidden');
        document.getElementById('success-view').classList.remove('hidden');
      }} else {{
        alert(data.message || 'Signing failed. Please try again.');
        signBtn.disabled = false;
        signBtn.textContent = 'I Agree & Sign';
      }}
    }} catch (err) {{
      alert('Network error. Please try again.');
      signBtn.disabled = false;
      signBtn.textContent = 'I Agree & Sign';
    }}
  }};
}})();
</script>
</body>
</html>"""


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
