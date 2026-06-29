"""Dispatcher agent — manages follow-ups, call grading, and queue hygiene."""

from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from typing import TYPE_CHECKING

from .base import BaseAgent

if TYPE_CHECKING:
    from ..store import HermesStore
    from ..server import HermesRuntime
    from .proxy_client import ClaudeProxyClient


class DispatcherAgent(BaseAgent):
    agent_type = "dispatcher"

    def execute(self) -> None:
        self._overdue_follow_ups()
        self._missing_follow_ups()
        self._requeue_stale_leads()
        self._ungraded_calls()
        self._untranscribed_calls()
        self._call_shy_leads()
        self._daily_call_brief()

    # ------------------------------------------------------------------
    # 1. Overdue follow-ups
    # ------------------------------------------------------------------
    def _overdue_follow_ups(self) -> None:
        self.log("Checking for overdue follow-ups...")
        rows = self.query(
            """
            SELECT f.*, p.address_full, o.owner_name
            FROM follow_ups f
            JOIN leads l ON l.lead_id = f.lead_id
            LEFT JOIN properties p ON p.property_id = l.property_id
            LEFT JOIN owners o ON o.owner_id = l.owner_id
            WHERE f.completed_at IS NULL
              AND f.scheduled_at < datetime('now')
            """
        )
        if not rows:
            self.log("No overdue follow-ups")
            return

        self.log(f"Found {len(rows)} overdue follow-ups")
        for row in rows:
            owner = row.get("owner_name") or "Unknown owner"
            address = row.get("address_full") or "Unknown address"
            scheduled = row.get("scheduled_at", "unknown date")
            self.create_proposal(
                title=f"Overdue follow-up: {owner} @ {address}",
                description=(
                    f"Follow-up for {owner} at {address} was scheduled for "
                    f"{scheduled} and has not been completed. "
                    f"Adding a note to flag this for immediate attention."
                ),
                payload={
                    "action": "add_note",
                    "lead_id": row["lead_id"],
                    "follow_up_id": row["id"],
                    "note": f"Overdue follow-up (was due {scheduled}). Needs immediate callback.",
                },
                priority="high",
            )

    # ------------------------------------------------------------------
    # 2. Missing follow-ups for contacted / not-interested leads
    # ------------------------------------------------------------------
    def _missing_follow_ups(self) -> None:
        self.log("Finding contacted leads without scheduled follow-ups...")
        rows = self.query(
            """
            SELECT l.lead_id, p.address_full, o.owner_name, l.status
            FROM leads l
            LEFT JOIN properties p ON p.property_id = l.property_id
            LEFT JOIN owners o ON o.owner_id = l.owner_id
            LEFT JOIN follow_ups f ON f.lead_id = l.lead_id AND f.completed_at IS NULL
            WHERE l.status IN ('contacted','not_interested')
              AND f.id IS NULL
            LIMIT 50
            """
        )
        self._leads_scanned += len(rows)
        if not rows:
            self.log("All contacted leads have follow-ups scheduled")
            return

        self.log(f"Found {len(rows)} leads without follow-ups")
        for row in rows:
            owner = row.get("owner_name") or "Unknown owner"
            address = row.get("address_full") or "Unknown address"
            status = row["status"]

            if status == "contacted":
                days_out = 7
                reason = "contacted but no follow-up scheduled — check back in 7 days"
            else:
                days_out = 30
                reason = "marked not interested — circle back in 30 days"

            follow_up_date = (
                datetime.now(timezone.utc) + timedelta(days=days_out)
            ).isoformat()

            self.create_proposal(
                title=f"Schedule follow-up: {owner} ({status})",
                description=(
                    f"{owner} at {address} is {status}. {reason.capitalize()}."
                ),
                payload={
                    "action": "create_follow_up",
                    "lead_id": row["lead_id"],
                    "scheduled_at": follow_up_date,
                    "days_out": days_out,
                    "reason": reason,
                },
                priority="medium",
            )

    # ------------------------------------------------------------------
    # 3. Auto re-queue stale no-answer/voicemail leads after 10 days
    # ------------------------------------------------------------------
    def _requeue_stale_leads(self) -> None:
        self.log("Checking for leads to re-queue (10+ days since last call)...")
        result = self.store.requeue_stale_leads(days_threshold=10)
        count = result.get("requeued", 0)
        if count == 0:
            self.log("No leads eligible for re-queue")
            return
        self.log(f"Re-queued {count} leads back into the dial queue")

    # ------------------------------------------------------------------
    # 4. Ungraded call recordings (have transcript, no score)
    # ------------------------------------------------------------------
    def _ungraded_calls(self) -> None:
        self.log("Checking for ungraded call recordings...")
        rows = self.query(
            """
            SELECT id, seller_name
            FROM call_recordings
            WHERE call_score IS NULL
              AND transcript IS NOT NULL
            """
        )
        if not rows:
            self.log("No ungraded calls")
            return

        self.log(f"Found {len(rows)} ungraded call recordings")
        for row in rows:
            seller = row.get("seller_name") or "Unknown seller"
            self.create_proposal(
                title=f"Grade call recording: {seller}",
                description=(
                    f"Call with {seller} (recording #{row['id']}) has a transcript "
                    f"but has not been scored. Grading will assess seller motivation "
                    f"and flag hot leads for immediate follow-up."
                ),
                payload={
                    "action": "grade_recording",
                    "recording_id": row["id"],
                    "seller_name": seller,
                },
                priority="medium",
            )

    # ------------------------------------------------------------------
    # 4. Untranscribed call recordings
    # ------------------------------------------------------------------
    def _untranscribed_calls(self) -> None:
        self.log("Checking for untranscribed call recordings...")
        rows = self.query(
            """
            SELECT id, seller_name, file_path
            FROM call_recordings
            WHERE transcript IS NULL
              AND file_path IS NOT NULL
            """
        )
        if not rows:
            self.log("No untranscribed calls")
            return

        self.log(f"Found {len(rows)} untranscribed call recordings")
        for row in rows:
            seller = row.get("seller_name") or "Unknown seller"
            self.create_proposal(
                title=f"Transcribe call recording: {seller}",
                description=(
                    f"Call with {seller} (recording #{row['id']}) has an audio file "
                    f"at {row['file_path']} but no transcript. Transcribing will "
                    f"enable AI grading and searchable call history."
                ),
                payload={
                    "action": "transcribe_recording",
                    "recording_id": row["id"],
                    "seller_name": seller,
                    "file_path": row["file_path"],
                },
                priority="low",
            )

    # ------------------------------------------------------------------
    # 5. Call-shy leads — queued too long without action
    # ------------------------------------------------------------------
    def _call_shy_leads(self) -> None:
        self.log("Checking for stale queued leads...")
        rows = self.query(
            """
            SELECT l.lead_id, p.address_full,
                   julianday('now') - julianday(l.updated_at) as days_stale
            FROM leads l
            JOIN properties p ON p.property_id = l.property_id
            WHERE l.status = 'queued'
              AND julianday('now') - julianday(l.updated_at) > 14
            LIMIT 30
            """
        )
        self._leads_scanned += len(rows)
        if not rows:
            self.log("No stale queued leads")
            return

        self.log(f"Found {len(rows)} stale queued leads")
        for row in rows:
            days = row["days_stale"]
            address = row.get("address_full") or "Unknown address"

            if days > 30:
                self.create_proposal(
                    title=f"Mark dead: {address} ({int(days)}d stale)",
                    description=(
                        f"Lead at {address} has been queued for {int(days)} days "
                        f"with no activity. After 30+ days in queue without a call, "
                        f"this lead should be marked dead to keep the queue clean."
                    ),
                    payload={
                        "action": "dead",
                        "lead_id": row["lead_id"],
                        "days_stale": int(days),
                        "reason": f"Queued for {int(days)} days with no contact attempt",
                    },
                    priority="low",
                )
            else:
                self.create_proposal(
                    title=f"Attention needed: {address} ({int(days)}d in queue)",
                    description=(
                        f"Lead at {address} has been sitting in the queue for "
                        f"{int(days)} days. Flagging for attention before it goes stale."
                    ),
                    payload={
                        "action": "add_note",
                        "lead_id": row["lead_id"],
                        "days_stale": int(days),
                        "note": f"Queued for {int(days)} days — needs a call soon or will go dead.",
                    },
                    priority="medium",
                )

    # ------------------------------------------------------------------
    # 6. Daily call brief (AI-generated digest)
    # ------------------------------------------------------------------
    def _daily_call_brief(self) -> None:
        self.log("Building daily call brief...")

        # Gather funnel counts
        funnel_queries = {
            "queued": "SELECT COUNT(*) as cnt FROM leads WHERE status = 'queued'",
            "contacted": "SELECT COUNT(*) as cnt FROM leads WHERE status = 'contacted'",
            "interested": "SELECT COUNT(*) as cnt FROM leads WHERE status = 'interested'",
            "under_contract": "SELECT COUNT(*) as cnt FROM leads WHERE status = 'under_contract'",
            "dead": "SELECT COUNT(*) as cnt FROM leads WHERE status = 'dead'",
        }
        funnel = {}
        for key, sql in funnel_queries.items():
            row = self.query_one(sql)
            funnel[key] = row["cnt"] if row else 0

        # Overdue follow-ups count
        row = self.query_one(
            """
            SELECT COUNT(*) as cnt FROM follow_ups
            WHERE completed_at IS NULL AND scheduled_at < datetime('now')
            """
        )
        overdue_count = row["cnt"] if row else 0

        # Today's follow-ups
        row = self.query_one(
            """
            SELECT COUNT(*) as cnt FROM follow_ups
            WHERE completed_at IS NULL
              AND date(scheduled_at) = date('now')
            """
        )
        today_followups = row["cnt"] if row else 0

        # Recent calls
        recent_calls = self.query(
            """
            SELECT seller_name, call_score, property_address
            FROM call_recordings
            WHERE date(created_at) >= date('now', '-1 day')
            ORDER BY created_at DESC
            LIMIT 10
            """
        )

        data = {
            "funnel": funnel,
            "overdue_follow_ups": overdue_count,
            "today_follow_ups": today_followups,
            "recent_calls": recent_calls,
        }

        if self.ai_available:
            prompt = (
                "You are a real estate wholesaling operations assistant. "
                "Generate a brief, conversational daily call brief for the operator. "
                "Keep it under 200 words. Be direct and actionable.\n\n"
                f"Pipeline funnel:\n{json.dumps(funnel, indent=2)}\n\n"
                f"Overdue follow-ups: {overdue_count}\n"
                f"Follow-ups due today: {today_followups}\n\n"
                f"Recent calls (last 24h):\n{json.dumps(recent_calls, indent=2)}\n\n"
                "Format: Start with the most important thing to do today, "
                "then a quick funnel snapshot, then any warnings."
            )
            brief_text = self.call_claude(
                prompt,
                system="You are a concise operations briefer for a real estate wholesaling business.",
            )
        else:
            # Rules-only fallback
            lines = [
                f"Queue: {funnel['queued']} leads ready to dial.",
                f"Contacted: {funnel['contacted']} | Interested: {funnel['interested']} | Under contract: {funnel['under_contract']}",
            ]
            if overdue_count:
                lines.append(f"WARNING: {overdue_count} overdue follow-ups need attention.")
            if today_followups:
                lines.append(f"You have {today_followups} follow-ups scheduled for today.")
            if recent_calls:
                lines.append(f"{len(recent_calls)} calls logged in the last 24 hours.")
            if funnel["dead"] > 0:
                lines.append(f"{funnel['dead']} leads marked dead.")
            brief_text = "\n".join(lines)

        if brief_text:
            self.log("Daily brief generated")
            self.create_proposal(
                title="Daily call brief",
                description="AI-generated summary of today's pipeline state and action items.",
                payload={
                    "action": "daily_digest",
                    "display_type": "digest",
                    "content": brief_text,
                    "data": {
                        "funnel": funnel,
                        "overdue_follow_ups": overdue_count,
                        "today_follow_ups": today_followups,
                        "recent_call_count": len(recent_calls),
                    },
                },
                priority="low",
            )
