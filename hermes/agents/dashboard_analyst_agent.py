"""Dashboard Analyst agent — KPIs, caller performance, data health."""

from __future__ import annotations

import json
from datetime import datetime, timezone, timedelta
from typing import Any

from .conversational_base import ConversationalAgent, AgentResponse


class DashboardAnalystAgent(ConversationalAgent):
    agent_type = "analyst"
    system_prompt = (
        "You analyze business performance for a real estate wholesaling operation. "
        "You report on KPIs, caller activity, dial metrics, and data health. "
        "Be specific with numbers. When asked about a caller, include their actual dials, "
        "billable hours, and integrity score. Keep responses concise."
    )

    def get_operations(self) -> list[dict]:
        return [
            {
                "name": "caller_activity",
                "description": "Get detailed activity breakdown for a specific caller on a date",
                "params": [
                    {"name": "user_id", "type": "integer", "description": "Caller's user ID"},
                    {"name": "date", "type": "string", "description": "Date in YYYY-MM-DD format (default today)"},
                ],
                "tier": "read",
                "keywords": ["brayden", "jalen", "jaylen", "caller activity"],
            },
            {
                "name": "kpi_summary",
                "description": "Get top-level KPI dashboard summary",
                "params": [],
                "tier": "read",
                "keywords": ["kpi", "summary", "overview", "dashboard"],
            },
            {
                "name": "call_metrics",
                "description": "Get call volume metrics over N days",
                "params": [{"name": "days", "type": "integer", "description": "Days to look back (default 7)"}],
                "tier": "read",
                "keywords": ["calls", "call metrics", "how many calls", "dial"],
            },
            {
                "name": "daily_activity",
                "description": "Get daily activity trends over N days",
                "params": [{"name": "days", "type": "integer", "description": "Days to look back (default 30)"}],
                "tier": "read",
                "keywords": ["daily", "activity", "trend"],
            },
            {
                "name": "activity_summary",
                "description": "Get per-caller per-day activity summary over a date range",
                "params": [
                    {"name": "date_from", "type": "string", "description": "Start date YYYY-MM-DD"},
                    {"name": "date_to", "type": "string", "description": "End date YYYY-MM-DD"},
                    {"name": "user_id", "type": "integer", "description": "Optional: filter to one caller"},
                ],
                "tier": "read",
                "keywords": ["activity summary", "weekly", "range"],
            },
            {
                "name": "integrity_report",
                "description": "Check caller integrity — are they honestly reporting their hours?",
                "params": [
                    {"name": "date_from", "type": "string", "description": "Start date YYYY-MM-DD"},
                    {"name": "date_to", "type": "string", "description": "End date YYYY-MM-DD"},
                ],
                "tier": "read",
                "keywords": ["integrity", "honest", "fraud", "trust", "lying"],
            },
            {
                "name": "dial_check",
                "description": "Quick check on recent dial activity (last N minutes)",
                "params": [{"name": "minutes", "type": "integer", "description": "Minutes to look back (default 15)"}],
                "tier": "read",
                "keywords": ["dial check", "right now", "currently", "live"],
            },
            {
                "name": "dial_streak",
                "description": "Get current dial streak stats",
                "params": [],
                "tier": "read",
                "keywords": ["streak", "consecutive"],
            },
            {
                "name": "tracker_kpis",
                "description": "Get detailed tracker KPI data",
                "params": [],
                "tier": "read",
                "keywords": ["tracker", "detailed kpi"],
            },
            {
                "name": "clean_bad_numbers",
                "description": "Remove leads with bad phone numbers from the queue",
                "params": [],
                "tier": "write",
                "keywords": ["clean", "bad number", "bad phone"],
            },
            {
                "name": "daily_digest",
                "description": "Generate a comprehensive daily operations digest",
                "params": [],
                "tier": "read",
                "keywords": ["digest", "briefing", "report", "what happened"],
            },
            {
                "name": "pipeline_health",
                "description": "Analyze pipeline health and flag issues",
                "params": [],
                "tier": "read",
                "keywords": ["health", "pipeline health", "issues"],
            },
        ]

    def execute_operation(self, operation: str, params: dict, user: dict) -> dict:
        store = self.store
        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        week_ago = (datetime.now(timezone.utc) - timedelta(days=7)).strftime("%Y-%m-%d")

        match operation:
            case "kpi_summary":
                return store.get_kpi_summary()

            case "call_metrics":
                days = params.get("days", 7)
                return store.get_call_metrics(days_back=days)

            case "daily_activity":
                days = params.get("days", 30)
                return {"days": store.get_daily_activity(days_back=days)}

            case "caller_activity":
                uid = params.get("user_id")
                date = params.get("date", today)
                if not uid:
                    uid = self._resolve_caller_id(params)
                if not uid:
                    return {"error": "Could not determine which caller. Specify user_id."}
                return store.get_caller_activity(uid, date)

            case "activity_summary":
                date_from = params.get("date_from", week_ago)
                date_to = params.get("date_to", today)
                uid = params.get("user_id")
                return {"summary": store.get_activity_summary(date_from, date_to, uid)}

            case "integrity_report":
                date_from = params.get("date_from", week_ago)
                date_to = params.get("date_to", today)
                return store.get_integrity_report(date_from, date_to)

            case "dial_check":
                minutes = params.get("minutes", 15)
                return store.get_dial_check(minutes_back=minutes)

            case "dial_streak":
                return store.get_dial_streak()

            case "tracker_kpis":
                return store.get_tracker_kpis()

            case "clean_bad_numbers":
                return store.clean_queue_bad_numbers()

            case "daily_digest":
                return self._build_digest()

            case "pipeline_health":
                return self._analyze_pipeline_health()

            case _:
                return {"error": f"Unknown operation: {operation}"}

    def _resolve_caller_id(self, params: dict) -> int | None:
        """Try to figure out which caller the user is asking about from context."""
        search_text = json.dumps(params).lower()
        raw_msg = params.get("_raw_message", "")
        if raw_msg:
            search_text += " " + raw_msg.lower()
        with self.store._connect() as conn:
            callers = conn.execute(
                "SELECT id, username, display_name FROM users WHERE role = 'caller' AND active = 1"
            ).fetchall()
            for c in callers:
                c = dict(c)
                for field in ["username", "display_name"]:
                    if c[field] and c[field].lower() in search_text:
                        return c["id"]
        return None

    def _build_digest(self) -> dict:
        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        week_ago = (datetime.now(timezone.utc) - timedelta(days=7)).strftime("%Y-%m-%d")

        pipeline = self.store.get_pipeline_stats()
        calls = self.store.get_call_metrics(days_back=1)
        follow_ups = self.store.list_follow_ups(pending_only=True)
        integrity = self.store.get_integrity_report(week_ago, today)
        assignments = self.store.get_assignment_stats()

        return {
            "date": today,
            "pipeline": pipeline,
            "calls_today": calls,
            "pending_follow_ups": len(follow_ups) if isinstance(follow_ups, list) else 0,
            "integrity": integrity,
            "assignments": assignments,
        }

    def _analyze_pipeline_health(self) -> dict:
        stats = self.store.get_pipeline_stats()
        issues = []

        if isinstance(stats, dict):
            status_counts = {}
            if isinstance(stats.get("by_status"), list):
                for item in stats["by_status"]:
                    status_counts[item.get("status", "")] = item.get("count", 0)

            if status_counts.get("queued", 0) == 0:
                issues.append("No leads in queue — callers have nothing to dial")
            if status_counts.get("enriched", 0) > 500:
                issues.append(f"{status_counts['enriched']} enriched leads waiting to be queued")
            if status_counts.get("new", 0) > 1000:
                issues.append(f"{status_counts['new']} raw leads waiting for enrichment")

        return {"pipeline": stats, "issues": issues, "healthy": len(issues) == 0}

    def _get_state_snapshot(self) -> str:
        try:
            today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
            kpi = self.store.get_kpi_summary()

            callers = []
            with self.store._connect() as conn:
                rows = conn.execute(
                    "SELECT id, display_name FROM users WHERE role = 'caller' AND active = 1"
                ).fetchall()
                callers = [dict(r) for r in rows]

            lines = ["KPI Summary:"]
            if isinstance(kpi, dict):
                for k, v in kpi.items():
                    if isinstance(v, (int, float, str)):
                        lines.append(f"  {k}: {v}")

            lines.append(f"Today: {today}")
            lines.append("Callers:")
            for c in callers:
                lines.append(f"  id={c['id']} name={c['display_name']}")

            return "\n".join(lines)
        except Exception as e:
            return f"Error getting state: {e}"
