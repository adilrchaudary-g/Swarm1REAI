"""Lead Manager agent — manages leads, assignments, follow-ups, pipeline."""

from __future__ import annotations

import json
from typing import Any

from .conversational_base import ConversationalAgent, AgentResponse


class LeadManagerAgent(ConversationalAgent):
    agent_type = "lead_manager"
    system_prompt = (
        "You manage leads for a real estate wholesaling operation. "
        "You assign lead lists to callers, query pipeline stats, manage follow-ups, "
        "and handle lead status changes. Be direct and use specific numbers. "
        "When assigning leads, always confirm how many were assigned and to whom."
    )

    def get_operations(self) -> list[dict]:
        return [
            {
                "name": "pipeline_stats",
                "description": "Get lead counts by pipeline status",
                "params": [],
                "tier": "read",
                "keywords": ["pipeline", "how many leads", "lead count", "queued", "status"],
            },
            {
                "name": "list_leads",
                "description": "Query leads with filters",
                "params": [
                    {"name": "status", "type": "string", "description": "Filter by status (new, enriched, scored, queued, contacted, interested, etc.)"},
                    {"name": "assigned_to", "type": "integer", "description": "Filter by assigned user ID"},
                    {"name": "limit", "type": "integer", "description": "Max results (default 50)"},
                ],
                "tier": "read",
                "keywords": ["list leads", "show leads", "find leads"],
            },
            {
                "name": "assignment_stats",
                "description": "Show lead assignment stats per caller",
                "params": [],
                "tier": "read",
                "keywords": ["assignment", "assigned", "who has", "caller list"],
            },
            {
                "name": "assignment_comparison",
                "description": "Compare quality of lead lists between callers",
                "params": [{"name": "caller_ids", "type": "array", "description": "List of caller user IDs"}],
                "tier": "read",
                "keywords": ["compare", "quality", "difference"],
            },
            {
                "name": "assign_leads",
                "description": "Auto-assign top leads to callers from unassigned pool",
                "params": [
                    {"name": "caller_ids", "type": "array", "description": "List of user IDs to assign to"},
                    {"name": "count_per_caller", "type": "integer", "description": "How many leads each caller gets"},
                ],
                "tier": "write",
                "keywords": ["assign", "give leads", "give me leads", "assign leads"],
            },
            {
                "name": "unassign_leads",
                "description": "Remove all lead assignments for a user",
                "params": [{"name": "user_id", "type": "integer", "description": "User ID to unassign"}],
                "tier": "write",
                "keywords": ["unassign", "remove assignment", "clear list"],
            },
            {
                "name": "requeue_stale",
                "description": "Re-queue leads that haven't been called in N days",
                "params": [{"name": "days", "type": "integer", "description": "Days threshold (default 10)"}],
                "tier": "write",
                "keywords": ["requeue", "re-queue", "stale"],
            },
            {
                "name": "list_follow_ups",
                "description": "List pending or overdue follow-ups",
                "params": [{"name": "pending_only", "type": "boolean", "description": "Only show pending (default true)"}],
                "tier": "read",
                "keywords": ["follow-up", "follow up", "callback", "overdue"],
            },
            {
                "name": "create_follow_up",
                "description": "Schedule a follow-up for a lead",
                "params": [
                    {"name": "lead_id", "type": "string", "description": "Lead ID"},
                    {"name": "type", "type": "string", "description": "Follow-up type (call_back, text, email)"},
                    {"name": "scheduled_at", "type": "string", "description": "ISO datetime for follow-up"},
                    {"name": "notes", "type": "string", "description": "Optional notes"},
                ],
                "tier": "write",
                "keywords": ["schedule", "create follow"],
            },
            {
                "name": "source_quality",
                "description": "Show lead source quality and ROI metrics",
                "params": [],
                "tier": "read",
                "keywords": ["source", "roi", "quality"],
            },
            {
                "name": "conversion_funnel",
                "description": "Show conversion funnel over N days",
                "params": [{"name": "days", "type": "integer", "description": "Days to look back (default 30)"}],
                "tier": "read",
                "keywords": ["funnel", "conversion"],
            },
            {
                "name": "underwriting_reports",
                "description": "List underwriting reports",
                "params": [{"name": "status", "type": "string", "description": "Filter by status"}],
                "tier": "read",
                "keywords": ["underwriting", "underwrite", "report"],
            },
            {
                "name": "update_lead_status",
                "description": "Update a single lead's status",
                "params": [
                    {"name": "lead_id", "type": "string", "description": "Lead ID"},
                    {"name": "status", "type": "string", "description": "New status"},
                    {"name": "reason", "type": "string", "description": "Reason for change"},
                ],
                "tier": "write",
                "keywords": ["update status", "move lead", "change status"],
            },
            {
                "name": "bulk_status_change",
                "description": "Bulk update lead statuses (destructive — requires confirmation)",
                "params": [
                    {"name": "lead_ids", "type": "array", "description": "List of lead IDs"},
                    {"name": "status", "type": "string", "description": "New status"},
                    {"name": "reason", "type": "string", "description": "Reason"},
                ],
                "tier": "approval",
                "keywords": ["bulk", "mass update", "mark all dead", "archive all"],
            },
            {
                "name": "run_skip_trace",
                "description": "Run skip-trace pipeline (costs PropStream credits — requires confirmation)",
                "params": [],
                "tier": "approval",
                "keywords": ["skip trace", "skip-trace", "trace"],
            },
        ]

    def execute_operation(self, operation: str, params: dict, user: dict) -> dict:
        store = self.store
        match operation:
            case "pipeline_stats":
                return store.get_pipeline_stats()

            case "list_leads":
                data = store.list_all_leads(
                    status=params.get("status"),
                    assigned_to=params.get("assigned_to"),
                    limit=params.get("limit", 50),
                )
                return {"leads": data, "count": len(data)}

            case "assignment_stats":
                return {"stats": store.get_assignment_stats()}

            case "assignment_comparison":
                ids = params.get("caller_ids", [])
                return store.get_assignment_comparison(ids)

            case "assign_leads":
                caller_ids = params.get("caller_ids", [])
                count = params.get("count_per_caller", 1000)
                if not caller_ids:
                    caller_ids = [user["id"]]
                return store.auto_assign_lists(caller_ids, count)

            case "unassign_leads":
                uid = params.get("user_id", user["id"])
                return store.unassign_leads(uid)

            case "requeue_stale":
                days = params.get("days", 10)
                return store.requeue_stale_leads(days_threshold=days)

            case "list_follow_ups":
                pending = params.get("pending_only", True)
                return {"follow_ups": store.list_follow_ups(pending_only=pending)}

            case "create_follow_up":
                return {"id": store.create_follow_up(
                    lead_id=params["lead_id"],
                    follow_up_type=params.get("type", "call_back"),
                    scheduled_at=params["scheduled_at"],
                    notes=params.get("notes"),
                )}

            case "source_quality":
                return {"sources": store.get_source_roi()}

            case "conversion_funnel":
                days = params.get("days", 30)
                return store.get_conversion_funnel(days_back=days)

            case "underwriting_reports":
                return {"reports": store.list_underwriting_reports(
                    status=params.get("status"),
                )}

            case "update_lead_status":
                return store.update_lead_status(
                    params["lead_id"], params["status"], params.get("reason", ""),
                )

            case _:
                return {"error": f"Unknown operation: {operation}"}

    def _get_state_snapshot(self) -> str:
        try:
            stats = self.store.get_pipeline_stats()
            assignments = self.store.get_assignment_stats()

            lines = ["Pipeline:"]
            if isinstance(stats, dict):
                for k, v in stats.items():
                    if isinstance(v, (int, float)):
                        lines.append(f"  {k}: {v}")
                    elif isinstance(v, list):
                        for item in v[:5]:
                            if isinstance(item, dict):
                                lines.append(f"  {item.get('status', '?')}: {item.get('count', '?')}")

            if assignments:
                lines.append("Assignments:")
                for a in assignments:
                    lines.append(
                        f"  {a.get('caller_name', '?')}: "
                        f"{a.get('total_assigned', 0)} assigned, "
                        f"{a.get('remaining', 0)} remaining"
                    )

            users = []
            with self.store._connect() as conn:
                rows = conn.execute(
                    "SELECT id, display_name, role FROM users WHERE active = 1"
                ).fetchall()
                users = [dict(r) for r in rows]
            lines.append("Users:")
            for u in users:
                lines.append(f"  id={u['id']} name={u['display_name']} role={u['role']}")

            return "\n".join(lines)
        except Exception as e:
            return f"Error getting state: {e}"
