"""Base class for all swarm agents."""

from __future__ import annotations

import json
import uuid
from abc import ABC, abstractmethod
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from ..store import HermesStore
    from ..server import HermesRuntime
    from .proxy_client import ClaudeProxyClient


class BaseAgent(ABC):
    agent_type: str = ""

    def __init__(self, store: HermesStore, proxy: ClaudeProxyClient,
                 runtime: HermesRuntime | None = None):
        self.store = store
        self.proxy = proxy
        self.runtime = runtime
        self.run_id = f"{self.agent_type}-{uuid.uuid4().hex[:8]}"
        self.ai_available = False
        self._ai_calls = 0
        self._proposals_created = 0
        self._leads_scanned = 0

    def start(self) -> str:
        self.store.create_agent_run(self.run_id, self.agent_type)
        self.ai_available = self.proxy.is_available()
        mode = "AI-enhanced" if self.ai_available else "rules-only"
        self.log(f"Starting {self.agent_type} in {mode} mode")
        self.store.update_agent_run(self.run_id, ai_available=self.ai_available)

        try:
            self.execute()
            self.store.update_agent_run(
                self.run_id,
                status="completed",
                phase="complete",
                leads_scanned=self._leads_scanned,
                proposals_created=self._proposals_created,
                ai_calls_made=self._ai_calls,
                result={
                    "leads_scanned": self._leads_scanned,
                    "proposals_created": self._proposals_created,
                    "ai_calls": self._ai_calls,
                    "ai_available": self.ai_available,
                },
            )
            self.log(f"Completed: scanned {self._leads_scanned}, created {self._proposals_created} proposals")
        except Exception as e:
            self.store.update_agent_run(
                self.run_id, status="failed", phase="error", error=str(e)
            )
            self.log(f"Failed: {e}")
            raise

        return self.run_id

    @abstractmethod
    def execute(self) -> None:
        ...

    def log(self, message: str) -> None:
        self.store.update_agent_run(self.run_id, log_line=message)

    def create_proposal(self, *, title: str, description: str | None = None,
                        payload: dict, priority: str = "medium") -> int:
        pid = self.store.create_proposal(
            agent_type=self.agent_type,
            run_id=self.run_id,
            title=title,
            description=description,
            payload=payload,
            priority=priority,
        )
        self._proposals_created += 1
        return pid

    def call_claude(self, prompt: str, system: str | None = None) -> str | None:
        if not self.ai_available:
            return None
        self._ai_calls += 1
        return self.proxy.prompt(prompt, system=system)

    def get_leads(self, *, status: str | None = None, statuses: list[str] | None = None,
                  limit: int = 100) -> list[dict[str, Any]]:
        with self.store._connect() as conn:
            where, params = [], []
            if status:
                where.append("l.status = ?"); params.append(status)
            elif statuses:
                placeholders = ",".join("?" * len(statuses))
                where.append(f"l.status IN ({placeholders})")
                params.extend(statuses)
            clause = f"WHERE {' AND '.join(where)}" if where else ""
            params.append(limit)
            rows = conn.execute(f"""
                SELECT l.*, p.address_full, p.address_city, p.address_state, p.address_zip,
                       o.owner_name
                FROM leads l
                LEFT JOIN properties p ON p.property_id = l.property_id
                LEFT JOIN owners o ON o.owner_id = l.owner_id
                {clause}
                ORDER BY l.updated_at DESC
                LIMIT ?
            """, params).fetchall()
            self._leads_scanned += len(rows)
            return [dict(r) for r in rows]

    def query(self, sql: str, params: list | tuple = ()) -> list[dict[str, Any]]:
        with self.store._connect() as conn:
            rows = conn.execute(sql, params).fetchall()
            return [dict(r) for r in rows]

    def query_one(self, sql: str, params: list | tuple = ()) -> dict[str, Any] | None:
        with self.store._connect() as conn:
            row = conn.execute(sql, params).fetchone()
            return dict(row) if row else None
