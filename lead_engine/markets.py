"""Market selector — evaluates metro areas for wholesaling viability.

Scoring criteria:
  - Median home price in the ARV sweet spot ($80k-$300k)
  - Population growth / demand indicators
  - Investor-friendly state regulations (no blocked states)
  - Existing lead volume from our sources
  - Code violation portal availability (free autonomous data)
"""

from __future__ import annotations

from dataclasses import dataclass, asdict
from typing import Any

from .config import BLOCKED_STATES, HIGH_FRICTION_STATES


@dataclass
class Market:
    metro: str
    state: str
    counties: list[str]
    median_price: int
    population: int
    cash_buyer_pct: float
    has_code_portal: bool
    portal_id: str | None = None
    notes: str = ""

    def score(self) -> int:
        s = 0

        if self.state in BLOCKED_STATES:
            return 0

        if 80_000 <= self.median_price <= 180_000:
            s += 30
        elif 180_000 < self.median_price <= 300_000:
            s += 20
        elif 300_000 < self.median_price <= 400_000:
            s += 10

        if self.cash_buyer_pct >= 0.30:
            s += 25
        elif self.cash_buyer_pct >= 0.20:
            s += 15
        elif self.cash_buyer_pct >= 0.10:
            s += 8

        if self.population >= 1_000_000:
            s += 15
        elif self.population >= 500_000:
            s += 10
        elif self.population >= 200_000:
            s += 5

        if self.has_code_portal:
            s += 15

        if self.state in HIGH_FRICTION_STATES:
            s -= 10

        return max(s, 0)

    def to_dict(self) -> dict[str, Any]:
        d = asdict(self)
        d["score"] = self.score()
        d["blocked"] = self.state in BLOCKED_STATES
        d["high_friction"] = self.state in HIGH_FRICTION_STATES
        return d


MARKETS: list[Market] = [
    Market(
        metro="Cincinnati", state="OH", counties=["Hamilton", "Butler", "Warren"],
        median_price=210_000, population=2_250_000, cash_buyer_pct=0.28,
        has_code_portal=True, portal_id="cincinnati_oh",
        notes="Strong Socrata portal, high violation volume",
    ),
    Market(
        metro="Cleveland", state="OH", counties=["Cuyahoga", "Lake", "Lorain"],
        median_price=130_000, population=2_050_000, cash_buyer_pct=0.35,
        has_code_portal=True, portal_id="cleveland_oh",
        notes="Very affordable, high cash buyer %, ArcGIS portal",
    ),
    Market(
        metro="Fort Worth", state="TX", counties=["Tarrant", "Parker", "Johnson"],
        median_price=290_000, population=2_500_000, cash_buyer_pct=0.22,
        has_code_portal=True, portal_id="fort_worth_tx",
        notes="Growing market, ArcGIS portal with open data",
    ),
    Market(
        metro="Austin", state="TX", counties=["Travis", "Williamson", "Hays"],
        median_price=420_000, population=2_350_000, cash_buyer_pct=0.18,
        has_code_portal=True, portal_id="austin_tx",
        notes="Higher prices but strong growth, Socrata portal",
    ),
    Market(
        metro="Dallas", state="TX", counties=["Dallas", "Collin", "Denton"],
        median_price=310_000, population=7_600_000, cash_buyer_pct=0.24,
        has_code_portal=False,
        notes="Largest TX metro, no active code violation portal",
    ),
    Market(
        metro="Houston", state="TX", counties=["Harris", "Fort Bend", "Montgomery"],
        median_price=260_000, population=7_100_000, cash_buyer_pct=0.26,
        has_code_portal=False,
        notes="Massive market, potential Socrata portal (needs research)",
    ),
    Market(
        metro="San Antonio", state="TX", counties=["Bexar", "Comal", "Guadalupe"],
        median_price=240_000, population=2_600_000, cash_buyer_pct=0.25,
        has_code_portal=False,
        notes="Affordable TX metro, good price point",
    ),
    Market(
        metro="Columbus", state="OH", counties=["Franklin", "Delaware", "Licking"],
        median_price=230_000, population=2_150_000, cash_buyer_pct=0.23,
        has_code_portal=False,
        notes="Steady growth, investor-friendly state",
    ),
    Market(
        metro="Jacksonville", state="FL", counties=["Duval", "St. Johns", "Clay"],
        median_price=280_000, population=1_650_000, cash_buyer_pct=0.30,
        has_code_portal=False,
        notes="High cash buyer %, no state income tax",
    ),
    Market(
        metro="Memphis", state="TN", counties=["Shelby"],
        median_price=150_000, population=1_350_000, cash_buyer_pct=0.32,
        has_code_portal=False,
        notes="Very affordable, high cash buyers, but TN is high-friction",
    ),
    Market(
        metro="Atlanta", state="GA", counties=["Fulton", "DeKalb", "Gwinnett", "Cobb"],
        median_price=310_000, population=6_100_000, cash_buyer_pct=0.24,
        has_code_portal=False,
        notes="Large metro, strong investor community",
    ),
    Market(
        metro="Tampa", state="FL", counties=["Hillsborough", "Pinellas", "Pasco"],
        median_price=320_000, population=3_300_000, cash_buyer_pct=0.28,
        has_code_portal=False,
        notes="Hot FL market, good cash buyer presence",
    ),
    Market(
        metro="Kansas City", state="MO", counties=["Jackson", "Clay", "Platte"],
        median_price=220_000, population=2_200_000, cash_buyer_pct=0.27,
        has_code_portal=False,
        notes="Affordable, strong rental market",
    ),
    Market(
        metro="Detroit", state="MI", counties=["Wayne", "Oakland", "Macomb"],
        median_price=120_000, population=4_300_000, cash_buyer_pct=0.38,
        has_code_portal=False,
        notes="Ultra-affordable, highest cash buyer % — check for portal",
    ),
    Market(
        metro="Birmingham", state="AL", counties=["Jefferson", "Shelby"],
        median_price=170_000, population=1_150_000, cash_buyer_pct=0.30,
        has_code_portal=False,
        notes="Low prices, high cash buyers, investor-friendly",
    ),
]


def get_ranked_markets() -> list[dict[str, Any]]:
    ranked = sorted(MARKETS, key=lambda m: m.score(), reverse=True)
    return [m.to_dict() for m in ranked if not m.to_dict()["blocked"]]


def get_markets_with_portals() -> list[dict[str, Any]]:
    return [m.to_dict() for m in MARKETS if m.has_code_portal]
