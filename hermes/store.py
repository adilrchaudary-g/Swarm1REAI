from __future__ import annotations

import csv
import hashlib
import io
import json
import re
import shutil
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Iterable


SEARCHABLE_ERROR_CODES = {
    "SESSION_EXPIRED",
    "CAPTCHA_REQUIRED",
    "DOM_SELECTOR_MISSING",
    "QUOTA_CHECK_REQUIRED",
    "QUOTA_LOCAL_HALT",
    "QUOTA_REMOTE_EXHAUSTED",
}


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def json_dumps(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"))


def normalize_text(value: Any) -> str:
    text = str(value or "").strip().lower()
    text = re.sub(r"\s+", " ", text)
    return text


def normalize_token(value: Any) -> str:
    text = normalize_text(value)
    text = re.sub(r"[^a-z0-9]+", "-", text)
    return text.strip("-")


def normalize_digits(value: Any) -> str:
    return re.sub(r"\D+", "", str(value or ""))


def boolish(value: Any) -> int | None:
    if value is True:
        return 1
    if value is False:
        return 0
    if value is None or value == "":
        return None
    text = normalize_text(value)
    if text in {"1", "true", "yes"}:
        return 1
    if text in {"0", "false", "no"}:
        return 0
    return None


def clean_phone(value: Any) -> str:
    text = str(value or "").strip()
    return text


class HermesStore:
    def __init__(self, root: Path) -> None:
        self.root = Path(root)
        self.data_dir = self.root / "data"
        self.artifacts_dir = self.data_dir / "artifacts"
        self.exports_dir = self.artifacts_dir / "exports"
        self.db_path = self.data_dir / "propstream.db"
        self._county_catalog_by_fips: dict[str, dict[str, Any]] | None = None

    def initialize(self) -> dict[str, Any]:
        self._ensure_layout()
        with self._connect() as conn:
            self._initialize_schema(conn)
        return {
            "status": "ok",
            "db_path": str(self.db_path),
            "exports_dir": str(self.exports_dir),
        }

    def _load_county_catalog(self) -> dict[str, dict[str, Any]]:
        if self._county_catalog_by_fips is None:
            seed_path = self.root.parent / "lead_engine" / "data" / "us_counties.json"
            if not seed_path.exists():
                self._county_catalog_by_fips = {}
            else:
                counties = json.loads(seed_path.read_text())
                self._county_catalog_by_fips = {
                    str(county.get("fips") or "").zfill(5): county
                    for county in counties
                    if county.get("fips")
                }
        return self._county_catalog_by_fips

    def _county_seed_profile(self, county: dict[str, Any]) -> dict[str, Any]:
        from lead_engine.config import BLOCKED_STATES, HIGH_FRICTION_STATES

        state = str(county.get("state") or "").upper()
        population = int(county.get("population") or 0)
        median_home_value = int(county.get("median_home_value") or 0)

        if state in BLOCKED_STATES:
            tier = "blocked"
        elif state in HIGH_FRICTION_STATES:
            tier = "high_friction"
        else:
            tier = "green"

        static_score = 0
        if 80_000 <= median_home_value <= 180_000:
            static_score += 30
        elif 180_000 < median_home_value <= 300_000:
            static_score += 20
        elif 300_000 < median_home_value <= 400_000:
            static_score += 10

        if population >= 500_000:
            static_score += 15
        elif population >= 200_000:
            static_score += 10
        elif population >= 100_000:
            static_score += 5

        if state in HIGH_FRICTION_STATES:
            static_score -= 10
        if state in BLOCKED_STATES:
            static_score = 0

        county_name = str(county.get("county") or "").strip()
        search_term = str(county.get("search_term") or f"{county_name} {state}").strip()

        return {
            "county": county_name,
            "state": state,
            "population": population,
            "median_home_value": median_home_value,
            "search_term": search_term,
            "static_score": max(static_score, 0),
            "regulatory_tier": tier,
        }

    def _lookup_county_profile(self, fips: str, fallback_search_term: str = "") -> dict[str, Any] | None:
        county = self._load_county_catalog().get(str(fips or "").zfill(5))
        if county:
            return self._county_seed_profile(county)

        search_term = str(fallback_search_term or "").strip()
        if not search_term:
            return None

        county_name, sep, state = search_term.rpartition(" ")
        if not sep:
            return None

        return self._county_seed_profile({
            "county": county_name.strip() or search_term,
            "state": state.strip().upper(),
            "search_term": search_term,
        })

    def ingest_envelope(
        self,
        envelope: dict[str, Any],
        *,
        export_csv_path: str | None = None,
    ) -> dict[str, Any]:
        self.initialize()
        with self._connect() as conn:
            event_row = self._insert_bridge_event(conn, envelope)
            if not event_row["inserted"]:
                return {"status": "duplicate", "message_id": event_row["message_id"]}

            payload = envelope.get("payload") or {}
            self._insert_quota_snapshot(conn, envelope, payload)
            self._insert_event_errors(conn, envelope, payload)

            command_type = str(payload.get("command_type") or "").upper()
            if command_type == "SEARCH" and payload.get("status") in {"success", "partial"}:
                self._project_search(conn, envelope)
            elif command_type == "SAVE" and payload.get("status") in {"success", "partial"}:
                self._project_save(conn, envelope)
            elif command_type == "EXPORT" and payload.get("status") in {"success", "partial"}:
                artifact_path = self._persist_export_artifact(
                    conn,
                    envelope,
                    export_csv_path=export_csv_path,
                )
                self._project_export(conn, envelope, artifact_path=artifact_path)
            elif command_type == "SKIP_TRACE" and payload.get("status") in {"success", "partial"}:
                self._project_skip_trace(conn, envelope)
            elif command_type == "HARVEST" and payload.get("status") in {"success", "partial"}:
                self._project_harvest(conn, envelope)

            return {
                "status": "ingested",
                "message_id": envelope["message_id"],
                "command_type": command_type,
            }

    def enqueue_command(self, envelope: dict[str, Any]) -> dict[str, Any]:
        self.initialize()
        if envelope.get("type") != "command":
            raise ValueError("Queued envelopes must have type=command")
        with self._connect() as conn:
            event_row = self._insert_bridge_event(conn, envelope)
            if event_row["inserted"]:
                conn.execute(
                    """
                    INSERT INTO command_queue (
                      message_id,
                      lane,
                      queued_at,
                      raw_json
                    ) VALUES (?, ?, ?, ?)
                    """,
                    (
                        envelope["message_id"],
                        envelope.get("lane") or "houses",
                        envelope.get("timestamp") or now_iso(),
                        json_dumps(envelope),
                    ),
                )
                return {"status": "queued", "message_id": envelope["message_id"]}
            return {"status": "duplicate", "message_id": envelope["message_id"]}

    def poll_commands(
        self,
        *,
        lane: str,
        after: str | None = None,
        limit: int = 1,
    ) -> list[dict[str, Any]]:
        self.initialize()
        with self._connect() as conn:
            if after:
                after_row = conn.execute(
                    "SELECT sequence FROM command_queue WHERE message_id = ?",
                    (after,),
                ).fetchone()
            else:
                after_row = None

            if after_row:
                rows = conn.execute(
                    """
                    SELECT sequence, raw_json
                    FROM command_queue
                    WHERE lane = ? AND sequence > ?
                    ORDER BY sequence ASC
                    LIMIT ?
                    """,
                    (lane, after_row["sequence"], limit),
                ).fetchall()
            else:
                rows = conn.execute(
                    """
                    SELECT sequence, raw_json
                    FROM command_queue
                    WHERE lane = ? AND delivered_at IS NULL
                    ORDER BY sequence ASC
                    LIMIT ?
                    """,
                    (lane, limit),
                ).fetchall()

            commands = []
            for row in rows:
                commands.append(json.loads(row["raw_json"]))
                conn.execute(
                    "UPDATE command_queue SET delivered_at = ? WHERE sequence = ?",
                    (now_iso(), row["sequence"]),
                )
            return commands

    def query_leads(self, term: str, *, limit: int = 10) -> list[dict[str, Any]]:
        return self._search_entities(term, entity="lead", limit=limit)

    def query_owners(self, term: str, *, limit: int = 10) -> list[dict[str, Any]]:
        return self._search_entities(term, entity="owner", limit=limit)

    def query_properties(self, term: str, *, limit: int = 10) -> list[dict[str, Any]]:
        return self._search_entities(term, entity="property", limit=limit)

    def query_queue(self, kind: str, *, limit: int = 25) -> list[dict[str, Any]]:
        view = "v_hot_queue" if kind == "hot" else "v_outstanding_leads"
        with self._connect() as conn:
            rows = conn.execute(
                f"SELECT * FROM {view} LIMIT ?",
                (limit,),
            ).fetchall()
        return [dict(row) for row in rows]

    def query_outstanding(self, kind: str, *, limit: int = 25) -> list[dict[str, Any]]:
        mapping = {
            "skip-trace": "v_needs_skip_trace",
            "underwrite": "v_needs_underwrite",
            "bridge": "v_open_bridge_issues",
        }
        with self._connect() as conn:
            rows = conn.execute(
                f"SELECT * FROM {mapping[kind]} LIMIT ?",
                (limit,),
            ).fetchall()
        return [dict(row) for row in rows]

    def get_event(self, message_id: str) -> dict[str, Any] | None:
        with self._connect() as conn:
            row = conn.execute(
                "SELECT * FROM bridge_events WHERE message_id = ?",
                (message_id,),
            ).fetchone()
        return dict(row) if row else None

    def get_latest_quota(self) -> dict[str, Any] | None:
        with self._connect() as conn:
            row = conn.execute(
                """
                SELECT *
                FROM quota_snapshots
                ORDER BY recorded_at DESC, id DESC
                LIMIT 1
                """,
            ).fetchone()
        return dict(row) if row else None

    # ── Dashboard API Methods ──────────────────────────────────────────

    def list_all_leads(
        self,
        *,
        status: str | None = None,
        exclude_statuses: list[str] | None = None,
        tier: str | None = None,
        source: str | None = None,
        persona: str | None = None,
        limit: int = 100,
        offset: int = 0,
        require_phone: bool = True,
        include_unverified: bool = False,
    ) -> list[dict[str, Any]]:
        with self._connect() as conn:
            clauses = ["1=1"]
            params: list[Any] = []
            if require_phone:
                clauses.append("EXISTS (SELECT 1 FROM owner_phones op WHERE op.owner_id = l.owner_id)")
            if not include_unverified:
                clauses.append("(l.propstream_verified = 1 OR l.propstream_verified IS NULL)")
            if status:
                clauses.append("l.status = ?")
                params.append(status)
            elif exclude_statuses:
                placeholders = ",".join("?" for _ in exclude_statuses)
                clauses.append(f"l.status NOT IN ({placeholders})")
                params.extend(exclude_statuses)
            if tier:
                clauses.append("l.motivation_tier = ?")
                params.append(tier)
            if source:
                clauses.append("l.source = ?")
                params.append(source)
            if persona:
                clauses.append("l.persona_primary = ?")
                params.append(persona)
            where = " AND ".join(clauses)
            rows = conn.execute(
                f"""
                SELECT
                  l.lead_id, l.status, l.source, l.persona_primary,
                  l.motivation_score, l.motivation_tier,
                  l.arv_estimate, l.mao, l.router_decision, l.router_reason,
                  l.distress_signals_json, l.created_at, l.updated_at,
                  l.last_list_name,
                  p.address_full, p.address_street, p.address_city,
                  p.address_state, p.address_zip, p.property_type,
                  o.owner_name, o.owner_type,
                  (
                    SELECT json_group_array(
                      json_object(
                        'phone_value', op.phone_value,
                        'phone_digits', op.phone_digits,
                        'phone_type', op.phone_type,
                        'dnc', op.dnc,
                        'bad_number', COALESCE(op.bad_number, 0)
                      )
                    )
                    FROM owner_phones op
                    WHERE op.owner_id = l.owner_id
                      AND COALESCE(op.bad_number, 0) = 0
                  ) AS phones_json
                FROM leads l
                JOIN properties p ON p.property_id = l.property_id
                JOIN owners o ON o.owner_id = l.owner_id
                WHERE {where}
                ORDER BY COALESCE(l.motivation_score, -1) DESC, l.updated_at DESC
                LIMIT ? OFFSET ?
                """,
                (*params, limit, offset),
            ).fetchall()
            return [dict(r) for r in rows]

    def get_lead_detail(self, lead_id: str) -> dict[str, Any] | None:
        with self._connect() as conn:
            lead = self._fetch_lead_projection(conn, lead_id)
            if not lead:
                return None
            lead["notes"] = [
                dict(r)
                for r in conn.execute(
                    "SELECT * FROM lead_notes WHERE lead_id = ? ORDER BY created_at DESC",
                    (lead_id,),
                ).fetchall()
            ]
            lead["history"] = [
                dict(r)
                for r in conn.execute(
                    "SELECT * FROM lead_status_history WHERE lead_id = ? ORDER BY created_at DESC",
                    (lead_id,),
                ).fetchall()
            ]
            return lead

    def update_lead_status_api(
        self, lead_id: str, new_status: str, reason: str | None = None
    ) -> dict[str, Any]:
        with self._connect() as conn:
            current = self._get_lead_status(conn, lead_id)
            if current is None:
                return {"status": "error", "message": "Lead not found"}
            self._set_lead_status(
                conn,
                lead_id=lead_id,
                to_status=new_status,
                reason=reason or f"API transition to {new_status}",
                event_message_id=None,
                change_status=True,
            )
            return {"status": "ok", "lead_id": lead_id, "from": current, "to": new_status}

    def get_command_queue_status(self) -> dict[str, Any]:
        """Return summary of the command queue (pending, delivered, by type)."""
        with self._connect() as conn:
            row = conn.execute("""
                SELECT
                    COUNT(*) as total,
                    SUM(CASE WHEN delivered_at IS NULL THEN 1 ELSE 0 END) as pending,
                    SUM(CASE WHEN delivered_at IS NOT NULL THEN 1 ELSE 0 END) as delivered
                FROM command_queue
            """).fetchone()
            by_type = conn.execute("""
                SELECT
                    json_extract(raw_json, '$.payload.command_type') as cmd_type,
                    COUNT(*) as cnt,
                    SUM(CASE WHEN delivered_at IS NULL THEN 1 ELSE 0 END) as pending
                FROM command_queue
                GROUP BY cmd_type
            """).fetchall()
            return {
                "total": row["total"],
                "pending": row["pending"],
                "delivered": row["delivered"],
                "by_type": {r["cmd_type"]: {"total": r["cnt"], "pending": r["pending"]} for r in by_type},
            }

    def bulk_update_lead_status(
        self,
        lead_ids: list[str],
        new_status: str,
        reason: str | None = None,
    ) -> dict[str, Any]:
        """Transition multiple leads to a new status in one batch."""
        if not lead_ids:
            return {"status": "ok", "updated": 0}
        updated = 0
        errors: list[str] = []
        with self._connect() as conn:
            for lead_id in lead_ids:
                current = self._get_lead_status(conn, lead_id)
                if current is None:
                    errors.append(f"{lead_id}: not found")
                    continue
                self._set_lead_status(
                    conn,
                    lead_id=lead_id,
                    to_status=new_status,
                    reason=reason or f"Bulk transition to {new_status}",
                    event_message_id=None,
                    change_status=True,
                )
                updated += 1
        result: dict[str, Any] = {"status": "ok", "updated": updated, "to": new_status}
        if errors:
            result["errors"] = errors
        return result

    def log_call_attempt(
        self, lead_id: str, disposition: str, notes: str | None = None, phone_number: str | None = None
    ) -> dict[str, Any]:
        called_at = now_iso()
        with self._connect() as conn:
            conn.execute(
                "INSERT INTO call_attempts (lead_id, disposition, notes, called_at, phone_number) VALUES (?, ?, ?, ?, ?)",
                (lead_id, disposition, notes, called_at, phone_number),
            )
            if disposition == "bad_number" and phone_number:
                conn.execute(
                    "UPDATE owner_phones SET bad_number = 1 WHERE phone_digits = ?",
                    (phone_number,),
                )
            attempt_count = conn.execute(
                "SELECT COUNT(*) as cnt FROM call_attempts WHERE lead_id = ?", (lead_id,)
            ).fetchone()["cnt"]
            no_answer_count = conn.execute(
                "SELECT COUNT(*) as cnt FROM call_attempts WHERE lead_id = ? AND disposition IN ('no_answer', 'voicemail')",
                (lead_id,),
            ).fetchone()["cnt"]
            return {
                "status": "ok",
                "lead_id": lead_id,
                "disposition": disposition,
                "called_at": called_at,
                "phone_number": phone_number,
                "attempt_count": attempt_count,
                "no_answer_count": no_answer_count,
            }

    def requeue_stale_leads(self, days_threshold: int = 10, max_attempts: int = 6) -> dict[str, Any]:
        """Re-queue leads whose last call attempt was more than `days_threshold` days ago.

        Targets leads in 'contacted' or 'enriched' status that have cell phones,
        were previously called (no_answer/voicemail), and haven't been called recently.
        Leads exceeding `max_attempts` are moved to cooldown instead of re-queued.
        """
        self.initialize()
        cutoff = (datetime.now(timezone.utc) - timedelta(days=days_threshold)).isoformat()
        with self._connect() as conn:
            rows = conn.execute(
                """
                SELECT DISTINCT ca.lead_id,
                  (SELECT COUNT(*) FROM call_attempts ca2 WHERE ca2.lead_id = ca.lead_id) as attempt_count
                FROM call_attempts ca
                JOIN leads l ON l.lead_id = ca.lead_id
                WHERE ca.disposition IN ('no_answer', 'voicemail')
                  AND l.status IN ('contacted', 'enriched')
                  AND EXISTS (
                    SELECT 1 FROM owner_phones op
                    WHERE op.owner_id = l.owner_id
                      AND LOWER(op.phone_type) IN ('cell', 'mobile')
                  )
                  AND ca.lead_id NOT IN (
                    SELECT lead_id FROM call_attempts
                    WHERE called_at >= ?
                  )
                """,
                (cutoff,),
            ).fetchall()
            requeue_ids = []
            cooldown_ids = []
            for r in rows:
                if r["attempt_count"] >= max_attempts:
                    cooldown_ids.append(r["lead_id"])
                else:
                    requeue_ids.append(r["lead_id"])
            now = now_iso()
            if requeue_ids:
                placeholders = ",".join("?" * len(requeue_ids))
                conn.execute(
                    f"UPDATE leads SET status = 'queued', updated_at = ? WHERE lead_id IN ({placeholders})",
                    [now] + requeue_ids,
                )
                for lid in requeue_ids:
                    conn.execute(
                        "INSERT INTO lead_status_history (lead_id, from_status, to_status, reason, created_at) "
                        "VALUES (?, 'contacted', 'queued', ?, ?)",
                        (lid, f"Auto re-queued: no contact in {days_threshold} days", now),
                    )
            if cooldown_ids:
                placeholders = ",".join("?" * len(cooldown_ids))
                conn.execute(
                    f"UPDATE leads SET status = 'cooldown', updated_at = ? WHERE lead_id IN ({placeholders})",
                    [now] + cooldown_ids,
                )
                for lid in cooldown_ids:
                    conn.execute(
                        "INSERT INTO lead_status_history (lead_id, from_status, to_status, reason, created_at) "
                        "VALUES (?, 'contacted', 'cooldown', ?, ?)",
                        (lid, f"Auto cooldown: {max_attempts}+ attempts with no answer", now),
                    )
            return {"status": "ok", "requeued": len(requeue_ids), "cooled_down": len(cooldown_ids)}

    def clean_queue_bad_numbers(self) -> dict[str, Any]:
        """Remove queued leads that have no usable cell phones (all cells are bad or only landlines)."""
        self.initialize()
        now = now_iso()
        with self._connect() as conn:
            conn.execute("""
                UPDATE owner_phones SET bad_number = 1
                WHERE phone_digits IN (
                    SELECT DISTINCT phone_number FROM call_attempts
                    WHERE disposition = 'bad_number' AND phone_number IS NOT NULL AND phone_number != ''
                ) AND COALESCE(bad_number, 0) = 0
            """)
            queued = conn.execute(
                "SELECT lead_id, owner_id FROM leads WHERE status = 'queued'"
            ).fetchall()
            removed = []
            for lead in queued:
                good_cells = conn.execute(
                    """SELECT COUNT(*) as cnt FROM owner_phones
                       WHERE owner_id = ? AND LOWER(phone_type) IN ('cell', 'mobile')
                       AND COALESCE(bad_number, 0) = 0""",
                    (lead["owner_id"],),
                ).fetchone()["cnt"]
                if good_cells == 0:
                    conn.execute(
                        "UPDATE leads SET status = 'archived', updated_at = ? WHERE lead_id = ?",
                        (now, lead["lead_id"]),
                    )
                    conn.execute(
                        "INSERT INTO lead_status_history (lead_id, from_status, to_status, reason, created_at) "
                        "VALUES (?, 'queued', 'archived', 'No usable cell phones (all bad or landline-only)', ?)",
                        (lead["lead_id"], now),
                    )
                    removed.append(lead["lead_id"])
            total_bad = conn.execute(
                "SELECT COUNT(*) as cnt FROM owner_phones WHERE bad_number = 1"
            ).fetchone()["cnt"]
            remaining = conn.execute(
                "SELECT COUNT(*) as cnt FROM leads WHERE status = 'queued'"
            ).fetchone()["cnt"]
            return {
                "status": "ok",
                "phones_flagged_bad": total_bad,
                "leads_removed": len(removed),
                "queue_remaining": remaining,
                "removed_lead_ids": removed,
            }

    def lookup_lead_by_phone(self, phone_digits: str) -> dict[str, Any] | None:
        """Find a lead by phone number digits."""
        digits = "".join(c for c in phone_digits if c.isdigit())
        if len(digits) == 11 and digits[0] == "1":
            digits = digits[1:]
        if len(digits) != 10:
            return None
        with self._connect() as conn:
            row = conn.execute(
                """
                SELECT l.lead_id
                FROM owner_phones op
                JOIN leads l ON l.owner_id = op.owner_id
                WHERE op.phone_digits = ?
                ORDER BY l.updated_at DESC
                LIMIT 1
                """,
                (digits,),
            ).fetchone()
            if not row:
                return None
            return self.get_lead_detail(row["lead_id"])

    def get_call_history(self, lead_id: str) -> list[dict[str, Any]]:
        with self._connect() as conn:
            rows = conn.execute(
                "SELECT * FROM call_attempts WHERE lead_id = ? ORDER BY called_at DESC",
                (lead_id,),
            ).fetchall()
            return [dict(r) for r in rows]

    def add_lead_note(
        self, lead_id: str, note_type: str, content: str
    ) -> dict[str, Any]:
        created_at = now_iso()
        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO lead_notes (lead_id, note_type, content, created_at)
                VALUES (?, ?, ?, ?)
                """,
                (lead_id, note_type, content, created_at),
            )
            return {"status": "ok", "lead_id": lead_id, "created_at": created_at}

    def list_source_adapters(self) -> list[dict[str, Any]]:
        with self._connect() as conn:
            rows = conn.execute(
                "SELECT * FROM source_adapters ORDER BY source_name"
            ).fetchall()
            return [dict(r) for r in rows]

    def upsert_source_adapter(
        self,
        source_id: str,
        source_name: str,
        data_quality_tier: str,
        **kwargs: Any,
    ) -> None:
        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO source_adapters (source_id, source_name, data_quality_tier)
                VALUES (?, ?, ?)
                ON CONFLICT(source_id) DO UPDATE SET
                  source_name = excluded.source_name,
                  data_quality_tier = excluded.data_quality_tier
                """,
                (source_id, source_name, data_quality_tier),
            )

    def update_source_run(
        self, source_id: str, status: str, count: int
    ) -> None:
        with self._connect() as conn:
            conn.execute(
                """
                UPDATE source_adapters
                SET last_run_at = ?, last_run_status = ?, last_run_count = ?
                WHERE source_id = ?
                """,
                (now_iso(), status, count, source_id),
            )

    # ── Pending verification (staging table for PropStream gate) ──

    def stage_for_verification(
        self, source: str, addresses: list[dict[str, Any]], batch_id: str,
    ) -> dict[str, Any]:
        ts = now_iso()
        with self._connect() as conn:
            count = 0
            for addr in addresses:
                conn.execute(
                    """
                    INSERT INTO pending_verification
                      (source, address_street, address_city, address_state, address_zip,
                       owner_name, source_ref, batch_id, status, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
                    """,
                    (
                        source,
                        addr.get("address_street", ""),
                        addr.get("address_city", ""),
                        addr.get("address_state"),
                        addr.get("address_zip"),
                        addr.get("owner_name"),
                        addr.get("source_ref"),
                        batch_id,
                        ts,
                    ),
                )
                count += 1
        return {"status": "ok", "batch_id": batch_id, "staged": count}

    def list_pending_verification(
        self, *, status: str = "pending", source: str | None = None, limit: int = 500,
    ) -> list[dict[str, Any]]:
        with self._connect() as conn:
            clauses = ["status = ?"]
            params: list[Any] = [status]
            if source:
                clauses.append("source = ?")
                params.append(source)
            where = " AND ".join(clauses)
            rows = conn.execute(
                f"SELECT * FROM pending_verification WHERE {where} ORDER BY created_at LIMIT ?",
                (*params, limit),
            ).fetchall()
            return [dict(r) for r in rows]

    def pending_verification_stats(self) -> dict[str, Any]:
        with self._connect() as conn:
            rows = conn.execute(
                "SELECT source, status, COUNT(*) AS c FROM pending_verification GROUP BY source, status"
            ).fetchall()
            by_source: dict[str, dict[str, int]] = {}
            for r in rows:
                by_source.setdefault(r["source"], {})[r["status"]] = r["c"]
            total_pending = conn.execute(
                "SELECT COUNT(*) AS c FROM pending_verification WHERE status = 'pending'"
            ).fetchone()["c"]
            return {"total_pending": total_pending, "by_source": by_source}

    def mark_verification_batch(self, batch_id: str, status: str) -> int:
        ts = now_iso()
        with self._connect() as conn:
            cursor = conn.execute(
                "UPDATE pending_verification SET status = ?, verified_at = ? WHERE batch_id = ?",
                (status, ts if status == "verified" else None, batch_id),
            )
            return cursor.rowcount

    def export_pending_as_csv(self, batch_id: str | None = None) -> tuple[str, int]:
        with self._connect() as conn:
            if batch_id:
                rows = conn.execute(
                    "SELECT * FROM pending_verification WHERE batch_id = ? AND status = 'pending'",
                    (batch_id,),
                ).fetchall()
            else:
                rows = conn.execute(
                    "SELECT * FROM pending_verification WHERE status = 'pending' ORDER BY created_at LIMIT 500"
                ).fetchall()
            if not rows:
                return "", 0
            output = io.StringIO()
            writer = csv.writer(output)
            writer.writerow(["Address", "City", "State", "Zip"])
            for r in rows:
                writer.writerow([r["address_street"], r["address_city"], r["address_state"] or "", r["address_zip"] or ""])
            ids = [r["id"] for r in rows]
            placeholders = ",".join("?" for _ in ids)
            conn.execute(
                f"UPDATE pending_verification SET status = 'exported' WHERE id IN ({placeholders})",
                ids,
            )
            return output.getvalue(), len(rows)

    # ── Background jobs (replaces module-level state dicts) ──

    def create_job(self, job_id: str, job_type: str) -> dict[str, Any]:
        ts = now_iso()
        with self._connect() as conn:
            conn.execute(
                """
                INSERT OR REPLACE INTO background_jobs
                  (job_id, job_type, status, phase, log_lines_json, started_at, created_at)
                VALUES (?, ?, 'running', 'starting', '[]', ?, ?)
                """,
                (job_id, job_type, ts, ts),
            )
        return {"job_id": job_id, "status": "running"}

    def update_job(self, job_id: str, *, phase: str | None = None, log_line: str | None = None,
                   status: str | None = None, result: Any = None, error: str | None = None) -> None:
        with self._connect() as conn:
            if log_line:
                existing = conn.execute(
                    "SELECT log_lines_json FROM background_jobs WHERE job_id = ?", (job_id,)
                ).fetchone()
                if existing:
                    lines = json.loads(existing["log_lines_json"] or "[]")
                    lines.append({"t": now_iso(), "msg": log_line})
                    if len(lines) > 500:
                        lines = lines[-500:]
                    conn.execute(
                        "UPDATE background_jobs SET log_lines_json = ? WHERE job_id = ?",
                        (json.dumps(lines), job_id),
                    )
            updates = []
            params: list[Any] = []
            if phase:
                updates.append("phase = ?")
                params.append(phase)
            if status:
                updates.append("status = ?")
                params.append(status)
                if status in ("completed", "failed"):
                    updates.append("completed_at = ?")
                    params.append(now_iso())
            if result is not None:
                updates.append("result_json = ?")
                params.append(json.dumps(result, default=str))
            if error is not None:
                updates.append("error = ?")
                params.append(error)
            if updates:
                params.append(job_id)
                conn.execute(
                    f"UPDATE background_jobs SET {', '.join(updates)} WHERE job_id = ?",
                    params,
                )

    def get_job(self, job_id: str) -> dict[str, Any] | None:
        with self._connect() as conn:
            row = conn.execute("SELECT * FROM background_jobs WHERE job_id = ?", (job_id,)).fetchone()
            return dict(row) if row else None

    def list_jobs(self, *, job_type: str | None = None, limit: int = 20) -> list[dict[str, Any]]:
        with self._connect() as conn:
            if job_type:
                rows = conn.execute(
                    "SELECT * FROM background_jobs WHERE job_type = ? ORDER BY created_at DESC LIMIT ?",
                    (job_type, limit),
                ).fetchall()
            else:
                rows = conn.execute(
                    "SELECT * FROM background_jobs ORDER BY created_at DESC LIMIT ?",
                    (limit,),
                ).fetchall()
            return [dict(r) for r in rows]

    def get_latest_job(self, job_type: str) -> dict[str, Any] | None:
        with self._connect() as conn:
            row = conn.execute(
                """
                SELECT *
                FROM background_jobs
                WHERE job_type = ?
                ORDER BY created_at DESC
                LIMIT 1
                """,
                (job_type,),
            ).fetchone()
            return dict(row) if row else None

    def recover_running_jobs(self, job_type: str, *, error: str, log_line: str | None = None) -> int:
        ts = now_iso()
        with self._connect() as conn:
            rows = conn.execute(
                """
                SELECT job_id, log_lines_json
                FROM background_jobs
                WHERE job_type = ? AND status = 'running'
                """,
                (job_type,),
            ).fetchall()
            for row in rows:
                lines = json.loads(row["log_lines_json"] or "[]")
                if log_line:
                    lines.append({"t": ts, "msg": log_line})
                conn.execute(
                    """
                    UPDATE background_jobs
                    SET status = 'failed',
                        phase = 'error',
                        error = ?,
                        completed_at = ?,
                        log_lines_json = ?
                    WHERE job_id = ?
                    """,
                    (error, ts, json.dumps(lines), row["job_id"]),
                )
            return len(rows)

    def get_pipeline_stats(self) -> dict[str, Any]:
        with self._connect() as conn:
            total = conn.execute("SELECT COUNT(*) AS c FROM leads").fetchone()["c"]
            status_rows = conn.execute(
                "SELECT status, COUNT(*) AS c FROM leads GROUP BY status"
            ).fetchall()
            tier_rows = conn.execute(
                "SELECT motivation_tier, COUNT(*) AS c FROM leads WHERE motivation_tier IS NOT NULL GROUP BY motivation_tier"
            ).fetchall()
            source_rows = conn.execute(
                "SELECT source, COUNT(*) AS c FROM leads WHERE source IS NOT NULL GROUP BY source"
            ).fetchall()
            verified = conn.execute(
                "SELECT COUNT(*) AS c FROM leads WHERE propstream_verified = 1 AND status NOT IN ('archived', 'dead')"
            ).fetchone()["c"]
            with_phones = conn.execute(
                """SELECT COUNT(DISTINCT l.lead_id) AS c FROM leads l
                   JOIN owner_phones op ON op.owner_id = l.owner_id
                   WHERE l.status NOT IN ('archived', 'dead')"""
            ).fetchone()["c"]
            pending_verification = conn.execute(
                "SELECT COUNT(*) AS c FROM pending_verification WHERE status = 'pending'"
            ).fetchone()["c"]
            return {
                "total_leads": total,
                "verified_leads": verified,
                "leads_with_phones": with_phones,
                "pending_verification": pending_verification,
                "by_status": {r["status"]: r["c"] for r in status_rows},
                "by_tier": {r["motivation_tier"]: r["c"] for r in tier_rows},
                "by_source": {r["source"]: r["c"] for r in source_rows},
            }

    def get_kpi_summary(self) -> dict[str, Any]:
        stats = self.get_pipeline_stats()
        by_status = stats.get("by_status", {})
        return {
            "total_leads": stats["total_leads"],
            "deals_closed": by_status.get("closed_won", 0),
            "pipeline_value": 0,
            "follow_ups_due": by_status.get("follow_up", 0),
            "by_status": by_status,
            "by_tier": stats.get("by_tier", {}),
            "by_source": stats.get("by_source", {}),
        }

    def list_follow_ups(
        self, *, pending_only: bool = True, limit: int = 50
    ) -> list[dict[str, Any]]:
        with self._connect() as conn:
            if pending_only:
                rows = conn.execute(
                    """
                    SELECT f.*, l.status AS lead_status,
                           p.address_full, o.owner_name
                    FROM follow_ups f
                    JOIN leads l ON l.lead_id = f.lead_id
                    JOIN properties p ON p.property_id = l.property_id
                    JOIN owners o ON o.owner_id = l.owner_id
                    WHERE f.completed_at IS NULL
                    ORDER BY f.scheduled_at ASC
                    LIMIT ?
                    """,
                    (limit,),
                ).fetchall()
            else:
                rows = conn.execute(
                    """
                    SELECT f.*, l.status AS lead_status,
                           p.address_full, o.owner_name
                    FROM follow_ups f
                    JOIN leads l ON l.lead_id = f.lead_id
                    JOIN properties p ON p.property_id = l.property_id
                    JOIN owners o ON o.owner_id = l.owner_id
                    ORDER BY f.scheduled_at DESC
                    LIMIT ?
                    """,
                    (limit,),
                ).fetchall()
            return [dict(r) for r in rows]

    def create_follow_up(
        self, lead_id: str, follow_up_type: str, scheduled_at: str, notes: str | None = None
    ) -> dict[str, Any]:
        created_at = now_iso()
        with self._connect() as conn:
            cursor = conn.execute(
                """
                INSERT INTO follow_ups (lead_id, follow_up_type, scheduled_at, notes, created_at)
                VALUES (?, ?, ?, ?, ?)
                """,
                (lead_id, follow_up_type, scheduled_at, notes, created_at),
            )
            return {"status": "ok", "id": cursor.lastrowid, "lead_id": lead_id}

    def complete_follow_up(
        self, follow_up_id: int, outcome: str
    ) -> dict[str, Any]:
        with self._connect() as conn:
            conn.execute(
                "UPDATE follow_ups SET completed_at = ?, outcome = ? WHERE id = ?",
                (now_iso(), outcome, follow_up_id),
            )
            return {"status": "ok", "id": follow_up_id}

    # ── Underwriting reports ──────────────────────────────────────

    def create_underwriting_report(self, lead_id: str) -> dict[str, Any]:
        self.initialize()
        ts = now_iso()
        with self._connect() as conn:
            existing = conn.execute(
                "SELECT id, status FROM underwriting_reports WHERE lead_id = ?", (lead_id,)
            ).fetchone()
            if existing:
                return {"status": "ok", "id": existing["id"], "existed": True}
            cursor = conn.execute(
                "INSERT INTO underwriting_reports (lead_id, status, created_at, updated_at) VALUES (?, 'pending', ?, ?)",
                (lead_id, ts, ts),
            )
            return {"status": "ok", "id": cursor.lastrowid, "existed": False}

    def update_underwriting_report(self, lead_id: str, data: dict[str, Any]) -> dict[str, Any]:
        self.initialize()
        allowed = {
            "arv_propstream", "arv_county", "arv_zillow", "arv_final", "arv_confidence",
            "arv_sources_json", "repair_estimate_low", "repair_estimate_high", "repair_notes",
            "mao_70", "mao_65", "assignment_fee_low", "assignment_fee_high",
            "cash_on_cash_buyer", "holding_costs", "photo_urls_json", "street_view_url",
            "zillow_url", "county_assessor_url", "propstream_url", "condition_assessment",
            "situation_summary", "discrepancies_json", "overall_grade", "recommendation", "status",
        }
        sets = []
        vals = []
        for k, v in data.items():
            if k in allowed:
                sets.append(f"{k} = ?")
                vals.append(v)
        if not sets:
            return {"status": "noop"}
        sets.append("updated_at = ?")
        vals.append(now_iso())
        vals.append(lead_id)
        with self._connect() as conn:
            conn.execute(f"UPDATE underwriting_reports SET {', '.join(sets)} WHERE lead_id = ?", vals)
            return {"status": "ok", "lead_id": lead_id}

    def get_underwriting_report(self, lead_id: str) -> dict[str, Any] | None:
        self.initialize()
        with self._connect() as conn:
            row = conn.execute(
                "SELECT * FROM underwriting_reports WHERE lead_id = ?", (lead_id,)
            ).fetchone()
            if not row:
                return None
            return dict(row)

    def list_underwriting_reports(self, status: str | None = None) -> list[dict[str, Any]]:
        self.initialize()
        with self._connect() as conn:
            if status:
                rows = conn.execute(
                    "SELECT ur.*, p.address_full, o.owner_name "
                    "FROM underwriting_reports ur "
                    "JOIN leads l ON l.lead_id = ur.lead_id "
                    "JOIN properties p ON p.property_id = l.property_id "
                    "JOIN owners o ON o.owner_id = l.owner_id "
                    "WHERE ur.status = ? ORDER BY ur.updated_at DESC",
                    (status,),
                ).fetchall()
            else:
                rows = conn.execute(
                    "SELECT ur.*, p.address_full, o.owner_name "
                    "FROM underwriting_reports ur "
                    "JOIN leads l ON l.lead_id = ur.lead_id "
                    "JOIN properties p ON p.property_id = l.property_id "
                    "JOIN owners o ON o.owner_id = l.owner_id "
                    "ORDER BY ur.updated_at DESC",
                ).fetchall()
            return [dict(r) for r in rows]

    # ── KPI queries ──────────────────────────────────────────────

    def get_conversion_funnel(self, days_back: int = 30) -> dict[str, Any]:
        self.initialize()
        cutoff = (datetime.now(timezone.utc) - timedelta(days=days_back)).isoformat()
        with self._connect() as conn:
            stages = {}
            for status in ["imported", "new", "enriched", "queued", "contacted", "interested", "underwriting", "under_contract", "closed_won"]:
                row = conn.execute(
                    "SELECT COUNT(DISTINCT lead_id) as cnt FROM lead_status_history WHERE to_status = ? AND created_at >= ?",
                    (status, cutoff),
                ).fetchone()
                stages[status] = row["cnt"] if row else 0
            by_status = conn.execute(
                "SELECT status, COUNT(*) as cnt FROM leads GROUP BY status"
            ).fetchall()
            current = {r["status"]: r["cnt"] for r in by_status}
            return {"transitions": stages, "current": current, "days_back": days_back}

    def get_call_metrics(self, days_back: int = 7) -> dict[str, Any]:
        self.initialize()
        cutoff = (datetime.now(timezone.utc) - timedelta(days=days_back)).isoformat()
        _non_convo = (
            "'no_answer','voicemail','busy','disconnected','wrong_number','bad_number'"
        )
        with self._connect() as conn:
            total_dials = conn.execute(
                "SELECT COUNT(*) as cnt FROM call_attempts WHERE called_at >= ?",
                (cutoff,),
            ).fetchone()["cnt"]
            unique_leads_called = conn.execute(
                "SELECT COUNT(DISTINCT lead_id) as cnt FROM call_attempts WHERE called_at >= ?",
                (cutoff,),
            ).fetchone()["cnt"]
            pickups = conn.execute(
                f"SELECT COUNT(*) as cnt FROM call_attempts "
                f"WHERE disposition NOT IN ({_non_convo}) AND called_at >= ?",
                (cutoff,),
            ).fetchone()["cnt"]
            interested = conn.execute(
                "SELECT COUNT(DISTINCT lead_id) as cnt FROM call_attempts "
                "WHERE disposition = 'interested' AND called_at >= ?",
                (cutoff,),
            ).fetchone()["cnt"]
            voicemails = conn.execute(
                "SELECT COUNT(*) as cnt FROM call_attempts "
                "WHERE disposition = 'voicemail' AND called_at >= ?",
                (cutoff,),
            ).fetchone()["cnt"]
            bad_numbers = conn.execute(
                "SELECT COUNT(*) as cnt FROM call_attempts "
                "WHERE disposition = 'bad_number' AND called_at >= ?",
                (cutoff,),
            ).fetchone()["cnt"]
            no_answers = conn.execute(
                "SELECT COUNT(*) as cnt FROM call_attempts "
                "WHERE disposition = 'no_answer' AND called_at >= ?",
                (cutoff,),
            ).fetchone()["cnt"]
            pickup_rate = round(pickups / total_dials * 100, 1) if total_dials else 0
            interest_rate = round(interested / pickups * 100, 1) if pickups else 0
            return {
                "total_dials": total_dials,
                "unique_leads_called": unique_leads_called,
                "pickups": pickups,
                "interested": interested,
                "voicemails": voicemails,
                "no_answers": no_answers,
                "bad_numbers": bad_numbers,
                "pickup_rate": pickup_rate,
                "interest_rate": interest_rate,
                "days_back": days_back,
            }

    def get_dial_check(self, minutes_back: int = 15) -> dict[str, Any]:
        self.initialize()
        now = datetime.now(timezone.utc)
        cutoff = (now - timedelta(minutes=minutes_back)).isoformat()
        today_start = now.replace(hour=0, minute=0, second=0, microsecond=0).isoformat()
        today_date = now.strftime("%Y-%m-%d")
        with self._connect() as conn:
            recent_dials = conn.execute(
                "SELECT COUNT(*) as cnt FROM call_attempts WHERE called_at >= ?",
                (cutoff,),
            ).fetchone()["cnt"]
            today_dials = conn.execute(
                "SELECT COUNT(*) as cnt FROM call_attempts WHERE called_at >= ?",
                (today_start,),
            ).fetchone()["cnt"]
            today_recordings = conn.execute(
                "SELECT COUNT(*) as cnt FROM call_recordings WHERE call_date >= ?",
                (today_date,),
            ).fetchone()["cnt"]
            return {
                "recent_dials": recent_dials,
                "recent_minutes": minutes_back,
                "today_dials": today_dials,
                "today_recordings": today_recordings,
            }

    def get_daily_activity(self, days_back: int = 30) -> list[dict[str, Any]]:
        self.initialize()
        cutoff = (datetime.now(timezone.utc) - timedelta(days=days_back)).isoformat()
        with self._connect() as conn:
            rows = conn.execute(
                "SELECT DATE(created_at) as day, "
                "SUM(CASE WHEN to_status IN ('contacted', 'interested', 'not_interested') THEN 1 ELSE 0 END) as calls, "
                "SUM(CASE WHEN to_status = 'interested' THEN 1 ELSE 0 END) as interested, "
                "SUM(CASE WHEN to_status = 'queued' THEN 1 ELSE 0 END) as queued, "
                "COUNT(*) as total_transitions "
                "FROM lead_status_history WHERE created_at >= ? "
                "GROUP BY DATE(created_at) ORDER BY day",
                (cutoff,),
            ).fetchall()
            return [dict(r) for r in rows]

    def get_tracker_kpis(self) -> dict[str, Any]:
        self.initialize()
        now = datetime.now(timezone.utc)
        today_start = now.replace(hour=0, minute=0, second=0, microsecond=0).isoformat()
        week_start = (now - timedelta(days=now.weekday())).replace(
            hour=0, minute=0, second=0, microsecond=0
        ).isoformat()
        _non_convo = (
            "'no_answer','voicemail','busy','disconnected','wrong_number','bad_number'"
        )
        with self._connect() as conn:
            calls_today = conn.execute(
                "SELECT COUNT(*) as cnt FROM call_attempts WHERE called_at >= ?",
                (today_start,),
            ).fetchone()["cnt"]
            status_calls_today = conn.execute(
                "SELECT COUNT(*) as cnt FROM lead_status_history "
                "WHERE to_status IN ('contacted', 'interested', 'not_interested') "
                "AND created_at >= ?",
                (today_start,),
            ).fetchone()["cnt"]
            total_calls_today = max(calls_today, status_calls_today)

            today_dispositions = conn.execute(
                "SELECT disposition, COUNT(*) as cnt FROM call_attempts "
                "WHERE called_at >= ? GROUP BY disposition",
                (today_start,),
            ).fetchall()
            disposition_breakdown = {r["disposition"]: r["cnt"] for r in today_dispositions}

            pickups_today = conn.execute(
                f"SELECT COUNT(*) as cnt FROM call_attempts "
                f"WHERE disposition NOT IN ({_non_convo}) "
                f"AND called_at >= ?",
                (today_start,),
            ).fetchone()["cnt"]

            voicemails_today = disposition_breakdown.get("voicemail", 0)
            bad_numbers_today = disposition_breakdown.get("bad_number", 0)

            real_leads_week = conn.execute(
                "SELECT COUNT(DISTINCT lead_id) as cnt FROM lead_status_history "
                "WHERE to_status = 'interested' AND created_at >= ?",
                (week_start,),
            ).fetchone()["cnt"]

            calls_week = conn.execute(
                "SELECT COUNT(*) as cnt FROM call_attempts WHERE called_at >= ?",
                (week_start,),
            ).fetchone()["cnt"]

            daily_rows = conn.execute(
                "SELECT DATE(a.called_at) as day, "
                "COUNT(*) as calls, "
                f"SUM(CASE WHEN a.disposition NOT IN ({_non_convo}) THEN 1 ELSE 0 END) as convos, "
                "SUM(CASE WHEN a.disposition = 'interested' THEN 1 ELSE 0 END) as leads "
                "FROM call_attempts a "
                "WHERE a.called_at >= ? "
                "GROUP BY DATE(a.called_at) ORDER BY day",
                ((now - timedelta(days=14)).isoformat(),),
            ).fetchall()
            history = [dict(r) for r in daily_rows]

            pickup_rate = round(pickups_today / total_calls_today * 100, 1) if total_calls_today else 0

            return {
                "calls_today": total_calls_today,
                "real_convos_today": pickups_today,
                "voicemails_today": voicemails_today,
                "bad_numbers_today": bad_numbers_today,
                "pickup_rate": pickup_rate,
                "real_leads_week": real_leads_week,
                "calls_week": calls_week,
                "disposition_breakdown": disposition_breakdown,
                "history": history,
            }

    def get_dial_streak(self) -> dict[str, Any]:
        self.initialize()
        with self._connect() as conn:
            rows = conn.execute(
                "SELECT DISTINCT DATE(called_at) as day FROM call_attempts ORDER BY day DESC"
            ).fetchall()
            days = [r["day"] for r in rows]
            if not days:
                return {"current_streak": 0, "best_streak": 0, "total_active_days": 0, "last_dial_date": None}
            today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
            yesterday = (datetime.now(timezone.utc) - timedelta(days=1)).strftime("%Y-%m-%d")
            current = 0
            if days[0] == today or days[0] == yesterday:
                current = 1
                for i in range(1, len(days)):
                    prev = (datetime.strptime(days[i - 1], "%Y-%m-%d") - timedelta(days=1)).strftime("%Y-%m-%d")
                    if days[i] == prev:
                        current += 1
                    else:
                        break
            best = 0
            streak = 1
            for i in range(1, len(days)):
                prev = (datetime.strptime(days[i - 1], "%Y-%m-%d") - timedelta(days=1)).strftime("%Y-%m-%d")
                if days[i] == prev:
                    streak += 1
                else:
                    best = max(best, streak)
                    streak = 1
            best = max(best, streak, current)
            return {
                "current_streak": current,
                "best_streak": best,
                "total_active_days": len(days),
                "last_dial_date": days[0],
            }

    def get_lead_attempt_counts(self, lead_ids: list[str] | None = None) -> dict[str, dict[str, Any]]:
        with self._connect() as conn:
            if lead_ids:
                placeholders = ",".join("?" * len(lead_ids))
                rows = conn.execute(
                    f"""
                    SELECT lead_id,
                      COUNT(*) as total_attempts,
                      MAX(called_at) as last_called_at,
                      SUM(CASE WHEN disposition = 'bad_number' THEN 1 ELSE 0 END) as bad_number_count
                    FROM call_attempts
                    WHERE lead_id IN ({placeholders})
                    GROUP BY lead_id
                    """,
                    lead_ids,
                ).fetchall()
            else:
                rows = conn.execute(
                    """
                    SELECT lead_id,
                      COUNT(*) as total_attempts,
                      MAX(called_at) as last_called_at,
                      SUM(CASE WHEN disposition = 'bad_number' THEN 1 ELSE 0 END) as bad_number_count
                    FROM call_attempts
                    GROUP BY lead_id
                    """
                ).fetchall()
            return {r["lead_id"]: dict(r) for r in rows}

    def get_source_roi(self) -> list[dict[str, Any]]:
        self.initialize()
        with self._connect() as conn:
            rows = conn.execute("""
                SELECT l.source,
                    COUNT(*) as total_leads,
                    SUM(CASE WHEN l.status = 'queued' THEN 1 ELSE 0 END) as queued,
                    SUM(CASE WHEN l.status = 'contacted' THEN 1 ELSE 0 END) as contacted,
                    SUM(CASE WHEN l.status = 'interested' THEN 1 ELSE 0 END) as interested,
                    SUM(CASE WHEN l.status IN ('underwriting', 'under_contract') THEN 1 ELSE 0 END) as in_underwriting,
                    SUM(CASE WHEN l.status = 'closed_won' THEN 1 ELSE 0 END) as closed_won
                FROM leads l
                GROUP BY l.source
                ORDER BY total_leads DESC
            """).fetchall()
            return [dict(r) for r in rows]

    def record_discord_ref(
        self,
        *,
        guild_id: str | None,
        channel_id: str | None,
        thread_id: str | None,
        message_id: str,
        lead_id: str | None,
        event_message_id: str | None,
        query_text: str | None,
    ) -> dict[str, Any]:
        self.initialize()
        created_at = now_iso()
        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO discord_refs (
                  guild_id,
                  channel_id,
                  thread_id,
                  message_id,
                  lead_id,
                  event_message_id,
                  query_text,
                  created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    guild_id,
                    channel_id,
                    thread_id,
                    message_id,
                    lead_id,
                    event_message_id,
                    query_text,
                    created_at,
                ),
            )
        return {
            "status": "recorded",
            "message_id": message_id,
            "lead_id": lead_id,
            "event_message_id": event_message_id,
        }

    def handle_discord_command(
        self,
        *,
        text: str,
        guild_id: str | None = None,
        channel_id: str | None = None,
        thread_id: str | None = None,
        message_id: str | None = None,
    ) -> dict[str, Any]:
        cleaned = str(text or "").strip()
        cleaned = re.sub(r"^<@!?[0-9]+>\s*", "", cleaned)
        cleaned = re.sub(r"^@alfred\s+", "", cleaned, flags=re.IGNORECASE)
        cleaned = cleaned.strip()
        if not cleaned:
            return {"status": "error", "response": "No command text provided."}

        parts = cleaned.split()
        command = parts[0].lower()
        remainder = " ".join(parts[1:]).strip()

        if command == "lead":
            data = self.query_leads(remainder, limit=10)
        elif command == "owner":
            data = self.query_owners(remainder, limit=10)
        elif command == "property":
            data = self.query_properties(remainder, limit=10)
        elif command == "queue":
            kind = parts[1].lower() if len(parts) > 1 and parts[1].lower() in {"hot", "all"} else "hot"
            data = self.query_queue(kind, limit=25)
        elif command == "outstanding":
            mapping = {
                "skip-trace": "skip-trace",
                "skip_trace": "skip-trace",
                "underwrite": "underwrite",
                "bridge": "bridge",
            }
            kind = mapping.get(parts[1].lower() if len(parts) > 1 else "", "bridge")
            data = self.query_outstanding(kind, limit=25)
        elif command == "event":
            data = self.get_event(remainder)
        elif command == "quota":
            data = self.get_latest_quota()
        else:
            return {"status": "error", "response": f"Unsupported Discord command: {command}"}

        linked_lead_id = None
        linked_event_id = None
        if isinstance(data, list) and data:
            linked_lead_id = data[0].get("lead_id")
            linked_event_id = data[0].get("message_id") or data[0].get("event_message_id")
        elif isinstance(data, dict) and data:
            linked_lead_id = data.get("lead_id")
            linked_event_id = data.get("message_id") or data.get("event_message_id")

        if message_id:
            self.record_discord_ref(
                guild_id=guild_id,
                channel_id=channel_id,
                thread_id=thread_id,
                message_id=message_id,
                lead_id=linked_lead_id,
                event_message_id=linked_event_id,
                query_text=text,
            )

        return {
            "status": "ok",
            "command": command,
            "data": data,
            "response": self._render_command_response(command, data),
            "lead_id": linked_lead_id,
            "event_message_id": linked_event_id,
        }

    def _ensure_layout(self) -> None:
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self.artifacts_dir.mkdir(parents=True, exist_ok=True)
        self.exports_dir.mkdir(parents=True, exist_ok=True)

    @contextmanager
    def _connect(self) -> Iterable[sqlite3.Connection]:
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode = WAL")
        conn.execute("PRAGMA foreign_keys = ON")
        conn.execute("PRAGMA synchronous = NORMAL")
        try:
            yield conn
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()

    def _initialize_schema(self, conn: sqlite3.Connection) -> None:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS bridge_events (
              message_id TEXT PRIMARY KEY,
              correlation_id TEXT,
              envelope_type TEXT NOT NULL,
              command_type TEXT,
              lane TEXT,
              received_at TEXT NOT NULL,
              status TEXT,
              raw_json TEXT NOT NULL,
              raw_summary TEXT
            );

            CREATE TABLE IF NOT EXISTS bridge_event_errors (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              event_message_id TEXT NOT NULL,
              code TEXT NOT NULL,
              message TEXT,
              item_ref TEXT,
              created_at TEXT NOT NULL,
              FOREIGN KEY (event_message_id) REFERENCES bridge_events(message_id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS bridge_artifacts (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              event_message_id TEXT NOT NULL,
              artifact_type TEXT NOT NULL,
              path TEXT NOT NULL,
              created_at TEXT NOT NULL,
              UNIQUE(event_message_id, artifact_type, path),
              FOREIGN KEY (event_message_id) REFERENCES bridge_events(message_id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS command_queue (
              sequence INTEGER PRIMARY KEY AUTOINCREMENT,
              message_id TEXT NOT NULL UNIQUE,
              lane TEXT NOT NULL,
              queued_at TEXT NOT NULL,
              delivered_at TEXT,
              raw_json TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS properties (
              property_id TEXT PRIMARY KEY,
              lane TEXT NOT NULL,
              address_full TEXT,
              address_street TEXT,
              address_city TEXT,
              address_state TEXT,
              address_zip TEXT,
              latitude REAL,
              longitude REAL,
              property_type TEXT,
              year_built INTEGER,
              square_feet INTEGER,
              bedrooms REAL,
              bathrooms REAL,
              lot_size_sqft INTEGER,
              last_sale_date TEXT,
              last_sale_price INTEGER,
              current_tax_assessment INTEGER,
              parcel_number TEXT,
              property_detail_url TEXT,
              photo_urls_json TEXT,
              last_mls_status TEXT,
              distress_signals_json TEXT,
              propstream_arv_estimate INTEGER,
              propstream_equity INTEGER,
              propstream_ltv REAL,
              propstream_foreclosure_factor TEXT,
              skip_trace_count INTEGER,
              litigator INTEGER,
              owner_occupied INTEGER,
              do_not_mail INTEGER,
              raw_item_json TEXT,
              updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS property_aliases (
              source_property_ref TEXT PRIMARY KEY,
              property_id TEXT NOT NULL,
              lane TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              FOREIGN KEY (property_id) REFERENCES properties(property_id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS owners (
              owner_id TEXT PRIMARY KEY,
              property_id TEXT NOT NULL,
              owner_name TEXT,
              owner_type TEXT,
              mailing_address TEXT,
              mailing_address_distance_mi REAL,
              years_owned INTEGER,
              estimated_age INTEGER,
              raw_item_json TEXT,
              updated_at TEXT NOT NULL,
              FOREIGN KEY (property_id) REFERENCES properties(property_id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS owner_phones (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              owner_id TEXT NOT NULL,
              phone_value TEXT NOT NULL,
              phone_digits TEXT,
              phone_type TEXT,
              dnc INTEGER,
              source_event_message_id TEXT,
              updated_at TEXT NOT NULL,
              UNIQUE(owner_id, phone_value),
              FOREIGN KEY (owner_id) REFERENCES owners(owner_id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS owner_emails (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              owner_id TEXT NOT NULL,
              email_value TEXT NOT NULL,
              source_event_message_id TEXT,
              updated_at TEXT NOT NULL,
              UNIQUE(owner_id, email_value),
              FOREIGN KEY (owner_id) REFERENCES owners(owner_id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS leads (
              lead_id TEXT PRIMARY KEY,
              property_id TEXT NOT NULL,
              owner_id TEXT NOT NULL,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              source TEXT,
              status TEXT NOT NULL,
              persona_primary TEXT,
              persona_scores_json TEXT,
              distress_signals_json TEXT,
              distress_filed_dates_json TEXT,
              arv_estimate INTEGER,
              arv_confidence REAL,
              repair_estimate_low INTEGER,
              repair_estimate_high INTEGER,
              repair_confidence REAL,
              mao INTEGER,
              target_assignment_fee INTEGER,
              underwriting_confidence REAL,
              router_decision TEXT,
              router_reason TEXT,
              motivation_score INTEGER,
              motivation_tier TEXT,
              last_list_name TEXT,
              last_saved_at TEXT,
              last_skip_traced_at TEXT,
              last_exported_at TEXT,
              last_event_message_id TEXT,
              FOREIGN KEY (property_id) REFERENCES properties(property_id) ON DELETE CASCADE,
              FOREIGN KEY (owner_id) REFERENCES owners(owner_id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS lead_status_history (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              lead_id TEXT NOT NULL,
              from_status TEXT,
              to_status TEXT NOT NULL,
              reason TEXT,
              event_message_id TEXT,
              created_at TEXT NOT NULL,
              FOREIGN KEY (lead_id) REFERENCES leads(lead_id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS quota_snapshots (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              event_message_id TEXT NOT NULL,
              recorded_at TEXT NOT NULL,
              saves_used INTEGER,
              saves_cap INTEGER,
              exports_used INTEGER,
              exports_cap INTEGER,
              skip_traces_used INTEGER,
              skip_traces_cap INTEGER,
              monitored_used INTEGER,
              monitored_cap INTEGER,
              FOREIGN KEY (event_message_id) REFERENCES bridge_events(message_id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS discord_refs (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              guild_id TEXT,
              channel_id TEXT,
              thread_id TEXT,
              message_id TEXT NOT NULL,
              lead_id TEXT,
              event_message_id TEXT,
              query_text TEXT,
              created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS source_adapters (
              source_id TEXT PRIMARY KEY,
              source_name TEXT NOT NULL,
              data_quality_tier TEXT NOT NULL,
              enabled INTEGER NOT NULL DEFAULT 1,
              last_run_at TEXT,
              last_run_status TEXT,
              last_run_count INTEGER,
              config_json TEXT
            );

            CREATE TABLE IF NOT EXISTS lead_sources (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              lead_id TEXT NOT NULL,
              source_id TEXT NOT NULL,
              source_record_ref TEXT,
              ingested_at TEXT NOT NULL,
              data_quality TEXT,
              UNIQUE(lead_id, source_id),
              FOREIGN KEY (lead_id) REFERENCES leads(lead_id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS lead_notes (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              lead_id TEXT NOT NULL,
              note_type TEXT NOT NULL,
              content TEXT NOT NULL,
              created_at TEXT NOT NULL,
              FOREIGN KEY (lead_id) REFERENCES leads(lead_id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS lead_photos (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              lead_id TEXT NOT NULL,
              photo_url TEXT NOT NULL,
              photo_source TEXT,
              analysis_json TEXT,
              created_at TEXT NOT NULL,
              FOREIGN KEY (lead_id) REFERENCES leads(lead_id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS call_attempts (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              lead_id TEXT NOT NULL,
              disposition TEXT NOT NULL,
              notes TEXT,
              called_at TEXT NOT NULL,
              phone_number TEXT,
              FOREIGN KEY (lead_id) REFERENCES leads(lead_id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS follow_ups (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              lead_id TEXT NOT NULL,
              follow_up_type TEXT NOT NULL,
              scheduled_at TEXT NOT NULL,
              completed_at TEXT,
              outcome TEXT,
              notes TEXT,
              created_at TEXT NOT NULL,
              FOREIGN KEY (lead_id) REFERENCES leads(lead_id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS kpi_snapshots (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              snapshot_date TEXT NOT NULL,
              total_leads INTEGER,
              leads_by_status_json TEXT,
              leads_by_tier_json TEXT,
              leads_by_source_json TEXT,
              deals_closed INTEGER DEFAULT 0,
              revenue_total INTEGER DEFAULT 0,
              avg_assignment_fee INTEGER,
              created_at TEXT NOT NULL
            );

            -- Performance indexes for joins and common filters
            CREATE INDEX IF NOT EXISTS idx_leads_property_id ON leads(property_id);
            CREATE INDEX IF NOT EXISTS idx_leads_owner_id ON leads(owner_id);
            CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);
            CREATE INDEX IF NOT EXISTS idx_leads_source ON leads(source);
            CREATE INDEX IF NOT EXISTS idx_leads_motivation_tier ON leads(motivation_tier);
            CREATE INDEX IF NOT EXISTS idx_lead_status_history_lead_id ON lead_status_history(lead_id);
            CREATE INDEX IF NOT EXISTS idx_property_aliases_property_id ON property_aliases(property_id);
            CREATE INDEX IF NOT EXISTS idx_command_queue_lane_delivered ON command_queue(lane, delivered_at);
            CREATE INDEX IF NOT EXISTS idx_lead_sources_lead_id ON lead_sources(lead_id);
            CREATE INDEX IF NOT EXISTS idx_follow_ups_lead_id ON follow_ups(lead_id);

            CREATE VIRTUAL TABLE IF NOT EXISTS lead_search USING fts5(
              lead_id UNINDEXED,
              property_id UNINDEXED,
              address_full,
              address_zip,
              parcel_number,
              owner_name,
              mailing_address,
              phone_numbers,
              email_addresses,
              distress_signals,
              list_name,
              router_text,
              status_text,
              tokenize = 'unicode61'
            );

            CREATE VIEW IF NOT EXISTS v_needs_skip_trace AS
            SELECT
              l.lead_id,
              l.status,
              l.updated_at,
              p.address_full,
              p.address_zip,
              o.owner_name
            FROM leads l
            JOIN properties p ON p.property_id = l.property_id
            JOIN owners o ON o.owner_id = l.owner_id
            WHERE NOT EXISTS (
              SELECT 1 FROM owner_phones op WHERE op.owner_id = l.owner_id
            )
              AND NOT EXISTS (
                SELECT 1 FROM owner_emails oe WHERE oe.owner_id = l.owner_id
              )
              AND l.status NOT IN ('closed', 'dead');

            CREATE VIEW IF NOT EXISTS v_needs_underwrite AS
            SELECT
              l.lead_id,
              l.status,
              l.updated_at,
              p.address_full,
              p.address_zip,
              o.owner_name
            FROM leads l
            JOIN properties p ON p.property_id = l.property_id
            JOIN owners o ON o.owner_id = l.owner_id
            WHERE l.status IN ('new', 'enriched')
              AND l.mao IS NULL
              AND l.underwriting_confidence IS NULL;

            CREATE VIEW IF NOT EXISTS v_open_bridge_issues AS
            SELECT
              e.message_id,
              e.received_at,
              e.command_type,
              err.code,
              err.message,
              err.item_ref
            FROM bridge_events e
            JOIN bridge_event_errors err ON err.event_message_id = e.message_id
            WHERE err.code IN (
              'SESSION_EXPIRED',
              'CAPTCHA_REQUIRED',
              'DOM_SELECTOR_MISSING',
              'QUOTA_CHECK_REQUIRED',
              'QUOTA_LOCAL_HALT',
              'QUOTA_REMOTE_EXHAUSTED'
            )
            ORDER BY e.received_at DESC, err.id DESC;

            CREATE TABLE IF NOT EXISTS pending_verification (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              source TEXT NOT NULL,
              address_street TEXT NOT NULL,
              address_city TEXT NOT NULL,
              address_state TEXT,
              address_zip TEXT,
              owner_name TEXT,
              source_ref TEXT,
              batch_id TEXT,
              status TEXT NOT NULL DEFAULT 'pending',
              created_at TEXT NOT NULL,
              verified_at TEXT
            );

            CREATE INDEX IF NOT EXISTS idx_pending_verification_status ON pending_verification(status);
            CREATE INDEX IF NOT EXISTS idx_pending_verification_batch ON pending_verification(batch_id);

            CREATE TABLE IF NOT EXISTS background_jobs (
              job_id TEXT PRIMARY KEY,
              job_type TEXT NOT NULL,
              status TEXT NOT NULL DEFAULT 'pending',
              phase TEXT,
              log_lines_json TEXT DEFAULT '[]',
              started_at TEXT,
              completed_at TEXT,
              result_json TEXT,
              error TEXT,
              retry_count INTEGER DEFAULT 0,
              created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS call_recordings (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              seller_name TEXT NOT NULL,
              property_address TEXT,
              call_date TEXT,
              file_path TEXT,
              file_name TEXT,
              file_type TEXT,
              transcript TEXT,
              my_performance_json TEXT,
              seller_motivation_json TEXT,
              call_score TEXT,
              next_action TEXT,
              next_action_due TEXT,
              notes TEXT,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_call_recordings_score ON call_recordings(call_score);
            CREATE INDEX IF NOT EXISTS idx_call_recordings_call_date ON call_recordings(call_date);
            """,
        )
        self._migrate_propstream_verified(conn)
        self._migrate_evaluation_and_underwriting(conn)
        self._migrate_agent_system(conn)
        self._migrate_call_attempts_phone(conn)
        self._migrate_contracts(conn)
        self._migrate_bad_number_flag(conn)
        self._migrate_users(conn)

    def _migrate_call_attempts_phone(self, conn: sqlite3.Connection) -> None:
        cols = {row[1] for row in conn.execute("PRAGMA table_info(call_attempts)").fetchall()}
        if "phone_number" not in cols:
            conn.execute("ALTER TABLE call_attempts ADD COLUMN phone_number TEXT")

    def _migrate_contracts(self, conn: sqlite3.Connection) -> None:
        existing = {row[0] for row in conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table'"
        ).fetchall()}
        if "contracts" not in existing:
            conn.executescript("""
                CREATE TABLE contracts (
                  id INTEGER PRIMARY KEY AUTOINCREMENT,
                  lead_id TEXT NOT NULL,
                  contract_type TEXT NOT NULL DEFAULT 'option_agreement',
                  status TEXT NOT NULL DEFAULT 'draft',
                  contract_data_json TEXT NOT NULL,
                  purchaser_name TEXT,
                  purchaser_address TEXT,
                  seller_name TEXT,
                  seller_address TEXT,
                  property_address TEXT,
                  property_county TEXT,
                  property_state TEXT,
                  option_fee INTEGER,
                  purchase_price INTEGER,
                  amount_due_at_closing INTEGER,
                  option_term_end_date TEXT,
                  closing_date TEXT,
                  purchaser_signature TEXT,
                  purchaser_signed_at TEXT,
                  seller_signature TEXT,
                  seller_signed_at TEXT,
                  signing_token TEXT UNIQUE,
                  signing_url TEXT,
                  signing_email_sent_at TEXT,
                  seller_email TEXT,
                  pdf_path TEXT,
                  signed_pdf_path TEXT,
                  created_at TEXT NOT NULL,
                  updated_at TEXT NOT NULL,
                  FOREIGN KEY (lead_id) REFERENCES leads(lead_id) ON DELETE CASCADE
                );
                CREATE INDEX idx_contracts_lead_id ON contracts(lead_id);
                CREATE INDEX idx_contracts_status ON contracts(status);
                CREATE INDEX idx_contracts_signing_token ON contracts(signing_token);
            """)
        if "user_settings" not in existing:
            conn.executescript("""
                CREATE TABLE user_settings (
                  key TEXT PRIMARY KEY,
                  value TEXT NOT NULL,
                  updated_at TEXT NOT NULL
                );
            """)

    def _migrate_bad_number_flag(self, conn: sqlite3.Connection) -> None:
        cols = {row[1] for row in conn.execute("PRAGMA table_info(owner_phones)").fetchall()}
        if "bad_number" not in cols:
            conn.execute("ALTER TABLE owner_phones ADD COLUMN bad_number INTEGER DEFAULT 0")
            conn.execute("""
                UPDATE owner_phones SET bad_number = 1
                WHERE phone_digits IN (
                    SELECT DISTINCT phone_number FROM call_attempts
                    WHERE disposition = 'bad_number' AND phone_number IS NOT NULL AND phone_number != ''
                )
            """)

    def _migrate_users(self, conn: sqlite3.Connection) -> None:
        existing = {row[0] for row in conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table'"
        ).fetchall()}
        if "users" not in existing:
            conn.executescript("""
                CREATE TABLE users (
                  id INTEGER PRIMARY KEY AUTOINCREMENT,
                  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
                  display_name TEXT NOT NULL,
                  password_hash TEXT NOT NULL,
                  role TEXT NOT NULL DEFAULT 'caller',
                  permissions_json TEXT DEFAULT '[]',
                  active INTEGER DEFAULT 1,
                  created_at TEXT NOT NULL,
                  updated_at TEXT NOT NULL
                );
                CREATE TABLE sessions (
                  token TEXT PRIMARY KEY,
                  user_id INTEGER NOT NULL,
                  created_at TEXT NOT NULL,
                  expires_at TEXT,
                  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
                );
                CREATE INDEX idx_sessions_user ON sessions(user_id);
            """)
            self._seed_admin_user(conn)

    def _seed_admin_user(self, conn: sqlite3.Connection) -> None:
        ts = now_iso()
        pw_hash = hashlib.sha256(b"admin").hexdigest()
        conn.execute(
            """INSERT OR IGNORE INTO users
               (username, display_name, password_hash, role, permissions_json, active, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            ("admin", "Adil", pw_hash, "admin", json.dumps(["*"]), 1, ts, ts),
        )

    # ── User & Auth ────────────────────────────────────────────────────

    def _hash_password(self, password: str) -> str:
        return hashlib.sha256(password.encode("utf-8")).hexdigest()

    def authenticate(self, username: str, password: str) -> dict[str, Any] | None:
        with self._connect() as conn:
            row = conn.execute(
                "SELECT * FROM users WHERE username = ? AND active = 1",
                (username,),
            ).fetchone()
            if not row:
                return None
            user = dict(row)
            if user["password_hash"] != self._hash_password(password):
                return None
            import uuid
            token = uuid.uuid4().hex
            ts = now_iso()
            expires = (datetime.now(timezone.utc) + timedelta(days=30)).isoformat()
            conn.execute(
                "INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
                (token, user["id"], ts, expires),
            )
            user.pop("password_hash", None)
            return {"user": user, "token": token}

    def validate_session(self, token: str) -> dict[str, Any] | None:
        with self._connect() as conn:
            row = conn.execute(
                """SELECT u.* FROM sessions s
                   JOIN users u ON u.id = s.user_id
                   WHERE s.token = ? AND u.active = 1""",
                (token,),
            ).fetchone()
            if not row:
                return None
            user = dict(row)
            user.pop("password_hash", None)
            return user

    def logout(self, token: str) -> None:
        with self._connect() as conn:
            conn.execute("DELETE FROM sessions WHERE token = ?", (token,))

    def list_users(self) -> list[dict[str, Any]]:
        with self._connect() as conn:
            rows = conn.execute(
                "SELECT id, username, display_name, role, permissions_json, active, created_at, updated_at FROM users ORDER BY id"
            ).fetchall()
            return [dict(r) for r in rows]

    def create_user(self, username: str, display_name: str, password: str,
                    role: str = "caller", permissions: list[str] | None = None) -> dict[str, Any]:
        ts = now_iso()
        pw_hash = self._hash_password(password)
        perms = permissions or self._default_permissions(role)
        with self._connect() as conn:
            cur = conn.execute(
                """INSERT INTO users (username, display_name, password_hash, role, permissions_json, active, created_at, updated_at)
                   VALUES (?, ?, ?, ?, ?, 1, ?, ?)""",
                (username, display_name, pw_hash, role, json.dumps(perms), ts, ts),
            )
            return {
                "id": cur.lastrowid, "username": username, "display_name": display_name,
                "role": role, "permissions_json": json.dumps(perms), "active": 1,
                "created_at": ts, "updated_at": ts,
            }

    def update_user(self, user_id: int, **fields: Any) -> dict[str, Any] | None:
        allowed = {"display_name", "role", "active", "permissions_json"}
        updates, params = [], []
        for k, v in fields.items():
            if k in allowed:
                updates.append(f"{k} = ?")
                params.append(v)
        if "password" in fields and fields["password"]:
            updates.append("password_hash = ?")
            params.append(self._hash_password(fields["password"]))
        if not updates:
            return None
        updates.append("updated_at = ?")
        params.append(now_iso())
        params.append(user_id)
        with self._connect() as conn:
            conn.execute(f"UPDATE users SET {', '.join(updates)} WHERE id = ?", params)
            row = conn.execute(
                "SELECT id, username, display_name, role, permissions_json, active, created_at, updated_at FROM users WHERE id = ?",
                (user_id,),
            ).fetchone()
            return dict(row) if row else None

    def delete_user(self, user_id: int) -> bool:
        with self._connect() as conn:
            conn.execute("DELETE FROM sessions WHERE user_id = ?", (user_id,))
            conn.execute("DELETE FROM users WHERE id = ?", (user_id,))
            return True

    @staticmethod
    def _default_permissions(role: str) -> list[str]:
        if role == "admin":
            return ["*"]
        if role == "caller":
            return [
                "view:call_list", "view:dial_mode", "view:recordings",
                "view:own_kpi", "action:log_call", "action:add_note",
                "action:upload_recording",
            ]
        return []

    def _migrate_evaluation_and_underwriting(self, conn: sqlite3.Connection) -> None:
        lead_cols = {row[1] for row in conn.execute("PRAGMA table_info(leads)").fetchall()}
        if "evaluation_json" not in lead_cols:
            conn.execute("ALTER TABLE leads ADD COLUMN evaluation_json TEXT")

        fu_cols = {row[1] for row in conn.execute("PRAGMA table_info(follow_ups)").fetchall()}
        if "disposition" not in fu_cols:
            conn.execute("ALTER TABLE follow_ups ADD COLUMN disposition TEXT")
            conn.execute("ALTER TABLE follow_ups ADD COLUMN priority TEXT DEFAULT 'medium'")

        conn.executescript("""
            CREATE TABLE IF NOT EXISTS underwriting_reports (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              lead_id TEXT NOT NULL UNIQUE,
              arv_propstream INTEGER,
              arv_county INTEGER,
              arv_zillow INTEGER,
              arv_final INTEGER,
              arv_confidence REAL,
              arv_sources_json TEXT,
              repair_estimate_low INTEGER,
              repair_estimate_high INTEGER,
              repair_notes TEXT,
              mao_70 INTEGER,
              mao_65 INTEGER,
              assignment_fee_low INTEGER,
              assignment_fee_high INTEGER,
              cash_on_cash_buyer REAL,
              holding_costs INTEGER,
              photo_urls_json TEXT,
              street_view_url TEXT,
              zillow_url TEXT,
              county_assessor_url TEXT,
              propstream_url TEXT,
              condition_assessment TEXT,
              situation_summary TEXT,
              discrepancies_json TEXT,
              overall_grade TEXT,
              recommendation TEXT,
              status TEXT DEFAULT 'pending',
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              FOREIGN KEY (lead_id) REFERENCES leads(lead_id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_underwriting_reports_lead_id ON underwriting_reports(lead_id);
            CREATE INDEX IF NOT EXISTS idx_underwriting_reports_status ON underwriting_reports(status);
        """)

    def _migrate_propstream_verified(self, conn: sqlite3.Connection) -> None:
        cols = {row[1] for row in conn.execute("PRAGMA table_info(leads)").fetchall()}
        if "propstream_verified" not in cols:
            conn.execute("ALTER TABLE leads ADD COLUMN propstream_verified INTEGER DEFAULT 0")
            conn.execute("ALTER TABLE leads ADD COLUMN propstream_verified_at TEXT")
            conn.execute(
                "UPDATE leads SET propstream_verified = 1, propstream_verified_at = updated_at "
                "WHERE source = 'propstream'"
            )
        conn.execute("DROP VIEW IF EXISTS v_outstanding_leads")
        conn.execute("DROP VIEW IF EXISTS v_hot_queue")
        conn.executescript("""
            CREATE VIEW IF NOT EXISTS v_outstanding_leads AS
            SELECT
              l.lead_id,
              l.status,
              l.motivation_score,
              l.motivation_tier,
              l.updated_at,
              l.last_list_name,
              p.address_full,
              p.address_zip,
              o.owner_name
            FROM leads l
            JOIN properties p ON p.property_id = l.property_id
            JOIN owners o ON o.owner_id = l.owner_id
            WHERE l.status NOT IN ('closed', 'dead')
              AND EXISTS (SELECT 1 FROM owner_phones op WHERE op.owner_id = l.owner_id)
            ORDER BY COALESCE(l.motivation_score, -1) DESC, l.updated_at DESC;

            CREATE VIEW IF NOT EXISTS v_hot_queue AS
            SELECT * FROM v_outstanding_leads
            WHERE COALESCE(motivation_tier, '') = 'hot'
               OR COALESCE(motivation_score, 0) >= 80;
        """)

    def _migrate_agent_system(self, conn: sqlite3.Connection) -> None:
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS agent_definitions (
              agent_type TEXT PRIMARY KEY,
              display_name TEXT NOT NULL,
              description TEXT,
              prompt_template TEXT,
              schedule TEXT DEFAULT 'every 4h',
              enabled INTEGER DEFAULT 1,
              config_json TEXT DEFAULT '{}',
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS agent_runs (
              run_id TEXT PRIMARY KEY,
              agent_type TEXT NOT NULL,
              status TEXT NOT NULL DEFAULT 'running',
              phase TEXT DEFAULT 'starting',
              started_at TEXT NOT NULL,
              completed_at TEXT,
              leads_scanned INTEGER DEFAULT 0,
              proposals_created INTEGER DEFAULT 0,
              ai_calls_made INTEGER DEFAULT 0,
              ai_available INTEGER DEFAULT 1,
              log_lines_json TEXT DEFAULT '[]',
              error TEXT,
              result_json TEXT
            );
            CREATE TABLE IF NOT EXISTS proposals (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              agent_type TEXT NOT NULL,
              run_id TEXT NOT NULL,
              title TEXT NOT NULL,
              description TEXT,
              payload_json TEXT NOT NULL,
              priority TEXT DEFAULT 'medium',
              status TEXT NOT NULL DEFAULT 'pending',
              revision_notes TEXT,
              resolved_at TEXT,
              created_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_proposals_status ON proposals(status);
            CREATE INDEX IF NOT EXISTS idx_proposals_agent ON proposals(agent_type);
            CREATE INDEX IF NOT EXISTS idx_proposals_created ON proposals(created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_agent_runs_type ON agent_runs(agent_type);
            CREATE INDEX IF NOT EXISTS idx_agent_runs_status ON agent_runs(status);
        """)
        self._seed_agent_definitions(conn)

    def _seed_agent_definitions(self, conn: sqlite3.Connection) -> None:
        ts = now_iso()
        old_agents = ("lead_reviewer", "comp_analyst", "pipeline_janitor", "meta_reviewer")
        for old in old_agents:
            conn.execute("DELETE FROM agent_definitions WHERE agent_type = ?", (old,))

        agents = [
            ("scout", "Scout",
             "Acquisition & lead generation — skip-traces untraced leads, triggers source scrapes, ingests pending records, detects signal stacking",
             "every 2h"),
            ("dispatcher", "Dispatcher",
             "Call queue & outreach — prioritizes dial list, manages follow-ups, grades calls, generates daily call briefs",
             "every 3h"),
            ("analyst", "Analyst",
             "Deal analysis & underwriting — runs comps, calculates offers, flags bad deals, checks offer readiness",
             "every 4h"),
            ("operator", "Operator",
             "CRM hygiene & data ops — deduplicates leads, fixes stuck statuses, cleans uncontactable leads, audits source quality",
             "every 6h"),
            ("supervisor", "Supervisor",
             "Oversight & reporting — reviews all agents, consolidates noise, detects systemic issues, delivers daily ops digest",
             "every 4h"),
        ]
        for agent_type, name, desc, schedule in agents:
            conn.execute(
                """INSERT OR IGNORE INTO agent_definitions
                   (agent_type, display_name, description, schedule, created_at, updated_at)
                   VALUES (?, ?, ?, ?, ?, ?)""",
                (agent_type, name, desc, schedule, ts, ts),
            )

    # ── Agent CRUD ──────────────────────────────────────────────────

    def list_agent_definitions(self) -> list[dict[str, Any]]:
        with self._connect() as conn:
            rows = conn.execute(
                """SELECT d.*,
                   (SELECT run_id FROM agent_runs WHERE agent_type = d.agent_type
                    ORDER BY started_at DESC LIMIT 1) AS last_run_id,
                   (SELECT status FROM agent_runs WHERE agent_type = d.agent_type
                    ORDER BY started_at DESC LIMIT 1) AS last_run_status,
                   (SELECT started_at FROM agent_runs WHERE agent_type = d.agent_type
                    ORDER BY started_at DESC LIMIT 1) AS last_run_at
                FROM agent_definitions d ORDER BY d.agent_type"""
            ).fetchall()
            return [dict(r) for r in rows]

    def get_agent_definition(self, agent_type: str) -> dict[str, Any] | None:
        with self._connect() as conn:
            row = conn.execute(
                "SELECT * FROM agent_definitions WHERE agent_type = ?", (agent_type,)
            ).fetchone()
            return dict(row) if row else None

    def update_agent_config(self, agent_type: str, *,
                            schedule: str | None = None,
                            enabled: bool | None = None,
                            config_json: str | None = None,
                            prompt_template: str | None = None) -> dict[str, Any]:
        updates, params = [], []
        if schedule is not None:
            updates.append("schedule = ?"); params.append(schedule)
        if enabled is not None:
            updates.append("enabled = ?"); params.append(1 if enabled else 0)
        if config_json is not None:
            updates.append("config_json = ?"); params.append(config_json)
        if prompt_template is not None:
            updates.append("prompt_template = ?"); params.append(prompt_template)
        if not updates:
            return {"updated": False}
        updates.append("updated_at = ?"); params.append(now_iso())
        params.append(agent_type)
        with self._connect() as conn:
            conn.execute(
                f"UPDATE agent_definitions SET {', '.join(updates)} WHERE agent_type = ?",
                params,
            )
        return {"updated": True}

    def create_agent_run(self, run_id: str, agent_type: str) -> dict[str, Any]:
        ts = now_iso()
        with self._connect() as conn:
            conn.execute(
                """INSERT INTO agent_runs (run_id, agent_type, status, phase, started_at, log_lines_json)
                   VALUES (?, ?, 'running', 'starting', ?, '[]')""",
                (run_id, agent_type, ts),
            )
        return {"run_id": run_id, "status": "running"}

    def update_agent_run(self, run_id: str, *,
                         phase: str | None = None,
                         log_line: str | None = None,
                         status: str | None = None,
                         leads_scanned: int | None = None,
                         proposals_created: int | None = None,
                         ai_calls_made: int | None = None,
                         ai_available: bool | None = None,
                         result: Any = None,
                         error: str | None = None) -> None:
        with self._connect() as conn:
            if log_line:
                existing = conn.execute(
                    "SELECT log_lines_json FROM agent_runs WHERE run_id = ?", (run_id,)
                ).fetchone()
                if existing:
                    lines = json.loads(existing["log_lines_json"] or "[]")
                    lines.append({"t": now_iso(), "msg": log_line})
                    if len(lines) > 500:
                        lines = lines[-500:]
                    conn.execute(
                        "UPDATE agent_runs SET log_lines_json = ? WHERE run_id = ?",
                        (json.dumps(lines), run_id),
                    )
            updates, params = [], []
            if phase:
                updates.append("phase = ?"); params.append(phase)
            if status:
                updates.append("status = ?"); params.append(status)
                if status in ("completed", "failed"):
                    updates.append("completed_at = ?"); params.append(now_iso())
            if leads_scanned is not None:
                updates.append("leads_scanned = ?"); params.append(leads_scanned)
            if proposals_created is not None:
                updates.append("proposals_created = ?"); params.append(proposals_created)
            if ai_calls_made is not None:
                updates.append("ai_calls_made = ?"); params.append(ai_calls_made)
            if ai_available is not None:
                updates.append("ai_available = ?"); params.append(1 if ai_available else 0)
            if result is not None:
                updates.append("result_json = ?"); params.append(json.dumps(result, default=str))
            if error is not None:
                updates.append("error = ?"); params.append(error)
            if updates:
                params.append(run_id)
                conn.execute(
                    f"UPDATE agent_runs SET {', '.join(updates)} WHERE run_id = ?",
                    params,
                )

    def list_agent_runs(self, agent_type: str | None = None, limit: int = 20) -> list[dict[str, Any]]:
        with self._connect() as conn:
            if agent_type:
                rows = conn.execute(
                    "SELECT * FROM agent_runs WHERE agent_type = ? ORDER BY started_at DESC LIMIT ?",
                    (agent_type, limit),
                ).fetchall()
            else:
                rows = conn.execute(
                    "SELECT * FROM agent_runs ORDER BY started_at DESC LIMIT ?", (limit,)
                ).fetchall()
            return [dict(r) for r in rows]

    def get_agent_run(self, run_id: str) -> dict[str, Any] | None:
        with self._connect() as conn:
            row = conn.execute("SELECT * FROM agent_runs WHERE run_id = ?", (run_id,)).fetchone()
            return dict(row) if row else None

    def create_proposal(self, *, agent_type: str, run_id: str, title: str,
                        description: str | None = None, payload: dict,
                        priority: str = "medium") -> int:
        ts = now_iso()
        with self._connect() as conn:
            cur = conn.execute(
                """INSERT INTO proposals
                   (agent_type, run_id, title, description, payload_json, priority, status, created_at)
                   VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)""",
                (agent_type, run_id, title, description, json.dumps(payload, default=str),
                 priority, ts),
            )
            return cur.lastrowid

    def list_proposals(self, *, status: str | None = None, agent_type: str | None = None,
                       limit: int = 50) -> list[dict[str, Any]]:
        with self._connect() as conn:
            where, params = [], []
            if status:
                where.append("status = ?"); params.append(status)
            if agent_type:
                where.append("agent_type = ?"); params.append(agent_type)
            clause = f"WHERE {' AND '.join(where)}" if where else ""
            params.append(limit)
            rows = conn.execute(
                f"SELECT * FROM proposals {clause} ORDER BY created_at DESC LIMIT ?",
                params,
            ).fetchall()
            return [dict(r) for r in rows]

    def get_proposal(self, proposal_id: int) -> dict[str, Any] | None:
        with self._connect() as conn:
            row = conn.execute("SELECT * FROM proposals WHERE id = ?", (proposal_id,)).fetchone()
            return dict(row) if row else None

    def resolve_proposal(self, proposal_id: int, status: str,
                         notes: str | None = None) -> dict[str, Any]:
        ts = now_iso()
        with self._connect() as conn:
            conn.execute(
                "UPDATE proposals SET status = ?, revision_notes = ?, resolved_at = ? WHERE id = ?",
                (status, notes, ts, proposal_id),
            )
        return {"id": proposal_id, "status": status}

    def pending_proposal_count(self) -> int:
        with self._connect() as conn:
            row = conn.execute("SELECT COUNT(*) AS cnt FROM proposals WHERE status = 'pending'").fetchone()
            return row["cnt"] if row else 0

    def get_pending_proposal_patterns(self) -> list[dict[str, Any]]:
        with self._connect() as conn:
            rows = conn.execute("""
                SELECT agent_type, title, COUNT(*) as cnt,
                       GROUP_CONCAT(id) as ids,
                       MIN(created_at) as first_at, MAX(created_at) as last_at
                FROM proposals
                WHERE status = 'pending'
                GROUP BY agent_type, title
                HAVING cnt >= 3
                ORDER BY cnt DESC
            """).fetchall()
            return [dict(r) for r in rows]

    def bulk_deny_proposals(self, ids: list[int], reason: str) -> int:
        ts = now_iso()
        with self._connect() as conn:
            placeholders = ",".join("?" * len(ids))
            conn.execute(
                f"UPDATE proposals SET status = 'denied', revision_notes = ?, resolved_at = ? "
                f"WHERE id IN ({placeholders}) AND status = 'pending'",
                [reason, ts] + ids,
            )
            return len(ids)

    def execute_proposal_payload(self, proposal_id: int) -> dict[str, Any]:
        proposal = self.get_proposal(proposal_id)
        if not proposal:
            return {"error": "Proposal not found"}
        payload = json.loads(proposal["payload_json"])
        action = payload.get("action", "")

        if action == "update_status":
            lead_id = payload["lead_id"]
            new_status = payload["new_status"]
            reason = payload.get("reason", "Agent proposal approved")
            with self._connect() as conn:
                self._set_lead_status(
                    conn, lead_id=lead_id, to_status=new_status,
                    reason=reason, event_message_id=None, change_status=True,
                )
            return {"executed": True, "action": action, "lead_id": lead_id}

        if action == "bulk_update_status":
            lead_ids = payload["lead_ids"]
            new_status = payload["new_status"]
            reason = payload.get("reason", "Agent proposal approved")
            with self._connect() as conn:
                for lid in lead_ids:
                    self._set_lead_status(
                        conn, lead_id=lid, to_status=new_status,
                        reason=reason, event_message_id=None, change_status=True,
                    )
            return {"executed": True, "action": action, "count": len(lead_ids)}

        if action == "add_note":
            lead_id = payload["lead_id"]
            content = payload.get("content", "")
            note_type = payload.get("note_type", "agent")
            ts = now_iso()
            with self._connect() as conn:
                conn.execute(
                    "INSERT INTO lead_notes (lead_id, note_type, content, created_at) VALUES (?, ?, ?, ?)",
                    (lead_id, note_type, content, ts),
                )
            return {"executed": True, "action": action, "lead_id": lead_id}

        if action == "flag_duplicate":
            lead_id = payload["lead_id"]
            duplicate_of = payload.get("duplicate_of", "")
            reason = payload.get("reason", "Flagged as duplicate by agent")
            ts = now_iso()
            with self._connect() as conn:
                self._set_lead_status(
                    conn, lead_id=lead_id, to_status="dead",
                    reason=f"Duplicate of {duplicate_of}: {reason}",
                    event_message_id=None, change_status=True,
                )
                conn.execute(
                    "INSERT INTO lead_notes (lead_id, note_type, content, created_at) VALUES (?, ?, ?, ?)",
                    (lead_id, "agent", f"Duplicate of {duplicate_of}: {reason}", ts),
                )
            return {"executed": True, "action": action, "lead_id": lead_id}

        if action == "update_underwriting":
            lead_id = payload["lead_id"]
            ts = now_iso()
            with self._connect() as conn:
                existing = conn.execute(
                    "SELECT id FROM underwriting_reports WHERE lead_id = ?", (lead_id,)
                ).fetchone()
                fields = {k: v for k, v in payload.items() if k not in ("action", "lead_id")}
                if existing:
                    sets = ", ".join(f"{k} = ?" for k in fields)
                    vals = list(fields.values()) + [ts, lead_id]
                    conn.execute(f"UPDATE underwriting_reports SET {sets}, updated_at = ? WHERE lead_id = ?", vals)
                else:
                    fields["lead_id"] = lead_id
                    fields["created_at"] = ts
                    fields["updated_at"] = ts
                    cols = ", ".join(fields.keys())
                    placeholders = ", ".join("?" * len(fields))
                    conn.execute(f"INSERT INTO underwriting_reports ({cols}) VALUES ({placeholders})",
                                 list(fields.values()))
            return {"executed": True, "action": action, "lead_id": lead_id}

        if action == "consolidate_and_deny":
            deny_ids = payload.get("deny_proposal_ids", [])
            reason = payload.get("reason", "Consolidated by Supervisor")
            if deny_ids:
                self.bulk_deny_proposals(deny_ids, reason)
            return {"executed": True, "action": action, "denied": len(deny_ids)}

        if action == "escalate":
            return {"executed": True, "action": action, "note": "Escalation acknowledged"}

        if action == "daily_digest":
            return {"executed": True, "action": action, "note": "Digest acknowledged"}

        if action == "create_follow_up":
            lead_id = payload["lead_id"]
            fu_type = payload.get("follow_up_type", "callback")
            scheduled_at = payload.get("scheduled_at", "")
            notes = payload.get("notes", "")
            result = self.create_follow_up(lead_id, fu_type, scheduled_at, notes)
            return {"executed": True, "action": action, **result}

        if action == "complete_follow_up":
            fu_id = payload["follow_up_id"]
            outcome = payload.get("outcome", "completed")
            result = self.complete_follow_up(fu_id, outcome)
            return {"executed": True, "action": action, **result}

        if action in ("run_skip_trace", "run_underwriting", "run_scrape",
                       "run_evaluation", "run_verification", "grade_recording",
                       "transcribe_recording", "ingest_records"):
            return {"executed": True, "action": action,
                    "note": "Pipeline action — requires runtime execution (handled by orchestrator)"}

        return {"executed": False, "error": f"Unknown action: {action}"}

    def _insert_bridge_event(self, conn: sqlite3.Connection, envelope: dict[str, Any]) -> dict[str, Any]:
        message_id = envelope["message_id"]
        payload = envelope.get("payload") or {}
        row = conn.execute(
            "SELECT message_id FROM bridge_events WHERE message_id = ?",
            (message_id,),
        ).fetchone()
        if row:
            return {"inserted": False, "message_id": message_id}

        command_type = str(payload.get("command_type") or "").upper() or None
        status = payload.get("status")
        received_at = envelope.get("timestamp") or now_iso()
        conn.execute(
            """
            INSERT INTO bridge_events (
              message_id,
              correlation_id,
              envelope_type,
              command_type,
              lane,
              received_at,
              status,
              raw_json,
              raw_summary
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                message_id,
                envelope.get("correlation_id"),
                envelope.get("type"),
                command_type,
                envelope.get("lane"),
                received_at,
                status,
                json_dumps(envelope),
                self._build_summary(envelope),
            ),
        )
        return {"inserted": True, "message_id": message_id}

    def _build_summary(self, envelope: dict[str, Any]) -> str:
        payload = envelope.get("payload") or {}
        errors = payload.get("errors") or []
        parts = [
            f"type={envelope.get('type')}",
            f"command={payload.get('command_type') or '-'}",
            f"status={payload.get('status') or '-'}",
            f"items={len(payload.get('items') or [])}",
            f"errors={len(errors)}",
        ]
        if errors:
            parts.append(
                "codes="
                + ",".join(str(error.get("code") or "UNKNOWN") for error in errors[:5])
            )
        return " ".join(parts)

    def _insert_quota_snapshot(
        self,
        conn: sqlite3.Connection,
        envelope: dict[str, Any],
        payload: dict[str, Any],
    ) -> None:
        quota = payload.get("quota_snapshot")
        if not isinstance(quota, dict):
            return
        conn.execute(
            """
            INSERT INTO quota_snapshots (
              event_message_id,
              recorded_at,
              saves_used,
              saves_cap,
              exports_used,
              exports_cap,
              skip_traces_used,
              skip_traces_cap,
              monitored_used,
              monitored_cap
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                envelope["message_id"],
                envelope.get("timestamp") or now_iso(),
                quota.get("saves_used"),
                quota.get("saves_cap"),
                quota.get("exports_used"),
                quota.get("exports_cap"),
                quota.get("skip_traces_used"),
                quota.get("skip_traces_cap"),
                quota.get("monitored_used"),
                quota.get("monitored_cap"),
            ),
        )

    def _insert_event_errors(
        self,
        conn: sqlite3.Connection,
        envelope: dict[str, Any],
        payload: dict[str, Any],
    ) -> None:
        errors = payload.get("errors") or []
        created_at = envelope.get("timestamp") or now_iso()
        for error in errors:
            conn.execute(
                """
                INSERT INTO bridge_event_errors (
                  event_message_id,
                  code,
                  message,
                  item_ref,
                  created_at
                ) VALUES (?, ?, ?, ?, ?)
                """,
                (
                    envelope["message_id"],
                    error.get("code") or "UNKNOWN",
                    error.get("message"),
                    error.get("item_ref"),
                    created_at,
                ),
            )

    def _persist_export_artifact(
        self,
        conn: sqlite3.Connection,
        envelope: dict[str, Any],
        *,
        export_csv_path: str | None,
    ) -> str | None:
        if not export_csv_path:
            return None
        source = Path(export_csv_path)
        if not source.exists():
            return None
        stamp = normalize_token(envelope.get("timestamp") or now_iso()) or now_iso()
        target = self.exports_dir / f"{stamp}-{envelope['message_id']}.csv"
        shutil.copyfile(source, target)
        conn.execute(
            """
            INSERT OR IGNORE INTO bridge_artifacts (
              event_message_id,
              artifact_type,
              path,
              created_at
            ) VALUES (?, ?, ?, ?)
            """,
            (
                envelope["message_id"],
                "export_csv",
                str(target),
                now_iso(),
            ),
        )
        return str(target)

    def _project_search(self, conn: sqlite3.Connection, envelope: dict[str, Any]) -> None:
        payload = envelope.get("payload") or {}
        for item in payload.get("items") or []:
            refs = self._upsert_canonical_entities(
                conn,
                item=item,
                lane=envelope.get("lane") or "houses",
                event_message_id=envelope["message_id"],
            )
            self._set_lead_status(
                conn,
                lead_id=refs["lead_id"],
                to_status="new",
                reason="SEARCH result",
                event_message_id=envelope["message_id"],
                change_status=True,
            )

    def _project_save(self, conn: sqlite3.Connection, envelope: dict[str, Any]) -> None:
        payload = envelope.get("payload") or {}
        command_payload = self._load_correlated_command_payload(conn, envelope)
        list_name = command_payload.get("list_name") or payload.get("list_name")
        saved_at = envelope.get("timestamp") or now_iso()
        for item in payload.get("items") or []:
            refs = self._resolve_refs_from_property_ref(
                conn,
                property_ref=item.get("property_id"),
                lane=envelope.get("lane") or "houses",
            )
            if not refs:
                continue
            conn.execute(
                """
                UPDATE leads
                SET last_list_name = COALESCE(?, last_list_name),
                    last_saved_at = ?,
                    last_event_message_id = ?,
                    updated_at = ?
                WHERE lead_id = ?
                """,
                (
                    list_name,
                    saved_at,
                    envelope["message_id"],
                    saved_at,
                    refs["lead_id"],
                ),
            )
            current = self._get_lead_status(conn, refs["lead_id"])
            self._set_lead_status(
                conn,
                lead_id=refs["lead_id"],
                to_status=current or "new",
                reason="SAVE result",
                event_message_id=envelope["message_id"],
                change_status=False,
            )
            self._refresh_lead_search(conn, refs["lead_id"])

    def _project_export(
        self,
        conn: sqlite3.Connection,
        envelope: dict[str, Any],
        *,
        artifact_path: str | None,
    ) -> None:
        payload = envelope.get("payload") or {}
        command_payload = self._load_correlated_command_payload(conn, envelope)
        list_name = command_payload.get("list_name") or payload.get("list_name")
        exported_at = envelope.get("timestamp") or now_iso()
        if artifact_path:
            rows = self._parse_export_csv(Path(artifact_path).read_text(encoding="utf-8"))
            if rows:
                items = [self._map_export_row(row, envelope.get("lane") or "houses") for row in rows]
            else:
                items = payload.get("items") or []
        else:
            items = payload.get("items") or []

        for item in items:
            lane = envelope.get("lane") or "houses"
            # Try to match existing lead before creating new entities
            refs = self._resolve_refs_from_property_ref(
                conn,
                property_ref=item.get("property_id"),
                lane=lane,
            )
            if not refs:
                refs = self._resolve_refs_by_address(
                    conn, item=item, lane=lane,
                )
            if not refs:
                refs = self._upsert_canonical_entities(
                    conn,
                    item=item,
                    lane=lane,
                    event_message_id=envelope["message_id"],
                )
            # Merge distress signals from new data with existing lead's signals
            existing_row = conn.execute(
                "SELECT distress_signals_json FROM leads WHERE lead_id = ?",
                (refs["lead_id"],)
            ).fetchone()
            existing_signals: list[str] = []
            if existing_row and existing_row["distress_signals_json"]:
                try:
                    existing_signals = json.loads(existing_row["distress_signals_json"])
                except (json.JSONDecodeError, TypeError):
                    pass
            new_signals = item.get("distress_signals") or []
            merged = list(dict.fromkeys(existing_signals + new_signals))
            item["distress_signals"] = merged
            # Attach contact info if present (phones/emails from skip-traced export)
            if self._item_has_contacts(item):
                self._upsert_contact_lists(
                    conn,
                    owner_id=refs["owner_id"],
                    item=item,
                    event_message_id=envelope["message_id"],
                )
            conn.execute(
                """
                UPDATE leads
                SET last_list_name = COALESCE(?, last_list_name),
                    last_exported_at = ?,
                    last_event_message_id = ?,
                    updated_at = ?
                WHERE lead_id = ?
                """,
                (
                    list_name,
                    exported_at,
                    envelope["message_id"],
                    exported_at,
                    refs["lead_id"],
                ),
            )
            if self._item_has_contacts(item):
                lead_source = (item.get("source") or "").lower()
                current_status = self._get_lead_status(conn, refs["lead_id"])
                if lead_source == "propstream" and current_status in (None, "new", "imported"):
                    to_status = "imported"
                else:
                    to_status = "enriched"
                self._set_lead_status(
                    conn,
                    lead_id=refs["lead_id"],
                    to_status=to_status,
                    reason="EXPORT result",
                    event_message_id=envelope["message_id"],
                    change_status=True,
                )
            self._refresh_lead_search(conn, refs["lead_id"])

    def _project_skip_trace(self, conn: sqlite3.Connection, envelope: dict[str, Any]) -> None:
        payload = envelope.get("payload") or {}
        skipped_at = envelope.get("timestamp") or now_iso()
        for item in payload.get("items") or []:
            lane = envelope.get("lane") or "houses"
            refs = self._resolve_refs_from_property_ref(
                conn,
                property_ref=item.get("property_id"),
                lane=lane,
            )
            if not refs:
                refs = self._resolve_refs_by_address(
                    conn, item=item, lane=lane,
                )
            if not refs:
                refs = self._upsert_canonical_entities(
                    conn,
                    item=item,
                    lane=lane,
                    event_message_id=envelope["message_id"],
                )
            # Merge distress signals from new data with existing lead's signals
            existing_row = conn.execute(
                "SELECT distress_signals_json FROM leads WHERE lead_id = ?",
                (refs["lead_id"],)
            ).fetchone()
            existing_signals: list[str] = []
            if existing_row and existing_row["distress_signals_json"]:
                try:
                    existing_signals = json.loads(existing_row["distress_signals_json"])
                except (json.JSONDecodeError, TypeError):
                    pass
            new_signals = item.get("distress_signals") or []
            merged = list(dict.fromkeys(existing_signals + new_signals))
            item["distress_signals"] = merged
            self._upsert_contact_lists(
                conn,
                owner_id=refs["owner_id"],
                item=item,
                event_message_id=envelope["message_id"],
            )
            conn.execute(
                """
                UPDATE leads
                SET last_skip_traced_at = ?,
                    last_event_message_id = ?,
                    updated_at = ?
                WHERE lead_id = ?
                """,
                (
                    skipped_at,
                    envelope["message_id"],
                    skipped_at,
                    refs["lead_id"],
                ),
            )
            if self._item_has_contacts(item):
                self._set_lead_status(
                    conn,
                    lead_id=refs["lead_id"],
                    to_status="enriched",
                    reason="SKIP_TRACE result",
                    event_message_id=envelope["message_id"],
                    change_status=True,
                )
            self._refresh_lead_search(conn, refs["lead_id"])

    def _project_harvest(self, conn: sqlite3.Connection, envelope: dict[str, Any]) -> None:
        """Process HARVEST result: extract export_rows and ingest like skip trace.

        A HARVEST result has items[0] containing summary counts and an
        ``export_rows`` list with the actual skip-traced property data
        (addresses + phone numbers).  We iterate the export rows and run
        the same contact-upsert logic as ``_project_skip_trace``.
        """
        payload = envelope.get("payload") or {}
        harvested_at = envelope.get("timestamp") or now_iso()
        for summary_item in payload.get("items") or []:
            export_rows = summary_item.get("export_rows") or []
            for item in export_rows:
                lane = envelope.get("lane") or "houses"
                refs = self._resolve_refs_from_property_ref(
                    conn,
                    property_ref=item.get("property_id"),
                    lane=lane,
                )
                # Fallback: try matching by street+city+state (handles zip mismatch)
                if not refs:
                    refs = self._resolve_refs_by_address(
                        conn,
                        item=item,
                        lane=lane,
                    )
                if not refs:
                    refs = self._upsert_canonical_entities(
                        conn,
                        item=item,
                        lane=lane,
                        event_message_id=envelope["message_id"],
                    )
                # Merge distress signals from new data with existing lead's signals
                existing_row = conn.execute(
                    "SELECT distress_signals_json FROM leads WHERE lead_id = ?",
                    (refs["lead_id"],)
                ).fetchone()
                existing_signals: list[str] = []
                if existing_row and existing_row["distress_signals_json"]:
                    try:
                        existing_signals = json.loads(existing_row["distress_signals_json"])
                    except (json.JSONDecodeError, TypeError):
                        pass
                new_signals = item.get("distress_signals") or []
                merged = list(dict.fromkeys(existing_signals + new_signals))
                item["distress_signals"] = merged
                self._upsert_contact_lists(
                    conn,
                    owner_id=refs["owner_id"],
                    item=item,
                    event_message_id=envelope["message_id"],
                )
                conn.execute(
                    """
                    UPDATE leads
                    SET last_skip_traced_at = ?,
                        last_event_message_id = ?,
                        updated_at = ?
                    WHERE lead_id = ?
                    """,
                    (
                        harvested_at,
                        envelope["message_id"],
                        harvested_at,
                        refs["lead_id"],
                    ),
                )
                if self._item_has_contacts(item):
                    self._set_lead_status(
                        conn,
                        lead_id=refs["lead_id"],
                        to_status="enriched",
                        reason="HARVEST result",
                        event_message_id=envelope["message_id"],
                        change_status=True,
                    )
                self._refresh_lead_search(conn, refs["lead_id"])

    def _upsert_canonical_entities(
        self,
        conn: sqlite3.Connection,
        *,
        item: dict[str, Any],
        lane: str,
        event_message_id: str,
    ) -> dict[str, str]:
        timestamp = now_iso()
        property_id = self._canonical_property_id(item, lane)
        owner_id = self._canonical_owner_id(item, property_id)
        lead_id = self._canonical_lead_id(property_id, owner_id)
        source_property_ref = str(item.get("property_id") or "").strip()

        conn.execute(
            """
            INSERT INTO properties (
              property_id,
              lane,
              address_full,
              address_street,
              address_city,
              address_state,
              address_zip,
              latitude,
              longitude,
              property_type,
              year_built,
              square_feet,
              bedrooms,
              bathrooms,
              lot_size_sqft,
              last_sale_date,
              last_sale_price,
              current_tax_assessment,
              parcel_number,
              property_detail_url,
              photo_urls_json,
              last_mls_status,
              distress_signals_json,
              propstream_arv_estimate,
              propstream_equity,
              propstream_ltv,
              propstream_foreclosure_factor,
              skip_trace_count,
              litigator,
              owner_occupied,
              do_not_mail,
              raw_item_json,
              updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(property_id) DO UPDATE SET
              address_full = COALESCE(excluded.address_full, properties.address_full),
              address_street = COALESCE(excluded.address_street, properties.address_street),
              address_city = COALESCE(excluded.address_city, properties.address_city),
              address_state = COALESCE(excluded.address_state, properties.address_state),
              address_zip = COALESCE(excluded.address_zip, properties.address_zip),
              latitude = COALESCE(excluded.latitude, properties.latitude),
              longitude = COALESCE(excluded.longitude, properties.longitude),
              property_type = COALESCE(excluded.property_type, properties.property_type),
              year_built = COALESCE(excluded.year_built, properties.year_built),
              square_feet = COALESCE(excluded.square_feet, properties.square_feet),
              bedrooms = COALESCE(excluded.bedrooms, properties.bedrooms),
              bathrooms = COALESCE(excluded.bathrooms, properties.bathrooms),
              lot_size_sqft = COALESCE(excluded.lot_size_sqft, properties.lot_size_sqft),
              last_sale_date = COALESCE(excluded.last_sale_date, properties.last_sale_date),
              last_sale_price = COALESCE(excluded.last_sale_price, properties.last_sale_price),
              current_tax_assessment = COALESCE(excluded.current_tax_assessment, properties.current_tax_assessment),
              parcel_number = COALESCE(excluded.parcel_number, properties.parcel_number),
              property_detail_url = COALESCE(excluded.property_detail_url, properties.property_detail_url),
              photo_urls_json = COALESCE(excluded.photo_urls_json, properties.photo_urls_json),
              last_mls_status = COALESCE(excluded.last_mls_status, properties.last_mls_status),
              distress_signals_json = COALESCE(excluded.distress_signals_json, properties.distress_signals_json),
              propstream_arv_estimate = COALESCE(excluded.propstream_arv_estimate, properties.propstream_arv_estimate),
              propstream_equity = COALESCE(excluded.propstream_equity, properties.propstream_equity),
              propstream_ltv = COALESCE(excluded.propstream_ltv, properties.propstream_ltv),
              propstream_foreclosure_factor = COALESCE(excluded.propstream_foreclosure_factor, properties.propstream_foreclosure_factor),
              skip_trace_count = COALESCE(excluded.skip_trace_count, properties.skip_trace_count),
              litigator = COALESCE(excluded.litigator, properties.litigator),
              owner_occupied = COALESCE(excluded.owner_occupied, properties.owner_occupied),
              do_not_mail = COALESCE(excluded.do_not_mail, properties.do_not_mail),
              raw_item_json = excluded.raw_item_json,
              updated_at = excluded.updated_at
            """,
            (
                property_id,
                lane,
                item.get("address_full"),
                item.get("address_street"),
                item.get("address_city"),
                item.get("address_state"),
                item.get("address_zip"),
                item.get("latitude"),
                item.get("longitude"),
                item.get("property_type"),
                item.get("year_built"),
                item.get("square_feet"),
                item.get("bedrooms"),
                item.get("bathrooms"),
                item.get("lot_size_sqft"),
                item.get("last_sale_date"),
                item.get("last_sale_price"),
                item.get("current_tax_assessment"),
                item.get("parcel_number"),
                item.get("property_detail_url"),
                json_dumps(item.get("photo_urls") or []),
                item.get("last_mls_status") or item.get("mls_status"),
                json_dumps(sorted(set(item.get("distress_signals") or []))),
                item.get("propstream_arv_estimate"),
                item.get("propstream_equity"),
                item.get("propstream_ltv"),
                item.get("propstream_foreclosure_factor"),
                item.get("skip_trace_count"),
                boolish(item.get("litigator")),
                boolish(item.get("owner_occupied")),
                boolish(item.get("do_not_mail")),
                json_dumps(item),
                timestamp,
            ),
        )

        if source_property_ref:
            conn.execute(
                """
                INSERT INTO property_aliases (source_property_ref, property_id, lane, updated_at)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(source_property_ref) DO UPDATE SET
                  property_id = excluded.property_id,
                  lane = excluded.lane,
                  updated_at = excluded.updated_at
                """,
                (source_property_ref, property_id, lane, timestamp),
            )

        conn.execute(
            """
            INSERT INTO owners (
              owner_id,
              property_id,
              owner_name,
              owner_type,
              mailing_address,
              mailing_address_distance_mi,
              years_owned,
              estimated_age,
              raw_item_json,
              updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(owner_id) DO UPDATE SET
              property_id = excluded.property_id,
              owner_name = COALESCE(excluded.owner_name, owners.owner_name),
              owner_type = COALESCE(excluded.owner_type, owners.owner_type),
              mailing_address = COALESCE(excluded.mailing_address, owners.mailing_address),
              mailing_address_distance_mi = COALESCE(excluded.mailing_address_distance_mi, owners.mailing_address_distance_mi),
              years_owned = COALESCE(excluded.years_owned, owners.years_owned),
              estimated_age = COALESCE(excluded.estimated_age, owners.estimated_age),
              raw_item_json = excluded.raw_item_json,
              updated_at = excluded.updated_at
            """,
            (
                owner_id,
                property_id,
                item.get("owner_name"),
                item.get("owner_type"),
                item.get("mailing_address"),
                item.get("mailing_address_distance_mi"),
                item.get("years_owned"),
                item.get("estimated_age"),
                json_dumps(item),
                timestamp,
            ),
        )

        conn.execute(
            """
            INSERT INTO leads (
              lead_id,
              property_id,
              owner_id,
              created_at,
              updated_at,
              source,
              status,
              persona_primary,
              persona_scores_json,
              distress_signals_json,
              distress_filed_dates_json,
              arv_estimate,
              arv_confidence,
              repair_estimate_low,
              repair_estimate_high,
              repair_confidence,
              mao,
              target_assignment_fee,
              underwriting_confidence,
              router_decision,
              router_reason,
              motivation_score,
              motivation_tier,
              last_event_message_id,
              propstream_verified,
              propstream_verified_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(lead_id) DO UPDATE SET
              property_id = excluded.property_id,
              owner_id = excluded.owner_id,
              updated_at = excluded.updated_at,
              source = COALESCE(excluded.source, leads.source),
              persona_primary = COALESCE(excluded.persona_primary, leads.persona_primary),
              persona_scores_json = COALESCE(excluded.persona_scores_json, leads.persona_scores_json),
              distress_signals_json = COALESCE(excluded.distress_signals_json, leads.distress_signals_json),
              distress_filed_dates_json = COALESCE(excluded.distress_filed_dates_json, leads.distress_filed_dates_json),
              arv_estimate = COALESCE(excluded.arv_estimate, leads.arv_estimate),
              arv_confidence = COALESCE(excluded.arv_confidence, leads.arv_confidence),
              repair_estimate_low = COALESCE(excluded.repair_estimate_low, leads.repair_estimate_low),
              repair_estimate_high = COALESCE(excluded.repair_estimate_high, leads.repair_estimate_high),
              repair_confidence = COALESCE(excluded.repair_confidence, leads.repair_confidence),
              mao = COALESCE(excluded.mao, leads.mao),
              target_assignment_fee = COALESCE(excluded.target_assignment_fee, leads.target_assignment_fee),
              underwriting_confidence = COALESCE(excluded.underwriting_confidence, leads.underwriting_confidence),
              router_decision = COALESCE(excluded.router_decision, leads.router_decision),
              router_reason = COALESCE(excluded.router_reason, leads.router_reason),
              motivation_score = COALESCE(excluded.motivation_score, leads.motivation_score),
              motivation_tier = COALESCE(excluded.motivation_tier, leads.motivation_tier),
              last_event_message_id = excluded.last_event_message_id,
              propstream_verified = CASE WHEN excluded.propstream_verified = 1 THEN 1 ELSE leads.propstream_verified END,
              propstream_verified_at = COALESCE(excluded.propstream_verified_at, leads.propstream_verified_at)
            """,
            (
                lead_id,
                property_id,
                owner_id,
                timestamp,
                timestamp,
                item.get("source") or "propstream",
                item.get("lead_lifecycle_state") or "new",
                item.get("persona_primary"),
                json_dumps(item.get("persona_scores") or {}),
                json_dumps(sorted(set(item.get("distress_signals") or []))),
                json_dumps(item.get("distress_filed_dates") or {}),
                item.get("arv_estimate"),
                item.get("arv_confidence"),
                item.get("repair_estimate_low"),
                item.get("repair_estimate_high"),
                item.get("repair_confidence"),
                item.get("mao"),
                item.get("target_assignment_fee"),
                item.get("underwriting_confidence"),
                item.get("router_decision"),
                item.get("router_reason"),
                item.get("motivation_score"),
                item.get("motivation_tier"),
                event_message_id,
                1 if (item.get("source") or "propstream") == "propstream" else 0,
                timestamp if (item.get("source") or "propstream") == "propstream" else None,
            ),
        )

        self._upsert_contact_lists(
            conn,
            owner_id=owner_id,
            item=item,
            event_message_id=event_message_id,
        )
        self._refresh_lead_search(conn, lead_id)
        return {"property_id": property_id, "owner_id": owner_id, "lead_id": lead_id}

    def _upsert_contact_lists(
        self,
        conn: sqlite3.Connection,
        *,
        owner_id: str,
        item: dict[str, Any],
        event_message_id: str,
    ) -> None:
        timestamp = now_iso()
        phone_numbers = item.get("phone_numbers") or []
        for phone in phone_numbers:
            if isinstance(phone, dict):
                value = clean_phone(phone.get("value"))
                phone_type = phone.get("type") or "unknown"
                dnc = boolish(phone.get("dnc"))
            else:
                value = clean_phone(phone)
                phone_type = "unknown"
                dnc = None
            if not value:
                continue
            conn.execute(
                """
                INSERT INTO owner_phones (
                  owner_id,
                  phone_value,
                  phone_digits,
                  phone_type,
                  dnc,
                  source_event_message_id,
                  updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(owner_id, phone_value) DO UPDATE SET
                  phone_digits = excluded.phone_digits,
                  phone_type = COALESCE(excluded.phone_type, owner_phones.phone_type),
                  dnc = COALESCE(excluded.dnc, owner_phones.dnc),
                  source_event_message_id = excluded.source_event_message_id,
                  updated_at = excluded.updated_at
                """,
                (
                    owner_id,
                    value,
                    normalize_digits(value),
                    phone_type,
                    dnc,
                    event_message_id,
                    timestamp,
                ),
            )

        for email in item.get("email_addresses") or []:
            value = str(email or "").strip()
            if not value:
                continue
            conn.execute(
                """
                INSERT INTO owner_emails (
                  owner_id,
                  email_value,
                  source_event_message_id,
                  updated_at
                ) VALUES (?, ?, ?, ?)
                ON CONFLICT(owner_id, email_value) DO UPDATE SET
                  source_event_message_id = excluded.source_event_message_id,
                  updated_at = excluded.updated_at
                """,
                (
                    owner_id,
                    value,
                    event_message_id,
                    timestamp,
                ),
            )

    def _canonical_property_id(self, item: dict[str, Any], lane: str) -> str:
        apn = normalize_token(item.get("parcel_number"))
        if apn:
            return f"{lane}:{apn}"
        address = normalize_token(item.get("address_full"))
        if address:
            return f"{lane}:{address}"
        source_ref = normalize_token(item.get("property_id"))
        if source_ref:
            return f"{lane}:{source_ref}"
        digest = hashlib.sha1(json_dumps(item).encode("utf-8")).hexdigest()[:12]
        return f"{lane}:{digest}"

    def _canonical_owner_id(self, item: dict[str, Any], property_id: str) -> str:
        owner = normalize_token(item.get("owner_name")) or "unknown-owner"
        mailing = normalize_token(item.get("mailing_address")) or "unknown-mailing"
        return f"{property_id}:{owner}:{mailing}"

    def _canonical_lead_id(self, property_id: str, owner_id: str) -> str:
        return f"{property_id}:{owner_id}"

    def _set_lead_status(
        self,
        conn: sqlite3.Connection,
        *,
        lead_id: str,
        to_status: str,
        reason: str,
        event_message_id: str,
        change_status: bool,
    ) -> None:
        current = self._get_lead_status(conn, lead_id)
        timestamp = now_iso()
        if change_status:
            conn.execute(
                """
                UPDATE leads
                SET status = ?, updated_at = ?, last_event_message_id = ?
                WHERE lead_id = ?
                """,
                (to_status, timestamp, event_message_id, lead_id),
            )
        conn.execute(
            """
            INSERT INTO lead_status_history (
              lead_id,
              from_status,
              to_status,
              reason,
              event_message_id,
              created_at
            ) VALUES (?, ?, ?, ?, ?, ?)
            """,
            (
                lead_id,
                current,
                to_status,
                reason,
                event_message_id,
                timestamp,
            ),
        )

    def _get_lead_status(self, conn: sqlite3.Connection, lead_id: str) -> str | None:
        row = conn.execute(
            "SELECT status FROM leads WHERE lead_id = ?",
            (lead_id,),
        ).fetchone()
        return row["status"] if row else None

    def _resolve_refs_from_property_ref(
        self,
        conn: sqlite3.Connection,
        *,
        property_ref: Any,
        lane: str,
    ) -> dict[str, str] | None:
        ref = str(property_ref or "").strip()
        if not ref:
            return None
        row = conn.execute(
            """
            SELECT l.lead_id, l.property_id, l.owner_id
            FROM property_aliases a
            JOIN leads l ON l.property_id = a.property_id
            WHERE a.source_property_ref = ? AND a.lane = ?
            ORDER BY l.updated_at DESC
            LIMIT 1
            """,
            (ref, lane),
        ).fetchone()
        if row:
            return dict(row)
        normalized_ref = f"{lane}:{normalize_token(ref)}"
        row = conn.execute(
            """
            SELECT lead_id, property_id, owner_id
            FROM leads
            WHERE property_id = ?
            ORDER BY updated_at DESC
            LIMIT 1
            """,
            (normalized_ref,),
        ).fetchone()
        return dict(row) if row else None

    def _resolve_refs_by_address(
        self,
        conn: sqlite3.Connection,
        *,
        item: dict[str, Any],
        lane: str,
    ) -> dict[str, str] | None:
        """Try to match an incoming item to an existing lead by street+city+state.

        This handles the case where code violation leads were created without
        zip codes but PropStream results include them, causing property_id
        mismatches.
        """
        street = normalize_token(item.get("address_street") or "")
        city = normalize_token(item.get("address_city") or "")
        state = normalize_token(item.get("address_state") or "")
        if not street or not city:
            return None
        # Partial property_id match: lane:street-city-state (without zip)
        partial_id = f"{lane}:{street}-{city}-{state}"
        row = conn.execute(
            """
            SELECT lead_id, property_id, owner_id
            FROM leads
            WHERE property_id LIKE ? || '%'
            ORDER BY updated_at DESC
            LIMIT 1
            """,
            (partial_id,),
        ).fetchone()
        if row:
            return dict(row)
        # Also try matching via the properties table directly
        row = conn.execute(
            """
            SELECT l.lead_id, l.property_id, l.owner_id
            FROM leads l
            JOIN properties p ON p.property_id = l.property_id
            WHERE LOWER(REPLACE(p.address_street, ' ', '')) = ?
              AND LOWER(REPLACE(p.address_city, ' ', '')) = ?
              AND LOWER(p.address_state) = ?
              AND p.lane = ?
            ORDER BY l.updated_at DESC
            LIMIT 1
            """,
            (
                (item.get("address_street") or "").replace(" ", "").lower(),
                (item.get("address_city") or "").replace(" ", "").lower(),
                (item.get("address_state") or "").lower(),
                lane,
            ),
        ).fetchone()
        return dict(row) if row else None

    def _item_has_contacts(self, item: dict[str, Any]) -> bool:
        phones = item.get("phone_numbers") or []
        emails = item.get("email_addresses") or []
        return bool(phones or emails)

    def _load_correlated_command_payload(
        self,
        conn: sqlite3.Connection,
        envelope: dict[str, Any],
    ) -> dict[str, Any]:
        correlation_id = envelope.get("correlation_id")
        if not correlation_id:
            return {}
        row = conn.execute(
            "SELECT raw_json FROM bridge_events WHERE message_id = ?",
            (correlation_id,),
        ).fetchone()
        if not row:
            return {}
        try:
            raw = json.loads(row["raw_json"])
        except json.JSONDecodeError:
            return {}
        return raw.get("payload") or {}

    def _refresh_lead_search(self, conn: sqlite3.Connection, lead_id: str) -> None:
        row = conn.execute(
            """
            SELECT
              l.lead_id,
              l.property_id,
              p.address_full,
              p.address_zip,
              p.parcel_number,
              o.owner_name,
              o.mailing_address,
              COALESCE(
                (SELECT GROUP_CONCAT(phone_digits, ' ')
                 FROM owner_phones op
                 WHERE op.owner_id = l.owner_id),
                ''
              ) AS phone_numbers,
              COALESCE(
                (SELECT GROUP_CONCAT(email_value, ' ')
                 FROM owner_emails oe
                 WHERE oe.owner_id = l.owner_id),
                ''
              ) AS email_addresses,
              COALESCE(l.distress_signals_json, p.distress_signals_json, '[]') AS distress_signals_json,
              COALESCE(l.last_list_name, '') AS list_name,
              TRIM(COALESCE(l.router_decision, '') || ' ' || COALESCE(l.router_reason, '')) AS router_text,
              TRIM(COALESCE(l.status, '') || ' ' || COALESCE(l.motivation_tier, '')) AS status_text
            FROM leads l
            JOIN properties p ON p.property_id = l.property_id
            JOIN owners o ON o.owner_id = l.owner_id
            WHERE l.lead_id = ?
            """,
            (lead_id,),
        ).fetchone()
        if not row:
            return
        distress = " ".join(json.loads(row["distress_signals_json"] or "[]"))
        conn.execute("DELETE FROM lead_search WHERE lead_id = ?", (lead_id,))
        conn.execute(
            """
            INSERT INTO lead_search (
              lead_id,
              property_id,
              address_full,
              address_zip,
              parcel_number,
              owner_name,
              mailing_address,
              phone_numbers,
              email_addresses,
              distress_signals,
              list_name,
              router_text,
              status_text
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                row["lead_id"],
                row["property_id"],
                row["address_full"] or "",
                row["address_zip"] or "",
                row["parcel_number"] or "",
                row["owner_name"] or "",
                row["mailing_address"] or "",
                row["phone_numbers"] or "",
                row["email_addresses"] or "",
                distress,
                row["list_name"] or "",
                row["router_text"] or "",
                row["status_text"] or "",
            ),
        )

    def _search_entities(self, term: str, *, entity: str, limit: int) -> list[dict[str, Any]]:
        term = str(term or "").strip()
        if not term:
            return []

        with self._connect() as conn:
            matches: list[dict[str, Any]] = []
            seen: set[str] = set()

            normalized_match = self._fts_query(term)
            rows = conn.execute(
                """
                SELECT lead_id
                FROM lead_search
                WHERE lead_search MATCH ?
                LIMIT ?
                """,
                (normalized_match, limit),
            ).fetchall()
            for row in rows:
                if row["lead_id"] not in seen:
                    seen.add(row["lead_id"])
                    matches.append(self._fetch_lead_projection(conn, row["lead_id"]))

            like_term = f"%{term}%"
            phone_digits = normalize_digits(term)
            rows = conn.execute(
                """
                SELECT DISTINCT l.lead_id
                FROM leads l
                JOIN properties p ON p.property_id = l.property_id
                JOIN owners o ON o.owner_id = l.owner_id
                LEFT JOIN owner_phones op ON op.owner_id = o.owner_id
                LEFT JOIN owner_emails oe ON oe.owner_id = o.owner_id
                WHERE p.address_full LIKE ?
                   OR p.parcel_number LIKE ?
                   OR o.owner_name LIKE ?
                   OR o.mailing_address LIKE ?
                   OR oe.email_value LIKE ?
                   OR (? != '' AND op.phone_digits LIKE ?)
                LIMIT ?
                """,
                (
                    like_term,
                    like_term,
                    like_term,
                    like_term,
                    like_term,
                    phone_digits,
                    f"%{phone_digits}%",
                    limit,
                ),
            ).fetchall()
            for row in rows:
                if row["lead_id"] not in seen:
                    seen.add(row["lead_id"])
                    matches.append(self._fetch_lead_projection(conn, row["lead_id"]))

        if entity == "lead":
            return matches[:limit]
        if entity == "owner":
            return [self._owner_view(match) for match in matches[:limit]]
        return [self._property_view(match) for match in matches[:limit]]

    def _render_command_response(self, command: str, data: Any) -> str:
        if not data:
            return f"No results for {command}."
        if isinstance(data, dict):
            if command == "quota":
                return (
                    f"Quota snapshot: saves {data.get('saves_used')}/{data.get('saves_cap')}, "
                    f"exports {data.get('exports_used')}/{data.get('exports_cap')}, "
                    f"skip traces {data.get('skip_traces_used')}/{data.get('skip_traces_cap')}."
                )
            if command == "event":
                return (
                    f"Event {data.get('message_id')} type={data.get('envelope_type')} "
                    f"command={data.get('command_type')} status={data.get('status')}."
                )
            return json.dumps(data, indent=2, sort_keys=True)

        if command in {"lead", "owner", "property"}:
            lines = []
            for row in data[:5]:
                lines.append(
                    f"{row.get('lead_id')} | {row.get('address_full')} | "
                    f"{row.get('owner_name')} | status={row.get('status')}"
                )
            return "\n".join(lines)

        if command == "queue":
            lines = []
            for row in data[:10]:
                lines.append(
                    f"{row.get('lead_id')} | {row.get('address_full')} | "
                    f"score={row.get('motivation_score')} | status={row.get('status')}"
                )
            return "\n".join(lines)

        if command == "outstanding":
            lines = []
            for row in data[:10]:
                if "code" in row:
                    lines.append(
                        f"{row.get('message_id')} | {row.get('code')} | {row.get('message')}"
                    )
                else:
                    lines.append(
                        f"{row.get('lead_id')} | {row.get('address_full')} | {row.get('status')}"
                    )
            return "\n".join(lines)

        return json.dumps(data, indent=2, sort_keys=True)

    def _fts_query(self, term: str) -> str:
        chunks = re.findall(r"[A-Za-z0-9@._+-]+", term)
        if not chunks:
            return '""'
        return " ".join(f'"{chunk}"*' for chunk in chunks)

    def _fetch_lead_projection(self, conn: sqlite3.Connection, lead_id: str) -> dict[str, Any]:
        row = conn.execute(
            """
            SELECT
              l.*,
              p.address_full,
              p.address_street,
              p.address_city,
              p.address_state,
              p.address_zip,
              p.parcel_number,
              p.property_type,
              p.skip_trace_count,
              o.owner_name,
              o.owner_type,
              o.mailing_address
            FROM leads l
            JOIN properties p ON p.property_id = l.property_id
            JOIN owners o ON o.owner_id = l.owner_id
            WHERE l.lead_id = ?
            """,
            (lead_id,),
        ).fetchone()
        if not row:
            return {}
        result = dict(row)
        result["phone_numbers"] = [
            dict(phone)
            for phone in conn.execute(
                """
                SELECT phone_value, phone_digits, phone_type, dnc, COALESCE(bad_number, 0) as bad_number
                FROM owner_phones
                WHERE owner_id = ? AND COALESCE(bad_number, 0) = 0
                ORDER BY id
                """,
                (row["owner_id"],),
            ).fetchall()
        ]
        result["email_addresses"] = [
            email["email_value"]
            for email in conn.execute(
                """
                SELECT email_value
                FROM owner_emails
                WHERE owner_id = ?
                ORDER BY id
                """,
                (row["owner_id"],),
            ).fetchall()
        ]
        return result

    def _owner_view(self, lead: dict[str, Any]) -> dict[str, Any]:
        return {
            "lead_id": lead["lead_id"],
            "owner_id": lead["owner_id"],
            "owner_name": lead["owner_name"],
            "owner_type": lead["owner_type"],
            "mailing_address": lead["mailing_address"],
            "phone_numbers": lead["phone_numbers"],
            "email_addresses": lead["email_addresses"],
            "status": lead["status"],
            "address_full": lead["address_full"],
        }

    def _property_view(self, lead: dict[str, Any]) -> dict[str, Any]:
        return {
            "lead_id": lead["lead_id"],
            "property_id": lead["property_id"],
            "address_full": lead["address_full"],
            "address_zip": lead["address_zip"],
            "parcel_number": lead["parcel_number"],
            "property_type": lead["property_type"],
            "owner_name": lead["owner_name"],
            "status": lead["status"],
        }

    # ── Social / Bandit Comments ──────────────────────────────────

    def _ensure_social_tables(self, conn: sqlite3.Connection) -> None:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS social_campaigns (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              platform TEXT NOT NULL,
              campaign_name TEXT NOT NULL,
              post_url TEXT NOT NULL,
              post_type TEXT NOT NULL DEFAULT 'own_ad',
              target_market TEXT NOT NULL DEFAULT '',
              active INTEGER NOT NULL DEFAULT 1,
              last_scraped_at TEXT,
              created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS social_comments (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              campaign_id INTEGER NOT NULL,
              platform TEXT NOT NULL,
              post_url TEXT NOT NULL,
              post_type TEXT NOT NULL DEFAULT 'own_ad',
              commenter_name TEXT NOT NULL,
              commenter_profile_url TEXT,
              comment_text TEXT NOT NULL,
              comment_date TEXT,
              comment_hash TEXT NOT NULL,
              extracted_name TEXT,
              extracted_phone TEXT,
              extracted_address TEXT,
              extracted_city TEXT,
              extracted_state TEXT,
              status TEXT NOT NULL DEFAULT 'new',
              lead_id TEXT,
              notes TEXT,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              UNIQUE(comment_hash),
              FOREIGN KEY (campaign_id) REFERENCES social_campaigns(id) ON DELETE CASCADE
            );
            """
        )

    def social_bandit_stats(self) -> dict[str, Any]:
        with self._connect() as conn:
            self._ensure_social_tables(conn)
            total_camps = conn.execute("SELECT COUNT(*) AS c FROM social_campaigns").fetchone()["c"]
            active_camps = conn.execute("SELECT COUNT(*) AS c FROM social_campaigns WHERE active = 1").fetchone()["c"]
            total_comments = conn.execute("SELECT COUNT(*) AS c FROM social_comments").fetchone()["c"]
            new_comments = conn.execute("SELECT COUNT(*) AS c FROM social_comments WHERE status = 'new'").fetchone()["c"]
            qualified = conn.execute("SELECT COUNT(*) AS c FROM social_comments WHERE status = 'qualified'").fetchone()["c"]
            ingested = conn.execute("SELECT COUNT(*) AS c FROM social_comments WHERE status = 'ingested'").fetchone()["c"]
            by_platform = {
                r["platform"]: r["c"]
                for r in conn.execute("SELECT platform, COUNT(*) AS c FROM social_comments GROUP BY platform").fetchall()
            }
            by_post_type = {
                r["post_type"]: r["c"]
                for r in conn.execute("SELECT post_type, COUNT(*) AS c FROM social_comments GROUP BY post_type").fetchall()
            }
            return {
                "total_campaigns": total_camps,
                "active_campaigns": active_camps,
                "total_comments": total_comments,
                "new_comments": new_comments,
                "qualified_comments": qualified,
                "ingested_leads": ingested,
                "by_platform": by_platform,
                "by_post_type": by_post_type,
            }

    def list_social_campaigns(self) -> list[dict[str, Any]]:
        with self._connect() as conn:
            self._ensure_social_tables(conn)
            rows = conn.execute(
                """
                SELECT c.*,
                  (SELECT COUNT(*) FROM social_comments sc WHERE sc.campaign_id = c.id) AS total_comments,
                  (SELECT COUNT(*) FROM social_comments sc WHERE sc.campaign_id = c.id AND sc.status = 'qualified') AS qualified_comments
                FROM social_campaigns c
                ORDER BY c.created_at DESC
                """
            ).fetchall()
            return [dict(r) for r in rows]

    def create_social_campaign(
        self,
        platform: str,
        campaign_name: str,
        post_url: str,
        post_type: str,
        target_market: str,
    ) -> dict[str, Any]:
        created_at = now_iso()
        with self._connect() as conn:
            self._ensure_social_tables(conn)
            cursor = conn.execute(
                """
                INSERT INTO social_campaigns (platform, campaign_name, post_url, post_type, target_market, created_at)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (platform, campaign_name, post_url, post_type, target_market, created_at),
            )
            return {"status": "ok", "id": cursor.lastrowid}

    def toggle_social_campaign(self, campaign_id: int, active: bool) -> dict[str, Any]:
        with self._connect() as conn:
            self._ensure_social_tables(conn)
            conn.execute(
                "UPDATE social_campaigns SET active = ? WHERE id = ?",
                (1 if active else 0, campaign_id),
            )
            return {"status": "ok"}

    def list_social_comments(
        self,
        *,
        status: str | None = None,
        campaign_id: int | None = None,
        limit: int = 200,
    ) -> list[dict[str, Any]]:
        with self._connect() as conn:
            self._ensure_social_tables(conn)
            clauses = ["1=1"]
            params: list[Any] = []
            if status:
                clauses.append("sc.status = ?")
                params.append(status)
            if campaign_id is not None:
                clauses.append("sc.campaign_id = ?")
                params.append(campaign_id)
            where = " AND ".join(clauses)
            rows = conn.execute(
                f"""
                SELECT sc.*
                FROM social_comments sc
                WHERE {where}
                ORDER BY sc.created_at DESC
                LIMIT ?
                """,
                (*params, limit),
            ).fetchall()
            return [dict(r) for r in rows]

    def classify_social_comment(
        self, comment_id: int, status: str, notes: str | None = None
    ) -> dict[str, Any]:
        with self._connect() as conn:
            self._ensure_social_tables(conn)
            conn.execute(
                "UPDATE social_comments SET status = ?, notes = COALESCE(?, notes), updated_at = ? WHERE id = ?",
                (status, notes, now_iso(), comment_id),
            )
            return {"status": "ok"}

    def extract_social_comment(
        self,
        comment_id: int,
        extracted: dict[str, str | None],
    ) -> dict[str, Any]:
        with self._connect() as conn:
            self._ensure_social_tables(conn)
            conn.execute(
                """
                UPDATE social_comments
                SET extracted_name = COALESCE(?, extracted_name),
                    extracted_phone = COALESCE(?, extracted_phone),
                    extracted_address = COALESCE(?, extracted_address),
                    extracted_city = COALESCE(?, extracted_city),
                    extracted_state = COALESCE(?, extracted_state),
                    updated_at = ?
                WHERE id = ?
                """,
                (
                    extracted.get("name"),
                    extracted.get("phone"),
                    extracted.get("address"),
                    extracted.get("city"),
                    extracted.get("state"),
                    now_iso(),
                    comment_id,
                ),
            )
            return {"status": "ok"}

    def bulk_classify_social_comments(
        self, comment_ids: list[int], status: str
    ) -> dict[str, Any]:
        with self._connect() as conn:
            self._ensure_social_tables(conn)
            placeholders = ",".join("?" for _ in comment_ids)
            conn.execute(
                f"UPDATE social_comments SET status = ?, updated_at = ? WHERE id IN ({placeholders})",
                (status, now_iso(), *comment_ids),
            )
            return {"status": "ok", "updated": len(comment_ids)}

    def ingest_social_comments(
        self, comment_ids: list[int]
    ) -> dict[str, Any]:
        """Convert qualified social comments into leads via the standard ingestion pipeline."""
        import uuid

        with self._connect() as conn:
            self._ensure_social_tables(conn)
            placeholders = ",".join("?" for _ in comment_ids)
            rows = conn.execute(
                f"SELECT * FROM social_comments WHERE id IN ({placeholders}) AND status IN ('qualified', 'new')",
                comment_ids,
            ).fetchall()
            comments = [dict(r) for r in rows]

        leads_created = 0
        for comment in comments:
            addr_street = (comment.get("extracted_address") or "").strip()
            city = (comment.get("extracted_city") or "").strip()
            state = (comment.get("extracted_state") or "").strip()
            name = (comment.get("extracted_name") or comment.get("commenter_name") or "").strip()

            if not addr_street and not name:
                continue

            full = ", ".join(p for p in [addr_street, city, state] if p)
            item = {
                "property_id": full or f"social-{comment['id']}",
                "address_full": full,
                "address_street": addr_street,
                "address_city": city,
                "address_state": state,
                "owner_name": name,
                "distress_signals": ["social_media_comment"],
                "source": "social_bandit",
            }

            phone = (comment.get("extracted_phone") or "").strip()
            if phone:
                item["phone_numbers"] = [{"value": phone, "type": "cell", "dnc": None}]

            envelope = {
                "message_id": f"social-{comment['id']}-{uuid.uuid4().hex[:8]}",
                "type": "event",
                "lane": "houses",
                "timestamp": now_iso(),
                "payload": {
                    "command_type": "EXPORT",
                    "status": "success",
                    "items": [item],
                    "source_type": "social_bandit",
                    "list_name": f"Social/Bandit - {comment.get('platform', 'unknown')}",
                    "record_count": 1,
                },
            }
            self.ingest_envelope(envelope)
            leads_created += 1

            with self._connect() as conn:
                self._ensure_social_tables(conn)
                conn.execute(
                    "UPDATE social_comments SET status = 'ingested', updated_at = ? WHERE id = ?",
                    (now_iso(), comment["id"]),
                )

        self.update_source_run("social_bandit", status="success", count=leads_created)
        return {"status": "ok", "ingested": len(comments), "leads_created": leads_created}

    def import_social_comments(
        self,
        platform: str,
        post_url: str,
        post_type: str,
        target_market: str,
        comments: list[dict[str, Any]],
    ) -> dict[str, Any]:
        """Bulk import comments from a manual scrape or browser extension export."""
        with self._connect() as conn:
            self._ensure_social_tables(conn)

            # Find or create campaign
            row = conn.execute(
                "SELECT id FROM social_campaigns WHERE post_url = ?",
                (post_url,),
            ).fetchone()
            if row:
                campaign_id = row["id"]
            else:
                cursor = conn.execute(
                    """
                    INSERT INTO social_campaigns (platform, campaign_name, post_url, post_type, target_market, created_at)
                    VALUES (?, ?, ?, ?, ?, ?)
                    """,
                    (platform, f"{platform} - {target_market}", post_url, post_type, target_market, now_iso()),
                )
                campaign_id = cursor.lastrowid

            imported = 0
            timestamp = now_iso()
            for c in comments:
                commenter = (c.get("commenter_name") or "").strip()
                text = (c.get("comment_text") or "").strip()
                if not text:
                    continue

                comment_hash = hashlib.sha256(
                    f"{post_url}:{commenter}:{text}".encode("utf-8")
                ).hexdigest()[:24]

                # Auto-extract from comment text
                extracted = self._auto_extract_from_comment(text, commenter)

                try:
                    conn.execute(
                        """
                        INSERT INTO social_comments (
                          campaign_id, platform, post_url, post_type,
                          commenter_name, commenter_profile_url,
                          comment_text, comment_date, comment_hash,
                          extracted_name, extracted_phone,
                          extracted_address, extracted_city, extracted_state,
                          status, created_at, updated_at
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        """,
                        (
                            campaign_id,
                            platform,
                            post_url,
                            post_type,
                            commenter,
                            c.get("commenter_profile_url"),
                            text,
                            c.get("comment_date") or timestamp,
                            comment_hash,
                            extracted.get("name"),
                            extracted.get("phone"),
                            extracted.get("address"),
                            extracted.get("city"),
                            extracted.get("state"),
                            "qualified" if extracted.get("phone") or extracted.get("address") else "new",
                            timestamp,
                            timestamp,
                        ),
                    )
                    imported += 1
                except sqlite3.IntegrityError:
                    pass  # duplicate comment_hash

            conn.execute(
                "UPDATE social_campaigns SET last_scraped_at = ? WHERE id = ?",
                (timestamp, campaign_id),
            )

        return {"status": "ok", "imported": imported, "campaign_id": campaign_id}

    def _auto_extract_from_comment(
        self, text: str, commenter_name: str
    ) -> dict[str, str | None]:
        """
        Best-effort extraction of contact info from a social media comment.

        Common patterns from the transcripts:
        - "@friend you should call them about your house on Elm St"
        - "My neighbor at 1234 Main St needs to sell"
        - "Call 555-123-4567"
        - "DM me I have a house in Cleveland"
        - Tagging someone: name appears in @mention or "my mom/dad/friend [name]"
        """
        result: dict[str, str | None] = {
            "name": None,
            "phone": None,
            "address": None,
            "city": None,
            "state": None,
        }

        # Extract phone numbers (various formats) -- do this FIRST so we can
        # strip the phone from text before address matching
        phone_match = re.search(
            r'(?:\+?1[-.\s]?)?\(?(\d{3})\)?[-.\s]?(\d{3})[-.\s]?(\d{4})',
            text,
        )
        if phone_match:
            result["phone"] = f"({phone_match.group(1)}) {phone_match.group(2)}-{phone_match.group(3)}"

        # Strip phone from text before address matching to prevent digits leaking
        text_no_phone = text
        if phone_match:
            text_no_phone = text[:phone_match.start()] + text[phone_match.end():]

        # Extract street addresses (number + street name pattern)
        # Require the house number to be at a word boundary (not mid-sentence digits)
        addr_match = re.search(
            r'(?:^|(?<=\s)|(?<=at\s)|(?<=on\s))(\d{1,6}\s+(?:[NSEW]\.?\s+)?(?:[A-Z][a-zA-Z]+\s+){1,3}(?:St|Street|Ave|Avenue|Blvd|Boulevard|Dr|Drive|Rd|Road|Ln|Lane|Way|Ct|Court|Pl|Place|Cir|Circle|Trl|Trail|Pkwy|Parkway)\.?)',
            text_no_phone,
            re.IGNORECASE,
        )
        if addr_match:
            result["address"] = addr_match.group(1).strip()

        # Extract @mentions as potential names
        at_mentions = re.findall(r'@([A-Za-z][A-Za-z0-9_.]{2,})', text)
        if at_mentions:
            # Use the first @mention as the extracted name (the person being referred)
            result["name"] = at_mentions[0].replace(".", " ").replace("_", " ")

        # Extract tagged names in common referral patterns
        # Use a word boundary after the name to avoid grabbing verbs
        referral_match = re.search(
            r'(?:my\s+(?:mom|dad|mother|father|brother|sister|friend|neighbor|uncle|aunt|cousin|grandma|grandpa)\s+)([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)(?:\s+(?:needs|wants|has|is|lives|at|on|in)\b|[.,!?]|$)',
            text,
        )
        if referral_match and not result["name"]:
            result["name"] = referral_match.group(1).strip()

        # Common Ohio/Texas cities
        cities_pattern = r'\b(Cleveland|Columbus|Cincinnati|Akron|Dayton|Toledo|Canton|Youngstown|Houston|Dallas|Fort Worth|San Antonio|Austin|El Paso)\b'
        city_match = re.search(cities_pattern, text, re.IGNORECASE)
        if city_match:
            result["city"] = city_match.group(1).title()
            # Infer state from city
            ohio_cities = {"cleveland", "columbus", "cincinnati", "akron", "dayton", "toledo", "canton", "youngstown"}
            texas_cities = {"houston", "dallas", "fort worth", "san antonio", "austin", "el paso"}
            city_lower = city_match.group(1).lower()
            if city_lower in ohio_cities:
                result["state"] = "OH"
            elif city_lower in texas_cities:
                result["state"] = "TX"

        return result

    # ── Water Shutoffs ────────────────────────────────────────

    def _ensure_water_shutoff_tables(self, conn: sqlite3.Connection) -> None:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS foia_requests (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              city TEXT NOT NULL,
              state TEXT NOT NULL,
              agency_name TEXT NOT NULL,
              agency_contact TEXT,
              submission_method TEXT NOT NULL DEFAULT 'email',
              submitted_at TEXT,
              expected_response_at TEXT,
              status TEXT NOT NULL DEFAULT 'draft',
              fee_amount REAL,
              notes TEXT,
              file_received INTEGER NOT NULL DEFAULT 0,
              records_imported INTEGER NOT NULL DEFAULT 0,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS water_shutoff_records (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              foia_request_id INTEGER,
              service_address TEXT NOT NULL,
              city TEXT,
              state TEXT,
              zip TEXT,
              account_holder TEXT,
              shutoff_date TEXT,
              amount_owed REAL,
              record_hash TEXT NOT NULL,
              lead_id TEXT,
              status TEXT NOT NULL DEFAULT 'new',
              created_at TEXT NOT NULL,
              UNIQUE(record_hash),
              FOREIGN KEY (foia_request_id) REFERENCES foia_requests(id) ON DELETE SET NULL
            );
            """
        )

    def water_shutoff_stats(self) -> dict[str, Any]:
        with self._connect() as conn:
            self._ensure_water_shutoff_tables(conn)
            total_requests = conn.execute("SELECT COUNT(*) AS c FROM foia_requests").fetchone()["c"]
            pending_requests = conn.execute(
                "SELECT COUNT(*) AS c FROM foia_requests WHERE status IN ('draft', 'submitted', 'processing')"
            ).fetchone()["c"]
            received_requests = conn.execute(
                "SELECT COUNT(*) AS c FROM foia_requests WHERE file_received = 1"
            ).fetchone()["c"]
            total_records = conn.execute("SELECT COUNT(*) AS c FROM water_shutoff_records").fetchone()["c"]
            new_records = conn.execute(
                "SELECT COUNT(*) AS c FROM water_shutoff_records WHERE status = 'new'"
            ).fetchone()["c"]
            ingested_records = conn.execute(
                "SELECT COUNT(*) AS c FROM water_shutoff_records WHERE status = 'ingested'"
            ).fetchone()["c"]
            by_city = {
                r["city"]: r["c"]
                for r in conn.execute(
                    "SELECT city, COUNT(*) AS c FROM water_shutoff_records WHERE city IS NOT NULL GROUP BY city"
                ).fetchall()
            }
            return {
                "total_requests": total_requests,
                "pending_requests": pending_requests,
                "received_requests": received_requests,
                "total_records": total_records,
                "new_records": new_records,
                "ingested_records": ingested_records,
                "by_city": by_city,
            }

    def list_foia_requests(self, *, limit: int = 50) -> list[dict[str, Any]]:
        with self._connect() as conn:
            self._ensure_water_shutoff_tables(conn)
            rows = conn.execute(
                """
                SELECT f.*,
                  (SELECT COUNT(*) FROM water_shutoff_records w WHERE w.foia_request_id = f.id) AS record_count,
                  (SELECT COUNT(*) FROM water_shutoff_records w WHERE w.foia_request_id = f.id AND w.status = 'ingested') AS ingested_count
                FROM foia_requests f
                ORDER BY f.created_at DESC
                LIMIT ?
                """,
                (limit,),
            ).fetchall()
            return [dict(r) for r in rows]

    def create_foia_request(
        self,
        city: str,
        state: str,
        agency_name: str,
        agency_contact: str | None = None,
        submission_method: str = "email",
        notes: str | None = None,
    ) -> dict[str, Any]:
        timestamp = now_iso()
        with self._connect() as conn:
            self._ensure_water_shutoff_tables(conn)
            cursor = conn.execute(
                """
                INSERT INTO foia_requests (
                  city, state, agency_name, agency_contact,
                  submission_method, status, notes, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, 'draft', ?, ?, ?)
                """,
                (city, state, agency_name, agency_contact, submission_method, notes, timestamp, timestamp),
            )
            return {"status": "ok", "id": cursor.lastrowid}

    def update_foia_request(
        self,
        request_id: int,
        updates: dict[str, Any],
    ) -> dict[str, Any]:
        with self._connect() as conn:
            self._ensure_water_shutoff_tables(conn)
            allowed = {
                "status", "submitted_at", "expected_response_at",
                "fee_amount", "notes", "file_received", "agency_contact",
                "submission_method",
            }
            sets = []
            params: list[Any] = []
            for k, v in updates.items():
                if k in allowed:
                    sets.append(f"{k} = ?")
                    params.append(v)
            if not sets:
                return {"status": "ok", "updated": 0}
            sets.append("updated_at = ?")
            params.append(now_iso())
            params.append(request_id)
            conn.execute(
                f"UPDATE foia_requests SET {', '.join(sets)} WHERE id = ?",
                params,
            )
            return {"status": "ok", "id": request_id}

    def import_water_shutoff_records(
        self,
        foia_request_id: int | None,
        records: list[dict[str, Any]],
        city: str | None = None,
        state: str | None = None,
    ) -> dict[str, Any]:
        """Import parsed water shutoff records (from CSV/XLSX upload)."""
        import uuid

        timestamp = now_iso()
        imported = 0
        duplicates = 0

        with self._connect() as conn:
            self._ensure_water_shutoff_tables(conn)
            for rec in records:
                addr = (rec.get("service_address") or rec.get("address") or "").strip()
                if not addr:
                    continue

                rec_city = (rec.get("city") or city or "").strip()
                rec_state = (rec.get("state") or state or "").strip()
                rec_zip = (rec.get("zip") or rec.get("zipcode") or "").strip()
                holder = (rec.get("account_holder") or rec.get("owner_name") or rec.get("name") or "").strip()
                shutoff_date = (rec.get("shutoff_date") or rec.get("disconnect_date") or "").strip()
                amount = rec.get("amount_owed") or rec.get("balance") or rec.get("amount")

                if amount is not None:
                    try:
                        amount = float(str(amount).replace("$", "").replace(",", "").strip())
                    except ValueError:
                        amount = None

                record_hash = hashlib.sha256(
                    f"{addr}:{rec_city}:{rec_state}:{holder}".lower().encode("utf-8")
                ).hexdigest()[:24]

                try:
                    conn.execute(
                        """
                        INSERT INTO water_shutoff_records (
                          foia_request_id, service_address, city, state, zip,
                          account_holder, shutoff_date, amount_owed,
                          record_hash, status, created_at
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', ?)
                        """,
                        (
                            foia_request_id, addr, rec_city, rec_state, rec_zip,
                            holder, shutoff_date, amount, record_hash, timestamp,
                        ),
                    )
                    imported += 1
                except sqlite3.IntegrityError:
                    duplicates += 1

            # Update FOIA request if linked
            if foia_request_id is not None:
                conn.execute(
                    """
                    UPDATE foia_requests
                    SET file_received = 1,
                        records_imported = records_imported + ?,
                        updated_at = ?
                    WHERE id = ?
                    """,
                    (imported, timestamp, foia_request_id),
                )

        return {"status": "ok", "imported": imported, "duplicates": duplicates}

    def list_water_shutoff_records(
        self,
        *,
        foia_request_id: int | None = None,
        status: str | None = None,
        limit: int = 200,
    ) -> list[dict[str, Any]]:
        with self._connect() as conn:
            self._ensure_water_shutoff_tables(conn)
            clauses = ["1=1"]
            params: list[Any] = []
            if foia_request_id is not None:
                clauses.append("w.foia_request_id = ?")
                params.append(foia_request_id)
            if status:
                clauses.append("w.status = ?")
                params.append(status)
            where = " AND ".join(clauses)
            rows = conn.execute(
                f"""
                SELECT w.*
                FROM water_shutoff_records w
                WHERE {where}
                ORDER BY w.created_at DESC
                LIMIT ?
                """,
                (*params, limit),
            ).fetchall()
            return [dict(r) for r in rows]

    def ingest_water_shutoff_records(
        self, record_ids: list[int]
    ) -> dict[str, Any]:
        """Convert water shutoff records into leads via the standard ingestion pipeline."""
        import uuid

        with self._connect() as conn:
            self._ensure_water_shutoff_tables(conn)
            placeholders = ",".join("?" for _ in record_ids)
            rows = conn.execute(
                f"SELECT * FROM water_shutoff_records WHERE id IN ({placeholders}) AND status = 'new'",
                record_ids,
            ).fetchall()
            records = [dict(r) for r in rows]

        leads_created = 0
        for rec in records:
            addr = (rec.get("service_address") or "").strip()
            city = (rec.get("city") or "").strip()
            state = (rec.get("state") or "").strip()
            zipcode = (rec.get("zip") or "").strip()
            holder = (rec.get("account_holder") or "").strip()

            if not addr:
                continue

            full = ", ".join(p for p in [addr, city, state, zipcode] if p)
            item = {
                "property_id": full,
                "address_full": full,
                "address_street": addr,
                "address_city": city,
                "address_state": state,
                "address_zip": zipcode,
                "owner_name": holder,
                "distress_signals": ["water_shutoff"],
                "source": "water_shutoffs",
            }

            envelope = {
                "message_id": f"water-{rec['id']}-{uuid.uuid4().hex[:8]}",
                "type": "event",
                "lane": "houses",
                "timestamp": now_iso(),
                "payload": {
                    "command_type": "EXPORT",
                    "status": "success",
                    "items": [item],
                    "source_type": "water_shutoffs",
                    "list_name": f"Water Shutoffs — {city}, {state}" if city else "Water Shutoffs",
                    "record_count": 1,
                },
            }
            self.ingest_envelope(envelope)
            leads_created += 1

            with self._connect() as conn:
                self._ensure_water_shutoff_tables(conn)
                conn.execute(
                    "UPDATE water_shutoff_records SET status = 'ingested', lead_id = ? WHERE id = ?",
                    (full, rec["id"]),
                )

        self.update_source_run("water_shutoffs", status="success", count=leads_created)
        return {"status": "ok", "ingested": len(records), "leads_created": leads_created}

    def generate_foia_letter(self, request_id: int) -> dict[str, Any]:
        """Generate a pre-filled FOIA/public records request letter."""
        with self._connect() as conn:
            self._ensure_water_shutoff_tables(conn)
            row = conn.execute("SELECT * FROM foia_requests WHERE id = ?", (request_id,)).fetchone()
            if not row:
                return {"status": "error", "message": "Request not found"}
            req = dict(row)

        state = req["state"]
        city = req["city"]
        agency = req["agency_name"]

        if state == "OH":
            legal_basis = "Ohio Public Records Act (Ohio Rev. Code Section 149.43)"
            timeline = "Ohio law requires a prompt response. No specific timeline is defined, but courts have generally interpreted 'reasonable' as within a few business days."
        elif state == "TX":
            legal_basis = "Texas Public Information Act (Texas Government Code Chapter 552)"
            timeline = "Texas law requires a response within 10 business days of receipt."
        else:
            legal_basis = "Applicable state public records law"
            timeline = "Please respond within a reasonable timeframe as required by law."

        letter = f"""PUBLIC RECORDS REQUEST

Date: [TODAY'S DATE]

To: {agency}
    {city}, {state}

Re: Public Records Request — Water Service Disconnection Records

Dear Records Custodian,

Pursuant to the {legal_basis}, I am requesting the following public records:

A list or spreadsheet of all residential water service disconnections / shutoffs within the jurisdiction of {city}, {state} for the past 12 months.

For each disconnected account, I am requesting the following fields (to the extent they are maintained):

  1. Service address (street, city, state, zip)
  2. Account holder name
  3. Date of disconnection / shutoff
  4. Outstanding balance at time of disconnection

I am requesting this information in electronic format, preferably as a CSV or Excel spreadsheet. If electronic format is not available, a printed list is acceptable.

I am willing to pay reasonable copying and processing fees. If the estimated cost exceeds $50.00, please contact me first with an estimate before proceeding.

{timeline}

Please send the responsive records to:

[YOUR NAME]
[YOUR EMAIL]
[YOUR PHONE]

Thank you for your prompt attention to this request.

Sincerely,
[YOUR NAME]"""

        return {"status": "ok", "letter": letter, "legal_basis": legal_basis, "request_id": request_id}

    # ── FSBOs ──────────────────────────────────────────────────

    def _ensure_fsbo_tables(self, conn: sqlite3.Connection) -> None:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS fsbo_listings (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              zillow_url TEXT,
              address TEXT NOT NULL,
              city TEXT,
              state TEXT,
              zip TEXT,
              asking_price INTEGER,
              original_price INTEGER,
              zestimate INTEGER,
              days_on_market INTEGER,
              price_drops INTEGER NOT NULL DEFAULT 0,
              price_drop_pct REAL,
              bedrooms REAL,
              bathrooms REAL,
              sqft INTEGER,
              lot_sqft INTEGER,
              year_built INTEGER,
              photo_count INTEGER,
              description TEXT,
              listing_hash TEXT NOT NULL,
              distress_score INTEGER NOT NULL DEFAULT 0,
              distress_flags_json TEXT,
              status TEXT NOT NULL DEFAULT 'new',
              lead_id TEXT,
              notes TEXT,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              UNIQUE(listing_hash)
            );

            CREATE TABLE IF NOT EXISTS fsbo_markets (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              metro TEXT NOT NULL,
              state TEXT NOT NULL,
              median_price INTEGER,
              zillow_search_url TEXT,
              last_scanned_at TEXT,
              listing_count INTEGER NOT NULL DEFAULT 0,
              active INTEGER NOT NULL DEFAULT 1,
              created_at TEXT NOT NULL,
              UNIQUE(metro, state)
            );
            """
        )

    # ---- Distress scoring constants ----

    FSBO_DISTRESS_KEYWORDS = [
        "must sell", "motivated", "as-is", "as is", "estate sale",
        "estate", "relocating", "relocation", "price reduced",
        "price drop", "bring all offers", "handyman", "handyman special",
        "fixer upper", "fixer-upper", "needs work", "needs updating",
        "needs tlc", "tlc", "investor", "investor special",
        "below market", "below appraisal", "cash only",
        "quick close", "quick sale", "divorce", "inherited",
        "fire damage", "water damage", "foreclosure", "pre-foreclosure",
        "bank owned", "reo", "short sale", "vacant", "abandoned",
        "tax lien", "tax deed", "probate", "death", "deceased",
    ]

    def _score_fsbo_distress(
        self,
        listing: dict[str, Any],
        median_price: int | None = None,
    ) -> tuple[int, list[str]]:
        """Score a FSBO listing 0-100 for distress indicators. Returns (score, flags)."""
        score = 0
        flags: list[str] = []

        # DOM >= 90 days (strong signal -- they can't sell)
        dom = listing.get("days_on_market")
        if dom is not None:
            if dom >= 180:
                score += 30
                flags.append(f"dom_{dom}d")
            elif dom >= 120:
                score += 25
                flags.append(f"dom_{dom}d")
            elif dom >= 90:
                score += 20
                flags.append(f"dom_{dom}d")
            elif dom >= 60:
                score += 10
                flags.append(f"dom_{dom}d")

        # Price drops (2+ is a strong signal)
        drops = listing.get("price_drops", 0)
        if drops >= 3:
            score += 20
            flags.append(f"price_drops_{drops}")
        elif drops >= 2:
            score += 15
            flags.append(f"price_drops_{drops}")
        elif drops >= 1:
            score += 8
            flags.append(f"price_drop_{drops}")

        # Price drop percentage from original
        asking = listing.get("asking_price")
        original = listing.get("original_price")
        if asking and original and original > 0 and asking < original:
            drop_pct = ((original - asking) / original) * 100
            if drop_pct >= 20:
                score += 15
                flags.append(f"dropped_{drop_pct:.0f}pct")
            elif drop_pct >= 10:
                score += 10
                flags.append(f"dropped_{drop_pct:.0f}pct")

        # Below median price for area
        if asking and median_price and median_price > 0:
            ratio = asking / median_price
            if ratio <= 0.5:
                score += 15
                flags.append("below_50pct_median")
            elif ratio <= 0.7:
                score += 10
                flags.append("below_70pct_median")
            elif ratio <= 0.85:
                score += 5
                flags.append("below_85pct_median")

        # Below Zestimate (asking < Zestimate means priced to sell)
        zestimate = listing.get("zestimate")
        if asking and zestimate and zestimate > 0 and asking < zestimate:
            discount = ((zestimate - asking) / zestimate) * 100
            if discount >= 20:
                score += 15
                flags.append(f"below_zestimate_{discount:.0f}pct")
            elif discount >= 10:
                score += 10
                flags.append(f"below_zestimate_{discount:.0f}pct")
            elif discount >= 5:
                score += 5
                flags.append(f"below_zestimate_{discount:.0f}pct")

        # Low photo count (indicates vacant or low-effort listing)
        photos = listing.get("photo_count")
        if photos is not None:
            if photos <= 2:
                score += 8
                flags.append("low_photos")
            elif photos <= 5:
                score += 3
                flags.append("few_photos")

        # Description keyword scanning
        desc = str(listing.get("description") or "").lower()
        keyword_hits = 0
        for kw in self.FSBO_DISTRESS_KEYWORDS:
            if kw in desc:
                keyword_hits += 1
                if keyword_hits <= 3:
                    flags.append(f"kw:{kw}")
        if keyword_hits >= 3:
            score += 15
        elif keyword_hits >= 2:
            score += 10
        elif keyword_hits >= 1:
            score += 5

        return min(score, 100), flags

    def fsbo_stats(self) -> dict[str, Any]:
        with self._connect() as conn:
            self._ensure_fsbo_tables(conn)
            total = conn.execute("SELECT COUNT(*) AS c FROM fsbo_listings").fetchone()["c"]
            new = conn.execute("SELECT COUNT(*) AS c FROM fsbo_listings WHERE status = 'new'").fetchone()["c"]
            qualified = conn.execute(
                "SELECT COUNT(*) AS c FROM fsbo_listings WHERE status = 'qualified'"
            ).fetchone()["c"]
            ingested = conn.execute(
                "SELECT COUNT(*) AS c FROM fsbo_listings WHERE status = 'ingested'"
            ).fetchone()["c"]
            hot = conn.execute(
                "SELECT COUNT(*) AS c FROM fsbo_listings WHERE distress_score >= 40"
            ).fetchone()["c"]
            avg_score = conn.execute(
                "SELECT COALESCE(AVG(distress_score), 0) AS a FROM fsbo_listings WHERE distress_score > 0"
            ).fetchone()["a"]
            total_markets = conn.execute("SELECT COUNT(*) AS c FROM fsbo_markets").fetchone()["c"]
            active_markets = conn.execute(
                "SELECT COUNT(*) AS c FROM fsbo_markets WHERE active = 1"
            ).fetchone()["c"]
            by_state = {
                r["state"]: r["c"]
                for r in conn.execute(
                    "SELECT state, COUNT(*) AS c FROM fsbo_listings WHERE state IS NOT NULL GROUP BY state"
                ).fetchall()
            }
            return {
                "total_listings": total,
                "new_listings": new,
                "qualified_listings": qualified,
                "ingested_leads": ingested,
                "hot_listings": hot,
                "avg_distress_score": round(avg_score, 1),
                "total_markets": total_markets,
                "active_markets": active_markets,
                "by_state": by_state,
            }

    def list_fsbo_markets(self) -> list[dict[str, Any]]:
        with self._connect() as conn:
            self._ensure_fsbo_tables(conn)
            rows = conn.execute(
                """
                SELECT m.*,
                  (SELECT COUNT(*) FROM fsbo_listings l WHERE l.city = m.metro AND l.state = m.state) AS current_listings,
                  (SELECT COUNT(*) FROM fsbo_listings l WHERE l.city = m.metro AND l.state = m.state AND l.distress_score >= 40) AS hot_listings
                FROM fsbo_markets m
                ORDER BY m.active DESC, m.metro ASC
                """
            ).fetchall()
            return [dict(r) for r in rows]

    def upsert_fsbo_market(
        self,
        metro: str,
        state: str,
        median_price: int | None = None,
        zillow_search_url: str | None = None,
    ) -> dict[str, Any]:
        timestamp = now_iso()
        with self._connect() as conn:
            self._ensure_fsbo_tables(conn)
            existing = conn.execute(
                "SELECT id FROM fsbo_markets WHERE metro = ? AND state = ?",
                (metro, state),
            ).fetchone()
            if existing:
                sets = ["active = 1"]
                params: list[Any] = []
                if median_price is not None:
                    sets.append("median_price = ?")
                    params.append(median_price)
                if zillow_search_url is not None:
                    sets.append("zillow_search_url = ?")
                    params.append(zillow_search_url)
                params.append(existing["id"])
                conn.execute(f"UPDATE fsbo_markets SET {', '.join(sets)} WHERE id = ?", params)
                return {"status": "ok", "id": existing["id"], "action": "updated"}
            else:
                cursor = conn.execute(
                    """
                    INSERT INTO fsbo_markets (metro, state, median_price, zillow_search_url, created_at)
                    VALUES (?, ?, ?, ?, ?)
                    """,
                    (metro, state, median_price, zillow_search_url, timestamp),
                )
                return {"status": "ok", "id": cursor.lastrowid, "action": "created"}

    def toggle_fsbo_market(self, market_id: int, active: bool) -> dict[str, Any]:
        with self._connect() as conn:
            self._ensure_fsbo_tables(conn)
            conn.execute(
                "UPDATE fsbo_markets SET active = ? WHERE id = ?",
                (1 if active else 0, market_id),
            )
            return {"status": "ok"}

    def import_fsbo_listings(
        self,
        listings: list[dict[str, Any]],
        market_metro: str | None = None,
        market_state: str | None = None,
    ) -> dict[str, Any]:
        """Import FSBO listings from manual data entry or paste."""
        timestamp = now_iso()
        imported = 0
        duplicates = 0
        scored = 0

        # Look up median price for scoring
        median_price: int | None = None
        if market_metro and market_state:
            with self._connect() as conn:
                self._ensure_fsbo_tables(conn)
                row = conn.execute(
                    "SELECT median_price FROM fsbo_markets WHERE metro = ? AND state = ?",
                    (market_metro, market_state),
                ).fetchone()
                if row and row["median_price"]:
                    median_price = row["median_price"]

        with self._connect() as conn:
            self._ensure_fsbo_tables(conn)
            for lst in listings:
                addr = (lst.get("address") or "").strip()
                if not addr:
                    continue

                city = (lst.get("city") or market_metro or "").strip()
                state = (lst.get("state") or market_state or "").strip()
                zipcode = (lst.get("zip") or lst.get("zipcode") or "").strip()
                zillow_url = (lst.get("zillow_url") or lst.get("url") or "").strip()

                # Parse numeric fields
                def parse_int(v: Any) -> int | None:
                    if v is None:
                        return None
                    try:
                        return int(str(v).replace("$", "").replace(",", "").replace("+", "").strip())
                    except (ValueError, TypeError):
                        return None

                def parse_float(v: Any) -> float | None:
                    if v is None:
                        return None
                    try:
                        return float(str(v).replace("$", "").replace(",", "").replace("%", "").strip())
                    except (ValueError, TypeError):
                        return None

                asking_price = parse_int(lst.get("asking_price") or lst.get("price"))
                original_price = parse_int(lst.get("original_price"))
                zestimate = parse_int(lst.get("zestimate"))
                dom = parse_int(lst.get("days_on_market") or lst.get("dom"))
                price_drops = parse_int(lst.get("price_drops") or lst.get("price_changes")) or 0
                bedrooms = parse_float(lst.get("bedrooms") or lst.get("beds"))
                bathrooms = parse_float(lst.get("bathrooms") or lst.get("baths"))
                sqft = parse_int(lst.get("sqft") or lst.get("square_feet"))
                lot_sqft = parse_int(lst.get("lot_sqft") or lst.get("lot_size"))
                year_built = parse_int(lst.get("year_built"))
                photo_count = parse_int(lst.get("photo_count") or lst.get("photos"))
                description = (lst.get("description") or "").strip()

                # Calculate price drop percentage
                price_drop_pct: float | None = None
                if asking_price and original_price and original_price > asking_price:
                    price_drop_pct = ((original_price - asking_price) / original_price) * 100

                # Score for distress
                score_input = {
                    "days_on_market": dom,
                    "price_drops": price_drops,
                    "asking_price": asking_price,
                    "original_price": original_price,
                    "zestimate": zestimate,
                    "photo_count": photo_count,
                    "description": description,
                }
                distress_score, distress_flags = self._score_fsbo_distress(
                    score_input, median_price=median_price,
                )
                if distress_score > 0:
                    scored += 1

                listing_hash = hashlib.sha256(
                    f"{addr}:{city}:{state}".lower().encode("utf-8")
                ).hexdigest()[:24]

                # Auto-qualify high-distress listings
                auto_status = "new"
                if distress_score >= 40:
                    auto_status = "qualified"

                try:
                    conn.execute(
                        """
                        INSERT INTO fsbo_listings (
                          zillow_url, address, city, state, zip,
                          asking_price, original_price, zestimate,
                          days_on_market, price_drops, price_drop_pct,
                          bedrooms, bathrooms, sqft, lot_sqft, year_built,
                          photo_count, description, listing_hash,
                          distress_score, distress_flags_json,
                          status, created_at, updated_at
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        """,
                        (
                            zillow_url, addr, city, state, zipcode,
                            asking_price, original_price, zestimate,
                            dom, price_drops, price_drop_pct,
                            bedrooms, bathrooms, sqft, lot_sqft, year_built,
                            photo_count, description, listing_hash,
                            distress_score, json_dumps(distress_flags),
                            auto_status, timestamp, timestamp,
                        ),
                    )
                    imported += 1
                except sqlite3.IntegrityError:
                    duplicates += 1

            # Update market scan timestamp
            if market_metro and market_state:
                conn.execute(
                    """
                    UPDATE fsbo_markets
                    SET last_scanned_at = ?, listing_count = listing_count + ?
                    WHERE metro = ? AND state = ?
                    """,
                    (timestamp, imported, market_metro, market_state),
                )

        return {
            "status": "ok",
            "imported": imported,
            "duplicates": duplicates,
            "scored": scored,
        }

    def list_fsbo_listings(
        self,
        *,
        status: str | None = None,
        min_score: int | None = None,
        city: str | None = None,
        state: str | None = None,
        sort_by: str = "distress_score",
        limit: int = 200,
    ) -> list[dict[str, Any]]:
        with self._connect() as conn:
            self._ensure_fsbo_tables(conn)
            clauses = ["1=1"]
            params: list[Any] = []
            if status:
                clauses.append("f.status = ?")
                params.append(status)
            if min_score is not None:
                clauses.append("f.distress_score >= ?")
                params.append(min_score)
            if city:
                clauses.append("f.city = ?")
                params.append(city)
            if state:
                clauses.append("f.state = ?")
                params.append(state)
            where = " AND ".join(clauses)

            order = "f.distress_score DESC"
            if sort_by == "dom":
                order = "f.days_on_market DESC NULLS LAST"
            elif sort_by == "price":
                order = "f.asking_price ASC NULLS LAST"
            elif sort_by == "newest":
                order = "f.created_at DESC"
            elif sort_by == "drops":
                order = "f.price_drops DESC"

            rows = conn.execute(
                f"""
                SELECT f.*
                FROM fsbo_listings f
                WHERE {where}
                ORDER BY {order}
                LIMIT ?
                """,
                (*params, limit),
            ).fetchall()
            return [dict(r) for r in rows]

    def classify_fsbo_listing(
        self, listing_id: int, status: str, notes: str | None = None
    ) -> dict[str, Any]:
        with self._connect() as conn:
            self._ensure_fsbo_tables(conn)
            conn.execute(
                "UPDATE fsbo_listings SET status = ?, notes = COALESCE(?, notes), updated_at = ? WHERE id = ?",
                (status, notes, now_iso(), listing_id),
            )
            return {"status": "ok"}

    def bulk_classify_fsbo_listings(
        self, listing_ids: list[int], status: str
    ) -> dict[str, Any]:
        with self._connect() as conn:
            self._ensure_fsbo_tables(conn)
            placeholders = ",".join("?" for _ in listing_ids)
            conn.execute(
                f"UPDATE fsbo_listings SET status = ?, updated_at = ? WHERE id IN ({placeholders})",
                (status, now_iso(), *listing_ids),
            )
            return {"status": "ok", "updated": len(listing_ids)}

    def ingest_fsbo_listings(
        self, listing_ids: list[int]
    ) -> dict[str, Any]:
        """Convert qualified FSBO listings into leads via the standard ingestion pipeline."""
        import uuid

        with self._connect() as conn:
            self._ensure_fsbo_tables(conn)
            placeholders = ",".join("?" for _ in listing_ids)
            rows = conn.execute(
                f"SELECT * FROM fsbo_listings WHERE id IN ({placeholders}) AND status IN ('qualified', 'new')",
                listing_ids,
            ).fetchall()
            listings = [dict(r) for r in rows]

        leads_created = 0
        for lst in listings:
            addr = (lst.get("address") or "").strip()
            city = (lst.get("city") or "").strip()
            state = (lst.get("state") or "").strip()
            zipcode = (lst.get("zip") or "").strip()

            if not addr:
                continue

            full = ", ".join(p for p in [addr, city, state, zipcode] if p)

            distress_signals = ["fsbo"]
            flags_raw = lst.get("distress_flags_json")
            if flags_raw:
                try:
                    flags = json.loads(flags_raw)
                    for f in flags:
                        if f.startswith("dom_"):
                            distress_signals.append("stale_listing")
                        elif f.startswith("price_drops_") or f.startswith("price_drop_"):
                            distress_signals.append("price_drops")
                        elif f.startswith("below_") and "median" in f:
                            distress_signals.append("below_median")
                        elif f.startswith("below_zestimate"):
                            distress_signals.append("below_zestimate")
                        elif f.startswith("kw:"):
                            distress_signals.append(f"kw_{f[3:].replace(' ', '_')}")
                except (json.JSONDecodeError, TypeError):
                    pass
            distress_signals = list(dict.fromkeys(distress_signals))  # dedupe preserving order

            item: dict[str, Any] = {
                "property_id": full,
                "address_full": full,
                "address_street": addr,
                "address_city": city,
                "address_state": state,
                "address_zip": zipcode,
                "owner_name": "",
                "distress_signals": distress_signals,
                "source": "fsbo",
            }

            # Include property details if available
            if lst.get("sqft"):
                item["square_feet"] = lst["sqft"]
            if lst.get("bedrooms"):
                item["bedrooms"] = lst["bedrooms"]
            if lst.get("bathrooms"):
                item["bathrooms"] = lst["bathrooms"]
            if lst.get("year_built"):
                item["year_built"] = lst["year_built"]
            if lst.get("zestimate"):
                item["propstream_arv_estimate"] = lst["zestimate"]

            envelope = {
                "message_id": f"fsbo-{lst['id']}-{uuid.uuid4().hex[:8]}",
                "type": "event",
                "lane": "houses",
                "timestamp": now_iso(),
                "payload": {
                    "command_type": "EXPORT",
                    "status": "success",
                    "items": [item],
                    "source_type": "fsbo",
                    "list_name": f"FSBOs — {city}, {state}" if city else "FSBOs",
                    "record_count": 1,
                },
            }
            self.ingest_envelope(envelope)
            leads_created += 1

            with self._connect() as conn:
                self._ensure_fsbo_tables(conn)
                conn.execute(
                    "UPDATE fsbo_listings SET status = 'ingested', lead_id = ?, updated_at = ? WHERE id = ?",
                    (full, now_iso(), lst["id"]),
                )

        self.update_source_run("fsbo", status="success", count=leads_created)
        return {"status": "ok", "ingested": len(listings), "leads_created": leads_created}

    def auto_ingest_fsbo(self) -> dict[str, Any]:
        """Auto-ingest all qualified + high-distress new FSBO listings."""
        with self._connect() as conn:
            self._ensure_fsbo_tables(conn)
            rows = conn.execute(
                "SELECT id FROM fsbo_listings WHERE (status = 'qualified' OR (status = 'new' AND distress_score >= 40))"
            ).fetchall()
            listing_ids = [r["id"] for r in rows]

        if not listing_ids:
            return {"status": "ok", "ingested": 0, "leads_created": 0}

        return self.ingest_fsbo_listings(listing_ids)

    # ── Court Records (CaseNet) ──────────────────────────────────────

    def _ensure_court_record_tables(self, conn: sqlite3.Connection) -> None:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS court_record_counties (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              county TEXT NOT NULL,
              state TEXT NOT NULL DEFAULT 'MO',
              court_id TEXT NOT NULL,
              appraiser_url TEXT,
              appraiser_type TEXT,
              active INTEGER NOT NULL DEFAULT 1,
              last_scraped_at TEXT,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              UNIQUE(county, state)
            );

            CREATE TABLE IF NOT EXISTS court_record_cases (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              county_id INTEGER,
              case_number TEXT NOT NULL,
              court_id TEXT NOT NULL,
              case_type TEXT NOT NULL DEFAULT 'Probate',
              file_date TEXT,
              case_title TEXT,
              deceased_name TEXT,
              pr_name TEXT,
              pr_address TEXT,
              pr_role TEXT,
              property_address TEXT,
              property_city TEXT,
              property_state TEXT,
              property_zip TEXT,
              apn TEXT,
              assessed_value REAL,
              market_value REAL,
              match_confidence TEXT,
              case_url TEXT,
              case_hash TEXT NOT NULL,
              lead_id TEXT,
              status TEXT NOT NULL DEFAULT 'new',
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              UNIQUE(case_hash),
              FOREIGN KEY (county_id) REFERENCES court_record_counties(id) ON DELETE SET NULL
            );
            """
        )

    def court_record_stats(self) -> dict[str, Any]:
        with self._connect() as conn:
            self._ensure_court_record_tables(conn)
            total = conn.execute("SELECT COUNT(*) AS c FROM court_record_cases").fetchone()["c"]
            new = conn.execute("SELECT COUNT(*) AS c FROM court_record_cases WHERE status = 'new'").fetchone()["c"]
            qualified = conn.execute(
                "SELECT COUNT(*) AS c FROM court_record_cases WHERE status = 'qualified'"
            ).fetchone()["c"]
            ingested = conn.execute(
                "SELECT COUNT(*) AS c FROM court_record_cases WHERE status = 'ingested'"
            ).fetchone()["c"]
            with_property = conn.execute(
                "SELECT COUNT(*) AS c FROM court_record_cases WHERE property_address IS NOT NULL AND property_address != ''"
            ).fetchone()["c"]
            total_counties = conn.execute("SELECT COUNT(*) AS c FROM court_record_counties").fetchone()["c"]
            active_counties = conn.execute(
                "SELECT COUNT(*) AS c FROM court_record_counties WHERE active = 1"
            ).fetchone()["c"]
            by_county = {
                r["court_id"]: r["c"]
                for r in conn.execute(
                    "SELECT court_id, COUNT(*) AS c FROM court_record_cases GROUP BY court_id"
                ).fetchall()
            }
            return {
                "total_cases": total,
                "new_cases": new,
                "qualified_cases": qualified,
                "ingested_cases": ingested,
                "with_property": with_property,
                "total_counties": total_counties,
                "active_counties": active_counties,
                "by_county": by_county,
            }

    def list_court_record_counties(self) -> list[dict[str, Any]]:
        with self._connect() as conn:
            self._ensure_court_record_tables(conn)
            rows = conn.execute(
                """
                SELECT c.*,
                  (SELECT COUNT(*) FROM court_record_cases cr WHERE cr.county_id = c.id) AS case_count,
                  (SELECT COUNT(*) FROM court_record_cases cr WHERE cr.county_id = c.id AND cr.status = 'ingested') AS ingested_count
                FROM court_record_counties c
                ORDER BY c.county ASC
                """,
            ).fetchall()
            return [dict(r) for r in rows]

    def upsert_court_record_county(
        self, county: str, state: str, court_id: str,
        appraiser_url: str | None = None, appraiser_type: str | None = None,
    ) -> dict[str, Any]:
        timestamp = now_iso()
        with self._connect() as conn:
            self._ensure_court_record_tables(conn)
            existing = conn.execute(
                "SELECT id FROM court_record_counties WHERE county = ? AND state = ?",
                (county, state),
            ).fetchone()
            if existing:
                sets = ["updated_at = ?"]
                params: list[Any] = [timestamp]
                if court_id:
                    sets.append("court_id = ?")
                    params.append(court_id)
                if appraiser_url is not None:
                    sets.append("appraiser_url = ?")
                    params.append(appraiser_url)
                if appraiser_type is not None:
                    sets.append("appraiser_type = ?")
                    params.append(appraiser_type)
                params.append(existing["id"])
                conn.execute(f"UPDATE court_record_counties SET {', '.join(sets)} WHERE id = ?", params)
                return {"status": "ok", "id": existing["id"], "action": "updated"}
            else:
                cur = conn.execute(
                    """
                    INSERT INTO court_record_counties (county, state, court_id, appraiser_url, appraiser_type, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                    """,
                    (county, state, court_id, appraiser_url, appraiser_type, timestamp, timestamp),
                )
                return {"status": "ok", "id": cur.lastrowid, "action": "created"}

    def toggle_court_record_county(self, county_id: int, active: bool) -> dict[str, Any]:
        with self._connect() as conn:
            self._ensure_court_record_tables(conn)
            conn.execute(
                "UPDATE court_record_counties SET active = ?, updated_at = ? WHERE id = ?",
                (1 if active else 0, now_iso(), county_id),
            )
            return {"status": "ok"}

    def import_court_record_cases(
        self, cases: list[dict[str, Any]], county_id: int | None = None,
    ) -> dict[str, Any]:
        import hashlib

        timestamp = now_iso()
        imported = 0
        duplicates = 0

        with self._connect() as conn:
            self._ensure_court_record_tables(conn)

            for case in cases:
                case_number = (case.get("case_number") or "").strip()
                court_id = (case.get("court_id") or "").strip()
                if not case_number:
                    continue

                case_hash = hashlib.sha256(
                    f"{court_id}:{case_number}".encode()
                ).hexdigest()[:16]

                existing = conn.execute(
                    "SELECT id FROM court_record_cases WHERE case_hash = ?",
                    (case_hash,),
                ).fetchone()
                if existing:
                    duplicates += 1
                    continue

                conn.execute(
                    """
                    INSERT INTO court_record_cases (
                      county_id, case_number, court_id, case_type, file_date,
                      case_title, deceased_name, pr_name, pr_address, pr_role,
                      property_address, property_city, property_state, property_zip,
                      apn, assessed_value, market_value, match_confidence,
                      case_url, case_hash, status, created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', ?, ?)
                    """,
                    (
                        county_id,
                        case_number,
                        court_id,
                        case.get("case_type", "Probate"),
                        case.get("file_date"),
                        case.get("case_title"),
                        case.get("deceased_name"),
                        case.get("pr_name"),
                        case.get("pr_address"),
                        case.get("pr_role"),
                        case.get("property_address"),
                        case.get("property_city"),
                        case.get("property_state"),
                        case.get("property_zip"),
                        case.get("apn"),
                        case.get("assessed_value"),
                        case.get("market_value"),
                        case.get("match_confidence"),
                        case.get("case_url"),
                        case_hash,
                        timestamp,
                        timestamp,
                    ),
                )
                imported += 1

            if county_id:
                conn.execute(
                    "UPDATE court_record_counties SET last_scraped_at = ?, updated_at = ? WHERE id = ?",
                    (timestamp, timestamp, county_id),
                )

        return {"status": "ok", "imported": imported, "duplicates": duplicates}

    def list_court_record_cases(
        self,
        status: str | None = None,
        county_id: int | None = None,
        limit: int = 200,
    ) -> list[dict[str, Any]]:
        with self._connect() as conn:
            self._ensure_court_record_tables(conn)
            clauses = []
            params: list[Any] = []
            if status:
                clauses.append("cr.status = ?")
                params.append(status)
            if county_id:
                clauses.append("cr.county_id = ?")
                params.append(county_id)
            where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
            params.append(limit)
            rows = conn.execute(
                f"""
                SELECT cr.*,
                  cc.county AS county_name
                FROM court_record_cases cr
                LEFT JOIN court_record_counties cc ON cc.id = cr.county_id
                {where}
                ORDER BY cr.created_at DESC
                LIMIT ?
                """,
                params,
            ).fetchall()
            return [dict(r) for r in rows]

    def classify_court_record_case(
        self, case_id: int, status: str, notes: str | None = None,
    ) -> dict[str, Any]:
        with self._connect() as conn:
            self._ensure_court_record_tables(conn)
            conn.execute(
                "UPDATE court_record_cases SET status = ?, updated_at = ? WHERE id = ?",
                (status, now_iso(), case_id),
            )
            return {"status": "ok"}

    def bulk_classify_court_record_cases(
        self, case_ids: list[int], status: str,
    ) -> dict[str, Any]:
        with self._connect() as conn:
            self._ensure_court_record_tables(conn)
            placeholders = ",".join("?" for _ in case_ids)
            conn.execute(
                f"UPDATE court_record_cases SET status = ?, updated_at = ? WHERE id IN ({placeholders})",
                [status, now_iso()] + case_ids,
            )
            return {"status": "ok", "updated": len(case_ids)}

    def ingest_court_record_cases(self, case_ids: list[int]) -> dict[str, Any]:
        import uuid

        with self._connect() as conn:
            self._ensure_court_record_tables(conn)
            placeholders = ",".join("?" for _ in case_ids)
            rows = conn.execute(
                f"SELECT * FROM court_record_cases WHERE id IN ({placeholders}) AND status IN ('qualified', 'new')",
                case_ids,
            ).fetchall()
            cases = [dict(r) for r in rows]

        leads_created = 0
        for rec in cases:
            pr_name = (rec.get("pr_name") or "").strip()
            prop_addr = (rec.get("property_address") or "").strip()
            city = (rec.get("property_city") or "").strip()
            state = (rec.get("property_state") or "MO").strip()
            zipcode = (rec.get("property_zip") or "").strip()

            if not prop_addr and not pr_name:
                continue

            full = ", ".join(p for p in [prop_addr, city, state, zipcode] if p) or pr_name
            distress = ["probate_filed"] if rec.get("case_type") == "Probate" else ["civil_lien_filed"]

            item = {
                "property_id": rec.get("apn") or full,
                "address_full": full,
                "address_street": prop_addr,
                "address_city": city,
                "address_state": state,
                "address_zip": zipcode,
                "owner_name": pr_name,
                "mailing_address": rec.get("pr_address") or "",
                "distress_signals": distress,
                "source": "court_records",
                "source_metadata": json_dumps({
                    "case_number": rec.get("case_number"),
                    "deceased_name": rec.get("deceased_name"),
                    "case_type": rec.get("case_type"),
                    "file_date": rec.get("file_date"),
                    "case_url": rec.get("case_url"),
                    "pr_role": rec.get("pr_role"),
                    "assessed_value": rec.get("assessed_value"),
                }),
            }

            envelope = {
                "message_id": f"court-{rec['id']}-{uuid.uuid4().hex[:8]}",
                "type": "event",
                "lane": "houses",
                "timestamp": now_iso(),
                "payload": {
                    "command_type": "EXPORT",
                    "status": "success",
                    "items": [item],
                    "source_type": "court_records",
                    "list_name": f"Court Records — {rec.get('court_id', '')}",
                    "record_count": 1,
                },
            }
            self.ingest_envelope(envelope)
            leads_created += 1

            with self._connect() as conn:
                self._ensure_court_record_tables(conn)
                conn.execute(
                    "UPDATE court_record_cases SET status = 'ingested', lead_id = ?, updated_at = ? WHERE id = ?",
                    (full, now_iso(), rec["id"]),
                )

        self.update_source_run("court_records", status="success", count=leads_created)
        return {"status": "ok", "ingested": len(cases), "leads_created": leads_created}

    def ingest_water_shutoff_to_staging(self, record_ids: list[int]) -> dict[str, Any]:
        import uuid as _uuid
        with self._connect() as conn:
            self._ensure_water_shutoff_tables(conn)
            placeholders = ",".join("?" for _ in record_ids)
            rows = conn.execute(
                f"SELECT * FROM water_shutoff_records WHERE id IN ({placeholders}) AND status = 'new'",
                record_ids,
            ).fetchall()
            records = [dict(r) for r in rows]

        batch_id = f"ws-{_uuid.uuid4().hex[:8]}"
        addresses = []
        for rec in records:
            addr = (rec.get("service_address") or "").strip()
            city = (rec.get("city") or "").strip()
            state = (rec.get("state") or "").strip()
            zipcode = (rec.get("zip") or "").strip()
            holder = (rec.get("account_holder") or "").strip()
            if not addr:
                continue
            addresses.append({
                "address_street": addr,
                "address_city": city,
                "address_state": state,
                "address_zip": zipcode,
                "owner_name": holder,
                "source_ref": str(rec["id"]),
            })

        result = self.stage_for_verification("water_shutoffs", addresses, batch_id)

        with self._connect() as conn:
            self._ensure_water_shutoff_tables(conn)
            for rec_id in record_ids:
                conn.execute(
                    "UPDATE water_shutoff_records SET status = 'staged', updated_at = ? WHERE id = ?",
                    (now_iso(), rec_id),
                )

        self.update_source_run("water_shutoffs", status="staged", count=result["staged"])
        return {"status": "ok", "staged": result["staged"], "batch_id": batch_id}

    def ingest_court_records_to_staging(self, case_ids: list[int]) -> dict[str, Any]:
        import uuid as _uuid
        with self._connect() as conn:
            self._ensure_court_record_tables(conn)
            placeholders = ",".join("?" for _ in case_ids)
            rows = conn.execute(
                f"SELECT * FROM court_record_cases WHERE id IN ({placeholders}) AND status IN ('qualified', 'new')",
                case_ids,
            ).fetchall()
            cases = [dict(r) for r in rows]

        batch_id = f"cr-{_uuid.uuid4().hex[:8]}"
        addresses = []
        for rec in cases:
            prop_addr = (rec.get("property_address") or "").strip()
            city = (rec.get("property_city") or "").strip()
            state = (rec.get("property_state") or "MO").strip()
            zipcode = (rec.get("property_zip") or "").strip()
            pr_name = (rec.get("pr_name") or "").strip()
            if not prop_addr and not pr_name:
                continue
            addresses.append({
                "address_street": prop_addr,
                "address_city": city,
                "address_state": state,
                "address_zip": zipcode,
                "owner_name": pr_name,
                "source_ref": str(rec["id"]),
            })

        result = self.stage_for_verification("court_records", addresses, batch_id)

        with self._connect() as conn:
            self._ensure_court_record_tables(conn)
            for cid in case_ids:
                conn.execute(
                    "UPDATE court_record_cases SET status = 'staged', updated_at = ? WHERE id = ?",
                    (now_iso(), cid),
                )

        self.update_source_run("court_records", status="staged", count=result["staged"])
        return {"status": "ok", "staged": result["staged"], "batch_id": batch_id}

    def _parse_export_csv(self, text: str) -> list[dict[str, str]]:
        if not text.strip():
            return []
        reader = csv.DictReader(io.StringIO(text))
        return [dict(row) for row in reader]

    def _map_export_row(self, row: dict[str, str], lane: str) -> dict[str, Any]:
        def value(key: str) -> str:
            return str(row.get(key) or "").strip()

        def number(key: str) -> int | float | None:
            raw = value(key).replace("$", "").replace(",", "").replace("%", "").strip()
            if not raw:
                return None
            if "." in raw:
                try:
                    return float(raw)
                except ValueError:
                    return None
            try:
                return int(raw)
            except ValueError:
                return None

        def yes_no(key: str) -> bool | None:
            raw = normalize_text(value(key))
            if raw == "yes":
                return True
            if raw == "no":
                return False
            return None

        def compose_owner_name() -> str:
            owner1 = " ".join(filter(None, [value("Owner 1 First Name"), value("Owner 1 Last Name")]))
            owner2 = " ".join(filter(None, [value("Owner 2 First Name"), value("Owner 2 Last Name")]))
            return " & ".join(part for part in [owner1, owner2] if part)

        def compose_mailing_address() -> str:
            return ", ".join(
                part
                for part in [
                    value("Mailing Care of Name"),
                    value("Mailing Address"),
                    value("Mailing Unit #"),
                    value("Mailing City"),
                    value("Mailing State"),
                    value("Mailing Zip"),
                ]
                if part
            )

        def phone_numbers() -> list[dict[str, Any]]:
            items = []
            for index in range(1, 6):
                number_value = value(f"Phone {index}")
                if not number_value:
                    continue
                items.append(
                    {
                        "value": number_value,
                        "type": value(f"Phone {index} Type") or "unknown",
                        "dnc": yes_no(f"Phone {index} DNC"),
                    }
                )
            return items

        def email_addresses() -> list[str]:
            items = []
            for index in range(1, 5):
                email = value(f"Email {index}")
                if email:
                    items.append(email)
            return items

        def distress_signals() -> list[str]:
            signals = []
            mls_status = value("MLS Status").upper()
            if mls_status == "EXPIRED":
                signals.append("mls_expired")
            if mls_status == "WITHDRAWN":
                signals.append("mls_withdrawn")
            return signals

        address_street = value("Address")
        address_city = value("City")
        address_state = value("State")
        address_zip = value("Zip")
        full_address = ", ".join(part for part in [address_street, address_city, address_state, address_zip] if part)
        return {
            "property_id": value("APN") or full_address,
            "lane": lane,
            "address_full": full_address,
            "address_street": address_street,
            "address_city": address_city,
            "address_state": address_state,
            "address_zip": address_zip,
            "parcel_number": value("APN"),
            "property_type": value("Property Type"),
            "bedrooms": number("Bedrooms"),
            "bathrooms": number("Total Bathrooms"),
            "square_feet": number("Building Sqft"),
            "lot_size_sqft": number("Lot Size Sqft"),
            "year_built": number("Effective Year Built"),
            "current_tax_assessment": number("Total Assessed Value"),
            "last_sale_date": value("Last Sale Recording Date"),
            "last_sale_price": number("Last Sale Amount"),
            "owner_name": compose_owner_name(),
            "owner_type": "",
            "owner_occupied": yes_no("Owner Occupied"),
            "mailing_address": compose_mailing_address(),
            "do_not_mail": yes_no("Do Not Mail"),
            "phone_numbers": phone_numbers(),
            "email_addresses": email_addresses(),
            "contacts_returned": len(phone_numbers()) + len(email_addresses()),
            "litigator": yes_no("Litigator"),
            "last_mls_status": value("MLS Status"),
            "distress_signals": distress_signals(),
            "propstream_arv_estimate": number("Est. Value"),
            "propstream_equity": number("Est. Equity"),
            "propstream_ltv": number("Est. Loan-to-Value"),
            "propstream_foreclosure_factor": value("Foreclosure Factor"),
            "skip_trace_count": number("Skip Traces"),
            "lead_lifecycle_state": "enriched" if (phone_numbers() or email_addresses()) else "new",
        }

    # ── County Scouting ──────────────────────────────────────────────

    def _ensure_county_scouting_table(self, conn: sqlite3.Connection) -> None:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS county_scouting (
              fips TEXT PRIMARY KEY,
              county TEXT NOT NULL,
              state TEXT NOT NULL,
              population INTEGER DEFAULT 0,
              median_home_value INTEGER DEFAULT 0,
              search_term TEXT NOT NULL,
              scouted_at TEXT,
              pre_foreclosure_count INTEGER,
              tax_delinquent_count INTEGER,
              probate_count INTEGER,
              vacant_sfr_count INTEGER,
              total_distressed INTEGER,
              static_score INTEGER NOT NULL DEFAULT 0,
              scouted_score INTEGER,
              last_harvested_at TEXT,
              harvest_count INTEGER NOT NULL DEFAULT 0,
              leads_generated INTEGER NOT NULL DEFAULT 0,
              regulatory_tier TEXT NOT NULL DEFAULT 'green',
              updated_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_county_scouting_state ON county_scouting(state);
            CREATE INDEX IF NOT EXISTS idx_county_scouting_static_score ON county_scouting(static_score DESC);
            CREATE INDEX IF NOT EXISTS idx_county_scouting_scouted_score ON county_scouting(scouted_score DESC);
            """
        )

    def seed_counties(self, counties: list[dict[str, Any]]) -> dict[str, int]:
        ts = now_iso()
        inserted = 0
        skipped = 0
        with self._connect() as conn:
            self._ensure_county_scouting_table(conn)
            for c in counties:
                profile = self._county_seed_profile(c)

                try:
                    conn.execute(
                        """INSERT INTO county_scouting
                           (fips, county, state, population, median_home_value,
                            search_term, static_score, regulatory_tier, updated_at)
                           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                           ON CONFLICT(fips) DO UPDATE SET
                             population = excluded.population,
                             median_home_value = excluded.median_home_value,
                             search_term = excluded.search_term,
                             static_score = excluded.static_score,
                             regulatory_tier = excluded.regulatory_tier,
                             updated_at = excluded.updated_at
                        """,
                        (
                            str(c["fips"]).zfill(5),
                            profile["county"],
                            profile["state"],
                            profile["population"],
                            profile["median_home_value"],
                            profile["search_term"],
                            profile["static_score"],
                            profile["regulatory_tier"],
                            ts,
                        ),
                    )
                    inserted += 1
                except Exception:
                    skipped += 1
        return {"inserted": inserted, "skipped": skipped}

    def import_scout_results(self, results: list[dict[str, Any]]) -> int:
        from lead_engine.config import BLOCKED_STATES, HIGH_FRICTION_STATES

        updated = 0
        with self._connect() as conn:
            self._ensure_county_scouting_table(conn)
            for r in results:
                fips = str(r.get("fips") or "").zfill(5)
                if not fips:
                    continue
                signal_map = {}
                for s in r.get("signals", []):
                    signal_map[s["signal"]] = s["count"]

                pre_fc = signal_map.get("pre_foreclosure", 0)
                tax_del = signal_map.get("tax_delinquent", 0)
                probate = signal_map.get("probate", 0)
                total = r.get("total_distressed", pre_fc + tax_del + probate)

                row = conn.execute(
                    """
                    SELECT county, state, population, median_home_value, search_term,
                           static_score, regulatory_tier
                    FROM county_scouting
                    WHERE fips = ?
                    """,
                    (fips,),
                ).fetchone()
                if row:
                    county = row["county"]
                    state = row["state"]
                    pop = row["population"] or 0
                    mhv = row["median_home_value"] or 0
                    search_term = row["search_term"] or r.get("search_term") or fips
                    static_score = row["static_score"] or 0
                    regulatory_tier = row["regulatory_tier"] or "green"
                else:
                    profile = self._lookup_county_profile(fips, str(r.get("search_term") or ""))
                    if not profile:
                        continue
                    county = profile["county"]
                    state = profile["state"]
                    pop = profile["population"]
                    mhv = profile["median_home_value"]
                    search_term = profile["search_term"]
                    static_score = profile["static_score"]
                    regulatory_tier = profile["regulatory_tier"]

                sc = 0
                if state not in BLOCKED_STATES:
                    if total >= 500: sc += 35
                    elif total >= 200: sc += 25
                    elif total >= 100: sc += 15
                    elif total >= 50: sc += 8

                    if 80_000 <= mhv <= 180_000: sc += 25
                    elif 180_000 < mhv <= 300_000: sc += 20
                    elif 300_000 < mhv <= 400_000: sc += 10

                    if pop >= 500_000: sc += 15
                    elif pop >= 200_000: sc += 10
                    elif pop >= 100_000: sc += 5

                    sig_present = sum(1 for c in [pre_fc, tax_del, probate] if c > 20)
                    sc += sig_present * 3

                    if state in HIGH_FRICTION_STATES:
                        sc -= 10
                    sc = max(sc, 0)

                conn.execute(
                    """
                    INSERT INTO county_scouting (
                      fips, county, state, population, median_home_value, search_term,
                      scouted_at, pre_foreclosure_count, tax_delinquent_count, probate_count,
                      total_distressed, static_score, scouted_score, regulatory_tier, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(fips) DO UPDATE SET
                      county = excluded.county,
                      state = excluded.state,
                      population = excluded.population,
                      median_home_value = excluded.median_home_value,
                      search_term = excluded.search_term,
                      scouted_at = excluded.scouted_at,
                      pre_foreclosure_count = excluded.pre_foreclosure_count,
                      tax_delinquent_count = excluded.tax_delinquent_count,
                      probate_count = excluded.probate_count,
                      total_distressed = excluded.total_distressed,
                      static_score = excluded.static_score,
                      scouted_score = excluded.scouted_score,
                      regulatory_tier = excluded.regulatory_tier,
                      updated_at = excluded.updated_at
                    """,
                    (
                        fips,
                        county,
                        state,
                        pop,
                        mhv,
                        search_term,
                        r.get("scouted_at", now_iso()),
                        pre_fc,
                        tax_del,
                        probate,
                        total,
                        static_score,
                        sc,
                        regulatory_tier,
                        now_iso(),
                    ),
                )
                updated += 1
        return updated

    def get_scout_queue(self, batch_size: int = 50) -> list[dict[str, Any]]:
        with self._connect() as conn:
            self._ensure_county_scouting_table(conn)
            rows = conn.execute(
                """SELECT fips, county, state, search_term, static_score, population,
                          median_home_value, regulatory_tier
                   FROM county_scouting
                   WHERE scouted_at IS NULL AND regulatory_tier != 'blocked'
                   ORDER BY static_score DESC
                   LIMIT ?""",
                (batch_size,),
            ).fetchall()
            return [dict(r) for r in rows]

    def get_harvest_queue(self, batch_size: int = 10, cooldown_days: int = 14) -> list[dict[str, Any]]:
        with self._connect() as conn:
            self._ensure_county_scouting_table(conn)
            rows = conn.execute(
                """SELECT fips, county, state, search_term, scouted_score,
                          total_distressed, last_harvested_at
                   FROM county_scouting
                   WHERE scouted_at IS NOT NULL
                     AND regulatory_tier != 'blocked'
                     AND (scouted_score IS NOT NULL AND scouted_score > 0)
                     AND (last_harvested_at IS NULL
                          OR julianday('now') - julianday(last_harvested_at) > ?)
                   ORDER BY scouted_score DESC
                   LIMIT ?""",
                (cooldown_days, batch_size),
            ).fetchall()
            return [dict(r) for r in rows]

    def county_scouting_stats(self) -> dict[str, Any]:
        with self._connect() as conn:
            self._ensure_county_scouting_table(conn)
            total = conn.execute("SELECT COUNT(*) FROM county_scouting").fetchone()[0]
            eligible = conn.execute(
                "SELECT COUNT(*) FROM county_scouting WHERE regulatory_tier != 'blocked'"
            ).fetchone()[0]
            scouted = conn.execute(
                "SELECT COUNT(*) FROM county_scouting WHERE scouted_at IS NOT NULL"
            ).fetchone()[0]
            harvested = conn.execute(
                "SELECT COUNT(*) FROM county_scouting WHERE last_harvested_at IS NOT NULL"
            ).fetchone()[0]
            top = conn.execute(
                """SELECT fips, county, state, static_score, scouted_score,
                          total_distressed, population, median_home_value,
                          search_term, scouted_at, last_harvested_at, regulatory_tier
                   FROM county_scouting
                   WHERE regulatory_tier != 'blocked'
                   ORDER BY COALESCE(scouted_score, static_score) DESC
                   LIMIT 20"""
            ).fetchall()
            return {
                "total": total,
                "eligible": eligible,
                "scouted": scouted,
                "harvested": harvested,
                "top_counties": [dict(r) for r in top],
            }

    def list_counties(
        self, *, state: str | None = None, tier: str | None = None,
        scouted_only: bool = False, limit: int = 100, offset: int = 0,
    ) -> list[dict[str, Any]]:
        with self._connect() as conn:
            self._ensure_county_scouting_table(conn)
            clauses = []
            params: list[Any] = []
            if state:
                clauses.append("state = ?")
                params.append(state.upper())
            if tier:
                clauses.append("regulatory_tier = ?")
                params.append(tier)
            if scouted_only:
                clauses.append("scouted_at IS NOT NULL")
            where = " AND ".join(clauses) if clauses else "1=1"
            rows = conn.execute(
                f"""SELECT * FROM county_scouting
                    WHERE {where}
                    ORDER BY COALESCE(scouted_score, static_score) DESC
                    LIMIT ? OFFSET ?""",
                (*params, limit, offset),
            ).fetchall()
            return [dict(r) for r in rows]

    def record_harvest(self, fips: str, leads_created: int = 0) -> None:
        with self._connect() as conn:
            self._ensure_county_scouting_table(conn)
            conn.execute(
                """UPDATE county_scouting SET
                     last_harvested_at = ?,
                     harvest_count = harvest_count + 1,
                     leads_generated = leads_generated + ?,
                     updated_at = ?
                   WHERE fips = ?""",
                (now_iso(), leads_created, now_iso(), fips),
            )

    # ── Call Recordings ─────────────────────────────────────────

    def list_call_recordings(
        self,
        *,
        search: str | None = None,
        score: str | None = None,
        motivation: str | None = None,
        date_from: str | None = None,
        date_to: str | None = None,
        limit: int = 100,
        offset: int = 0,
    ) -> list[dict[str, Any]]:
        with self._connect() as conn:
            clauses: list[str] = []
            params: list[Any] = []
            if search:
                clauses.append(
                    "(seller_name LIKE ? OR property_address LIKE ? OR transcript LIKE ?)"
                )
                like = f"%{search}%"
                params.extend([like, like, like])
            if score:
                clauses.append("call_score = ?")
                params.append(score)
            if motivation:
                clauses.append(
                    "json_extract(seller_motivation_json, '$.overall_sentiment') = ?"
                )
                params.append(motivation)
            if date_from:
                clauses.append("call_date >= ?")
                params.append(date_from)
            if date_to:
                clauses.append("call_date <= ?")
                params.append(date_to)
            where = " AND ".join(clauses) if clauses else "1=1"
            rows = conn.execute(
                f"""SELECT * FROM call_recordings
                    WHERE {where}
                    ORDER BY created_at DESC
                    LIMIT ? OFFSET ?""",
                (*params, limit, offset),
            ).fetchall()
            return [dict(r) for r in rows]

    def get_call_recording(self, recording_id: int) -> dict[str, Any] | None:
        with self._connect() as conn:
            row = conn.execute(
                "SELECT * FROM call_recordings WHERE id = ?", (recording_id,)
            ).fetchone()
            return dict(row) if row else None

    def create_call_recording(self, data: dict[str, Any]) -> dict[str, Any]:
        now = now_iso()
        with self._connect() as conn:
            cur = conn.execute(
                """INSERT INTO call_recordings
                   (seller_name, property_address, call_date, file_path, file_name,
                    file_type, transcript, my_performance_json, seller_motivation_json,
                    call_score, next_action, next_action_due, notes, lead_id, created_at, updated_at)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (
                    data.get("seller_name", ""),
                    data.get("property_address"),
                    data.get("call_date"),
                    data.get("file_path"),
                    data.get("file_name"),
                    data.get("file_type"),
                    data.get("transcript"),
                    json_dumps(data["my_performance_json"]) if data.get("my_performance_json") else None,
                    json_dumps(data["seller_motivation_json"]) if data.get("seller_motivation_json") else None,
                    data.get("call_score"),
                    data.get("next_action"),
                    data.get("next_action_due"),
                    data.get("notes"),
                    data.get("lead_id"),
                    now,
                    now,
                ),
            )
            return {"status": "ok", "id": cur.lastrowid}

    def update_call_recording(self, recording_id: int, updates: dict[str, Any]) -> dict[str, Any]:
        allowed = {
            "seller_name", "property_address", "call_date", "transcript",
            "my_performance_json", "seller_motivation_json", "call_score",
            "next_action", "next_action_due", "notes", "lead_id",
        }
        sets: list[str] = []
        params: list[Any] = []
        for k, v in updates.items():
            if k not in allowed:
                continue
            if k in ("my_performance_json", "seller_motivation_json") and isinstance(v, (dict, list)):
                v = json_dumps(v)
            sets.append(f"{k} = ?")
            params.append(v)
        if not sets:
            return {"status": "no_changes"}
        sets.append("updated_at = ?")
        params.append(now_iso())
        params.append(recording_id)
        with self._connect() as conn:
            conn.execute(
                f"UPDATE call_recordings SET {', '.join(sets)} WHERE id = ?",
                params,
            )
        return {"status": "ok", "id": recording_id}

    def delete_call_recording(self, recording_id: int) -> dict[str, Any]:
        with self._connect() as conn:
            conn.execute("DELETE FROM call_recordings WHERE id = ?", (recording_id,))
        return {"status": "ok", "id": recording_id}

    def call_recording_stats(self) -> dict[str, Any]:
        with self._connect() as conn:
            total = conn.execute("SELECT COUNT(*) as cnt FROM call_recordings").fetchone()["cnt"]
            by_score: dict[str, int] = {}
            for row in conn.execute(
                "SELECT call_score, COUNT(*) as cnt FROM call_recordings WHERE call_score IS NOT NULL GROUP BY call_score"
            ).fetchall():
                by_score[row["call_score"]] = row["cnt"]
            transcribed = conn.execute(
                "SELECT COUNT(*) as cnt FROM call_recordings WHERE transcript IS NOT NULL AND transcript != ''"
            ).fetchone()["cnt"]
            graded = conn.execute(
                "SELECT COUNT(*) as cnt FROM call_recordings WHERE my_performance_json IS NOT NULL"
            ).fetchone()["cnt"]
            return {
                "total": total,
                "transcribed": transcribed,
                "graded": graded,
                "by_score": by_score,
            }

    # ── Contracts ──────────────────────────────────────────────────

    def create_contract(self, data: dict[str, Any]) -> dict[str, Any]:
        import uuid
        now = datetime.now(timezone.utc).isoformat()
        token = uuid.uuid4().hex
        purchase_price = int(data.get("purchase_price") or 0)
        option_fee = int(data.get("option_fee") or 0)
        amount_due = purchase_price - option_fee

        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO contracts (
                  lead_id, contract_type, status, contract_data_json,
                  purchaser_name, purchaser_address, seller_name, seller_address,
                  property_address, property_county, property_state,
                  option_fee, purchase_price, amount_due_at_closing,
                  option_term_end_date, closing_date,
                  signing_token, seller_email,
                  created_at, updated_at
                ) VALUES (?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    data["lead_id"],
                    data.get("contract_type", "option_agreement"),
                    json.dumps(data),
                    data.get("purchaser_name"),
                    data.get("purchaser_address"),
                    data.get("seller_name"),
                    data.get("seller_address"),
                    data.get("property_address"),
                    data.get("property_county"),
                    data.get("property_state"),
                    option_fee,
                    purchase_price,
                    amount_due,
                    data.get("option_term_end_date"),
                    data.get("closing_date"),
                    token,
                    data.get("seller_email"),
                    now,
                    now,
                ),
            )
            contract_id = conn.execute("SELECT last_insert_rowid()").fetchone()[0]
        return {"status": "ok", "id": contract_id, "signing_token": token}

    def get_contract(self, contract_id: int) -> dict[str, Any] | None:
        with self._connect() as conn:
            row = conn.execute("SELECT * FROM contracts WHERE id = ?", (contract_id,)).fetchone()
        return dict(row) if row else None

    def list_contracts(
        self,
        lead_id: str | None = None,
        status: str | None = None,
        limit: int = 100,
    ) -> list[dict[str, Any]]:
        clauses: list[str] = []
        params: list[Any] = []
        if lead_id:
            clauses.append("c.lead_id = ?")
            params.append(lead_id)
        if status:
            clauses.append("c.status = ?")
            params.append(status)
        where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
        params.append(limit)
        with self._connect() as conn:
            rows = conn.execute(
                f"""
                SELECT c.*, p.address_full, o.owner_name
                FROM contracts c
                LEFT JOIN leads l ON l.lead_id = c.lead_id
                LEFT JOIN properties p ON p.property_id = l.property_id
                LEFT JOIN owners o ON o.owner_id = l.owner_id
                {where}
                ORDER BY c.created_at DESC
                LIMIT ?
                """,
                params,
            ).fetchall()
        return [dict(r) for r in rows]

    def get_contract_by_token(self, token: str) -> dict[str, Any] | None:
        with self._connect() as conn:
            row = conn.execute(
                "SELECT * FROM contracts WHERE signing_token = ?", (token,)
            ).fetchone()
        return dict(row) if row else None

    def sign_contract(
        self, contract_id: int, role: str, signature_base64: str
    ) -> dict[str, Any]:
        now = datetime.now(timezone.utc).isoformat()
        with self._connect() as conn:
            if role == "purchaser":
                conn.execute(
                    "UPDATE contracts SET purchaser_signature = ?, purchaser_signed_at = ?, updated_at = ? WHERE id = ?",
                    (signature_base64, now, now, contract_id),
                )
            elif role == "seller":
                conn.execute(
                    "UPDATE contracts SET seller_signature = ?, seller_signed_at = ?, updated_at = ? WHERE id = ?",
                    (signature_base64, now, now, contract_id),
                )
            row = conn.execute("SELECT * FROM contracts WHERE id = ?", (contract_id,)).fetchone()
            if row and row["purchaser_signature"] and row["seller_signature"]:
                conn.execute(
                    "UPDATE contracts SET status = 'fully_signed', updated_at = ? WHERE id = ?",
                    (now, contract_id),
                )
                conn.execute(
                    "UPDATE leads SET status = 'under_contract', updated_at = ? WHERE lead_id = ?",
                    (now, row["lead_id"]),
                )
                conn.execute(
                    """INSERT INTO lead_status_history (lead_id, from_status, to_status, reason, created_at)
                       VALUES (?, (SELECT status FROM leads WHERE lead_id = ?), 'under_contract', 'Contract fully signed', ?)""",
                    (row["lead_id"], row["lead_id"], now),
                )
        return {"status": "ok", "id": contract_id, "role": role}

    def sign_contract_by_token(self, token: str, signature_base64: str) -> dict[str, Any]:
        contract = self.get_contract_by_token(token)
        if not contract:
            return {"status": "error", "message": "Invalid signing token"}
        if contract["status"] == "fully_signed":
            return {"status": "error", "message": "Contract already fully signed"}
        return self.sign_contract(contract["id"], "seller", signature_base64)

    def update_contract(self, contract_id: int, updates: dict[str, Any]) -> dict[str, Any]:
        now = datetime.now(timezone.utc).isoformat()
        allowed = {
            "status", "signing_url", "signing_email_sent_at",
            "seller_email", "pdf_path", "signed_pdf_path",
        }
        sets: list[str] = ["updated_at = ?"]
        params: list[Any] = [now]
        for k, v in updates.items():
            if k in allowed:
                sets.append(f"{k} = ?")
                params.append(v)
        params.append(contract_id)
        with self._connect() as conn:
            conn.execute(
                f"UPDATE contracts SET {', '.join(sets)} WHERE id = ?", params,
            )
        return {"status": "ok", "id": contract_id}

    def void_contract(self, contract_id: int) -> dict[str, Any]:
        now = datetime.now(timezone.utc).isoformat()
        with self._connect() as conn:
            conn.execute(
                "UPDATE contracts SET status = 'voided', updated_at = ? WHERE id = ?",
                (now, contract_id),
            )
        return {"status": "ok", "id": contract_id}

    # ── User Settings ──────────────────────────────────────────────

    def get_user_settings(self) -> dict[str, str]:
        with self._connect() as conn:
            rows = conn.execute("SELECT key, value FROM user_settings").fetchall()
        return {row["key"]: row["value"] for row in rows}

    def update_user_settings(self, data: dict[str, str]) -> dict[str, Any]:
        now = datetime.now(timezone.utc).isoformat()
        with self._connect() as conn:
            for key, value in data.items():
                conn.execute(
                    """INSERT INTO user_settings (key, value, updated_at)
                       VALUES (?, ?, ?)
                       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at""",
                    (key, value, now),
                )
        return {"status": "ok", "updated": len(data)}
