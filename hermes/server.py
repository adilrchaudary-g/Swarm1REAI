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

        # Always register the social_bandit source
        self.store.upsert_source_adapter(
            "social_bandit",
            "Social / Bandit Comments",
            "MINIMAL",
        )

        # Always register the water_shutoffs source
        self.store.upsert_source_adapter(
            "water_shutoffs",
            "Water Shutoff Lists",
            "PARTIAL",
        )

        # Always register the fsbo source
        self.store.upsert_source_adapter(
            "fsbo",
            "FSBOs (Zillow)",
            "MODERATE",
        )

        # Always register the court_records source
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

                if path == "/api/skip-trace/pipeline-status":
                    with _pipeline_lock:
                        self._send_json(HTTPStatus.OK, dict(_pipeline_state))
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
                    body = self._read_json()
                    result = runtime.store.update_lead_status_api(
                        m.group(1),
                        body.get("status", ""),
                        body.get("reason"),
                    )
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
                        source=body.get("source", "code_violations"),
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
                        source=body.get("source", "code_violations"),
                        limit=body.get("limit", 5000),
                    )
                    self._send_json(HTTPStatus.OK, result)
                    return

                if path == "/api/skip-trace/run-pipeline":
                    body = self._read_json()
                    result = _run_skip_trace_pipeline(
                        runtime,
                        source=body.get("source", "code_violations"),
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
                    result = runtime.store.ingest_water_shutoff_records(
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
                    result = runtime.store.ingest_court_record_cases(
                        body.get("case_ids", []),
                    )
                    self._send_json(HTTPStatus.OK, result)
                    return

                self._send_json(HTTPStatus.NOT_FOUND, {"error": "Not found"})

        return ThreadingHTTPServer((host, port), Handler)

    def serve_forever(self, host: str = "127.0.0.1", port: int = 8765) -> None:
        server = self.create_server(host=host, port=port)
        print(f"Hermes listening on {host}:{port}")
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
    source: str = "code_violations",
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
            list_name = f"harvest-{source}-{zip_code}-{datetime.now().strftime('%Y%m%d')}"
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
    try:
        from lead_engine.sources.scrapers import scrape_all_portals
        results = scrape_all_portals(
            days_back=days_back,
            limit=limit,
            portal_ids=portal_ids,
        )

        import uuid

        total_ingested = 0
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

            import csv as csv_mod
            with open(csv_path, "r") as f:
                reader = csv_mod.DictReader(f)
                items = []
                for row in reader:
                    addr_street = (row.get("address_street") or "").strip()
                    city = (row.get("city") or "").strip()
                    state = (row.get("state") or "").strip()
                    zipcode = (row.get("zip") or "").strip()
                    full = ", ".join(p for p in [addr_street, city, state, zipcode] if p)
                    items.append({
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

            list_name = f"Code Violations — {manifest.get('geography', r['portal'])}"
            envelope = {
                "message_id": f"scrape-{r['portal']}-{uuid.uuid4().hex[:8]}",
                "type": "event",
                "lane": "houses",
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "payload": {
                    "command_type": "EXPORT",
                    "status": "success",
                    "items": items,
                    "source_type": "code_violations",
                    "geography": manifest.get("geography", ""),
                    "record_count": len(items),
                    "list_name": list_name,
                },
            }
            runtime.store.ingest_envelope(envelope)
            total_ingested += len(items)

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
            "total_leads": total_ingested,
            "details": results,
        }
    except Exception as e:
        return {"status": "error", "message": str(e)}


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
    source: str = "code_violations",
    limit: int = 5000,
) -> dict[str, Any]:
    """Export leads without phones as a CSV file ready for PropStream upload.

    Creates a CSV in the PropStream upload format (Address, City, State, Zip)
    that can be directly uploaded to PropStream for skip tracing.
    """
    import csv as csv_mod
    import io

    try:
        with runtime.store._connect() as conn:
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
        export_path = export_dir / f"skip-trace-upload-{source}-{datetime.now().strftime('%Y%m%d-%H%M%S')}.csv"
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

    propstream_root = runtime.root.parent / "lead-vault" / "acquisition" / "propstream"
    if not propstream_root.is_dir():
        return {"status": "error", "message": f"PropStream root not found: {propstream_root}"}

    csv_files = list(propstream_root.rglob("*.csv"))
    if not csv_files:
        return {"status": "ok", "message": "No CSV files found", "ingested": 0}

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
                        "distress_signals": [],
                    }

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

        except Exception as e:
            continue

    # Count how many code violation leads now have phones
    with runtime.store._connect() as conn:
        result = conn.execute("""
            SELECT
                COUNT(DISTINCT l.lead_id) as total_cv,
                COUNT(DISTINCT CASE WHEN op.id IS NOT NULL THEN l.lead_id END) as with_phones
            FROM leads l
            LEFT JOIN owner_phones op ON op.owner_id = l.owner_id
            WHERE l.source = 'code_violations'
        """).fetchone()
        cv_total = result["total_cv"]
        cv_with_phones = result["with_phones"]

    return {
        "status": "ok",
        "csv_files_found": len(csv_files),
        "files_processed": files_processed,
        "total_rows_parsed": total_rows,
        "code_violation_leads": cv_total,
        "code_violation_leads_with_phones": cv_with_phones,
    }


def _run_skip_trace_pipeline(
    runtime: HermesRuntime,
    source: str = "code_violations",
) -> dict[str, Any]:
    """Full automated pipeline: export CSV → propstream-runner import-skip-trace → ingest.

    Spawns the propstream-runner as a visible subprocess so the user can watch
    the browser automation. Progress is available via /api/skip-trace/pipeline-status.
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
                    _pipeline_state["result"] = ingest_result
                    phones = ingest_result.get("code_violation_leads_with_phones", 0)
                    total = ingest_result.get("code_violation_leads", 0)
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
