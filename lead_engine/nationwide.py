"""Nationwide orchestrator — dynamic county selection for scout and harvest cycles."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, TYPE_CHECKING

if TYPE_CHECKING:
    from hermes.store import HermesRuntime


class NationwideOrchestrator:
    def __init__(self, store: Any) -> None:
        self.store = store

    def seed_if_needed(self) -> dict[str, int] | None:
        stats = self.store.county_scouting_stats()
        if stats["total"] > 0:
            return None
        seed_path = Path(__file__).parent / "data" / "us_counties.json"
        if not seed_path.exists():
            return None
        counties = json.loads(seed_path.read_text())
        return self.store.seed_counties(counties)

    def get_scout_batch(self, batch_size: int = 50) -> list[dict[str, Any]]:
        return self.store.get_scout_queue(batch_size=batch_size)

    def get_harvest_batch(self, batch_size: int = 10) -> list[dict[str, Any]]:
        return self.store.get_harvest_queue(batch_size=batch_size)

    def get_harvest_county_string(self, batch_size: int = 10) -> str:
        queue = self.get_harvest_batch(batch_size)
        return "|".join(c["search_term"] for c in queue)

    def record_harvest_results(self, fips: str, leads_created: int = 0) -> None:
        self.store.record_harvest(fips, leads_created)

    def stats(self) -> dict[str, Any]:
        return self.store.county_scouting_stats()
