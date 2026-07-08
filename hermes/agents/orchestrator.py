"""Agent orchestrator — schedules and runs agents."""

from __future__ import annotations

import re
import threading
import time
from datetime import datetime, timedelta, timezone
from typing import TYPE_CHECKING, Any

from .proxy_client import ClaudeProxyClient

if TYPE_CHECKING:
    from ..store import HermesStore
    from ..server import HermesRuntime

_running_agents: dict[str, threading.Thread] = {}
_running_lock = threading.Lock()

AGENT_TYPES = ["scout", "dispatcher", "analyst", "operator", "supervisor"]


def _parse_schedule(schedule: str) -> timedelta | None:
    m = re.match(r"every\s+(\d+)\s*(h|m|hr|min|hour|minute)s?", schedule, re.I)
    if m:
        val = int(m.group(1))
        unit = m.group(2).lower()
        if unit.startswith("h"):
            return timedelta(hours=val)
        return timedelta(minutes=val)
    return None


class AgentOrchestrator:
    def __init__(self, store: HermesStore, runtime: HermesRuntime,
                 proxy_url: str = "http://127.0.0.1:8766"):
        self.store = store
        self.runtime = runtime
        self.proxy = ClaudeProxyClient(proxy_url)
        self._scheduler_thread: threading.Thread | None = None
        self._stop_event = threading.Event()

    def start_scheduler(self) -> None:
        if self._scheduler_thread and self._scheduler_thread.is_alive():
            return
        self._stop_event.clear()
        self._scheduler_thread = threading.Thread(target=self._scheduler_loop, daemon=True)
        self._scheduler_thread.start()

    def stop_scheduler(self) -> None:
        self._stop_event.set()

    def _scheduler_loop(self) -> None:
        while not self._stop_event.is_set():
            try:
                self._check_schedules()
            except Exception:
                pass
            self._stop_event.wait(60)

    def _check_schedules(self) -> None:
        agents = self.store.list_agent_definitions()
        now = datetime.now(timezone.utc)

        for agent in agents:
            if not agent.get("enabled"):
                continue
            agent_type = agent["agent_type"]
            schedule = agent.get("schedule", "manual")
            if schedule == "manual":
                continue

            interval = _parse_schedule(schedule)
            if not interval:
                continue

            last_run_at = agent.get("last_run_at")
            if last_run_at:
                try:
                    last = datetime.fromisoformat(last_run_at.replace("Z", "+00:00"))
                    if not last.tzinfo:
                        last = last.replace(tzinfo=timezone.utc)
                    if now - last < interval:
                        continue
                except (ValueError, TypeError):
                    pass

            with _running_lock:
                if agent_type in _running_agents and _running_agents[agent_type].is_alive():
                    continue

            self.run_agent(agent_type)

    def run_agent(self, agent_type: str) -> dict[str, Any]:
        with _running_lock:
            if agent_type in _running_agents and _running_agents[agent_type].is_alive():
                return {"error": f"{agent_type} is already running"}

        agent = self._create_agent(agent_type)
        if agent is None:
            return {"error": f"Unknown agent type: {agent_type}"}

        def _run() -> None:
            try:
                agent.start()
            except Exception:
                pass
            finally:
                with _running_lock:
                    _running_agents.pop(agent_type, None)

        t = threading.Thread(target=_run, daemon=True)
        with _running_lock:
            _running_agents[agent_type] = t
        t.start()

        return {"run_id": agent.run_id, "agent_type": agent_type, "status": "started"}

    def stop_agent(self, agent_type: str) -> dict[str, Any]:
        with _running_lock:
            t = _running_agents.get(agent_type)
            if t and t.is_alive():
                return {"status": "cannot_stop", "note": "Agent threads cannot be interrupted; wait for completion"}
        return {"status": "not_running"}

    def is_running(self, agent_type: str) -> bool:
        with _running_lock:
            t = _running_agents.get(agent_type)
            return t is not None and t.is_alive()

    def get_status(self) -> dict[str, Any]:
        with _running_lock:
            running = {k: v.is_alive() for k, v in _running_agents.items()}
        return {
            "scheduler_active": self._scheduler_thread is not None and self._scheduler_thread.is_alive(),
            "running_agents": running,
            "proxy": self.proxy.health(),
        }

    def _create_agent(self, agent_type: str) -> Any:
        if agent_type == "scout":
            from .scout import ScoutAgent
            return ScoutAgent(self.store, self.proxy, self.runtime)
        elif agent_type == "dispatcher":
            from .dispatcher import DispatcherAgent
            return DispatcherAgent(self.store, self.proxy, self.runtime)
        elif agent_type == "analyst":
            from .analyst import AnalystAgent
            return AnalystAgent(self.store, self.proxy, self.runtime)
        elif agent_type == "operator":
            from .operator import OperatorAgent
            return OperatorAgent(self.store, self.proxy, self.runtime)
        elif agent_type == "supervisor":
            from .supervisor import SupervisorAgent
            return SupervisorAgent(self.store, self.proxy, self.runtime)
        return None
