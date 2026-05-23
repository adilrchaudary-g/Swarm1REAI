"""County catalog — loads US county seed data and provides scoring + queue logic."""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from .config import BLOCKED_STATES, HIGH_FRICTION_STATES

_DATA_PATH = Path(__file__).parent / "data" / "us_counties.json"


@dataclass
class CountyRecord:
    fips: str
    county: str
    state: str
    population: int = 0
    median_home_value: int = 0
    search_term: str = ""

    scouted_at: str | None = None
    pre_foreclosure_count: int | None = None
    tax_delinquent_count: int | None = None
    probate_count: int | None = None
    vacant_sfr_count: int | None = None
    total_distressed: int | None = None

    last_harvested_at: str | None = None
    harvest_count: int = 0
    leads_generated: int = 0

    @property
    def regulatory_tier(self) -> str:
        if self.state in BLOCKED_STATES:
            return "blocked"
        if self.state in HIGH_FRICTION_STATES:
            return "high_friction"
        return "green"

    def static_score(self) -> int:
        if self.state in BLOCKED_STATES:
            return 0
        s = 0
        p = self.median_home_value
        if 80_000 <= p <= 180_000:
            s += 30
        elif 180_000 < p <= 300_000:
            s += 20
        elif 300_000 < p <= 400_000:
            s += 10

        pop = self.population
        if pop >= 500_000:
            s += 15
        elif pop >= 200_000:
            s += 10
        elif pop >= 100_000:
            s += 5

        if self.state in HIGH_FRICTION_STATES:
            s -= 10

        return max(s, 0)

    def scouted_score(self) -> int:
        if self.state in BLOCKED_STATES:
            return 0
        s = 0

        total = self.total_distressed or 0
        if total >= 500:
            s += 35
        elif total >= 200:
            s += 25
        elif total >= 100:
            s += 15
        elif total >= 50:
            s += 8

        p = self.median_home_value
        if 80_000 <= p <= 180_000:
            s += 25
        elif 180_000 < p <= 300_000:
            s += 20
        elif 300_000 < p <= 400_000:
            s += 10

        pop = self.population
        if pop >= 500_000:
            s += 15
        elif pop >= 200_000:
            s += 10
        elif pop >= 100_000:
            s += 5

        signals = [self.pre_foreclosure_count, self.tax_delinquent_count, self.probate_count]
        signals_present = sum(1 for c in signals if c and c > 20)
        s += signals_present * 3

        if self.state in HIGH_FRICTION_STATES:
            s -= 10

        return max(s, 0)

    def to_dict(self) -> dict[str, Any]:
        return {
            "fips": self.fips,
            "county": self.county,
            "state": self.state,
            "population": self.population,
            "median_home_value": self.median_home_value,
            "search_term": self.search_term,
            "regulatory_tier": self.regulatory_tier,
            "static_score": self.static_score(),
            "scouted_at": self.scouted_at,
            "pre_foreclosure_count": self.pre_foreclosure_count,
            "tax_delinquent_count": self.tax_delinquent_count,
            "probate_count": self.probate_count,
            "vacant_sfr_count": self.vacant_sfr_count,
            "total_distressed": self.total_distressed,
            "scouted_score": self.scouted_score() if self.scouted_at else None,
            "last_harvested_at": self.last_harvested_at,
            "harvest_count": self.harvest_count,
            "leads_generated": self.leads_generated,
        }


def load_counties() -> list[CountyRecord]:
    with open(_DATA_PATH) as f:
        raw = json.load(f)
    return [
        CountyRecord(
            fips=r["fips"],
            county=r["county"],
            state=r["state"],
            population=r.get("population", 0),
            median_home_value=r.get("median_home_value", 0),
            search_term=r.get("search_term", f"{r['county']} {r['state']}"),
        )
        for r in raw
    ]


def load_eligible_counties() -> list[CountyRecord]:
    return [c for c in load_counties() if c.regulatory_tier != "blocked"]


def get_scout_queue(already_scouted: set[str] | None = None) -> list[CountyRecord]:
    scouted = already_scouted or set()
    eligible = [c for c in load_eligible_counties() if c.fips not in scouted]
    return sorted(eligible, key=lambda c: c.static_score(), reverse=True)
