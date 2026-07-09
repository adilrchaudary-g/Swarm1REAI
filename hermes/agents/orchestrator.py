"""Agent orchestrator — legacy compatibility wrapper.

The old scheduled agents (scout, dispatcher, analyst, operator, supervisor) have been
replaced by the MegaOrchestrator conversational system. This file exists so the
/api/agents/* routes don't break.
"""

from __future__ import annotations

import threading
from typing import TYPE_CHECKING, Any

from .proxy_client import ClaudeProxyClient

if TYPE_CHECKING:
    from ..store import HermesStore
    from ..server import HermesRuntime

AGENT_TYPES = ["lead_manager", "analyst"]


class AgentOrchestrator:
    def __init__(self, store: HermesStore, runtime: HermesRuntime,
                 proxy_url: str = "http://127.0.0.1:8766"):
        self.store = store
        self.runtime = runtime
        self.proxy = ClaudeProxyClient(proxy_url)

    def start_scheduler(self) -> None:
        pass

    def stop_scheduler(self) -> None:
        pass

    def run_agent(self, agent_type: str) -> dict[str, Any]:
        return {"error": "Scheduled agents have been replaced by the Swarm AI chat system. Use the Chat tab instead."}

    def stop_agent(self, agent_type: str) -> dict[str, Any]:
        return {"status": "not_running"}

    def is_running(self, agent_type: str) -> bool:
        return False

    def get_status(self) -> dict[str, Any]:
        return {
            "scheduler_active": False,
            "running_agents": {},
            "proxy": self.proxy.health(),
            "note": "Scheduled agents replaced by Swarm AI chat system",
        }
