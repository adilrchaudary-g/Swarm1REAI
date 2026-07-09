"""Mega Agent Orchestrator — routes user messages to the right agent."""

from __future__ import annotations

import json
import re
from typing import TYPE_CHECKING, Any

from .proxy_client import ClaudeProxyClient
from .lead_manager_agent import LeadManagerAgent
from .dashboard_analyst_agent import DashboardAnalystAgent

if TYPE_CHECKING:
    from ..store import HermesStore
    from ..server import HermesRuntime

LEAD_MANAGER_KEYWORDS = [
    "lead", "assign", "unassign", "queue", "skip", "trace", "scrape", "source",
    "follow-up", "follow up", "followup", "underwrite", "underwriting", "offer",
    "deal", "enrich", "pipeline", "callback", "requeue", "re-queue",
    "give me", "give callers", "give my callers", "how many leads",
    "funnel", "scored", "queued", "contacted", "interested",
]

ANALYST_KEYWORDS = [
    "kpi", "calls", "performance", "digest", "clean", "duplicate", "metric",
    "activity", "integrity", "streak", "conversion", "how many calls",
    "dialing", "dials", "brayden", "jalen", "jaylen", "caller",
    "today", "this week", "report", "briefing", "health",
    "hours", "billable", "trust score",
]


class MegaOrchestrator:
    def __init__(self, store: HermesStore, runtime: HermesRuntime | None,
                 proxy_url: str = "http://127.0.0.1:8766"):
        self.store = store
        self.runtime = runtime
        self.proxy = ClaudeProxyClient(proxy_url)
        self.lead_manager = LeadManagerAgent(store, runtime, self.proxy)
        self.analyst = DashboardAnalystAgent(store, runtime, self.proxy)

    def handle_message(self, message: str, user: dict,
                       conversation_id: int | None = None) -> dict:
        if conversation_id is None:
            conversation_id = self.store.create_conversation(
                user["id"], title=message[:80],
            )

        self.store.add_conversation_message(
            conversation_id, role="user", content=message,
        )

        context = self.store.get_conversation_messages(conversation_id, limit=20)

        agent_type = self._route(message, context)
        agent = self.lead_manager if agent_type == "lead_manager" else self.analyst

        response = agent.handle(message, context, user, conversation_id)

        metadata = {}
        if response.actions_taken:
            metadata["actions_taken"] = response.actions_taken
        if response.confirmation:
            metadata["confirmation"] = response.confirmation
        if response.data:
            metadata["data"] = response.data

        self.store.add_conversation_message(
            conversation_id,
            role="agent",
            agent_type=agent_type,
            content=response.content,
            metadata=metadata if metadata else None,
        )

        result: dict[str, Any] = {
            "conversation_id": conversation_id,
            "agent_type": agent_type,
            "content": response.content,
        }
        if response.actions_taken:
            result["actions_taken"] = response.actions_taken
        if response.confirmation:
            result["confirmation"] = response.confirmation
        if response.data:
            result["data"] = response.data
        return result

    def handle_confirmation(self, confirmation_id: int, confirmed: bool,
                            user: dict) -> dict:
        pending = self.store.get_pending_confirmation(confirmation_id)
        if not pending:
            return {"error": "No pending confirmation found"}

        conversation_id = pending["conversation_id"]

        if not confirmed:
            self.store.resolve_pending_confirmation(confirmation_id, "cancelled")
            self.store.add_conversation_message(
                conversation_id, role="agent", agent_type=pending["agent_type"],
                content="Action cancelled.",
                metadata={"cancelled": True, "action": pending["action"]},
            )
            return {"status": "cancelled", "conversation_id": conversation_id}

        agent_type = pending["agent_type"]
        agent = self.lead_manager if agent_type == "lead_manager" else self.analyst

        try:
            result = agent.execute_operation(pending["action"], pending["params"], user)
            self.store.resolve_pending_confirmation(confirmation_id, "confirmed")
            self.store.add_conversation_message(
                conversation_id, role="agent", agent_type=agent_type,
                content=f"Confirmed. Action executed: {pending['description']}",
                metadata={"confirmed": True, "action": pending["action"], "result": result},
            )
            return {
                "status": "confirmed",
                "conversation_id": conversation_id,
                "result": result,
            }
        except Exception as e:
            self.store.resolve_pending_confirmation(confirmation_id, "failed")
            self.store.add_conversation_message(
                conversation_id, role="agent", agent_type=agent_type,
                content=f"Action failed: {e}",
                metadata={"error": str(e), "action": pending["action"]},
            )
            return {"status": "error", "error": str(e)}

    def _route(self, message: str, context: list[dict]) -> str:
        # Try Claude-based routing first
        if self.proxy.is_available():
            agent_type = self._route_with_ai(message)
            if agent_type:
                return agent_type

        return self._route_with_keywords(message)

    def _route_with_ai(self, message: str) -> str | None:
        prompt = f"""Classify this user request for a real estate wholesaling CRM.

LEAD_MANAGER: lead counts, assignment, skip-tracing, source management, queue, scraping, follow-ups, underwriting, deal progression, pipeline stats
ANALYST: KPIs, caller performance, activity tracking, data cleanup, digests, metrics, duplicates, call volume, integrity checks

User request: "{message}"

Return ONLY one word: LEAD_MANAGER or ANALYST"""

        result = self.proxy.prompt(prompt)
        if result:
            result = result.strip().upper()
            if "LEAD_MANAGER" in result:
                return "lead_manager"
            if "ANALYST" in result:
                return "analyst"
        return None

    def _route_with_keywords(self, message: str) -> str:
        msg = message.lower()

        lead_score = sum(1 for kw in LEAD_MANAGER_KEYWORDS if kw in msg)
        analyst_score = sum(1 for kw in ANALYST_KEYWORDS if kw in msg)

        if lead_score > analyst_score:
            return "lead_manager"
        if analyst_score > lead_score:
            return "analyst"

        return "lead_manager"
