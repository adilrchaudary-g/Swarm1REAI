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
    # ── HOT TIER (scouted score 70+) ─────────────────────────
    Market(
        metro="Detroit", state="MI", counties=["Wayne", "Oakland", "Macomb"],
        median_price=175_000, population=4_300_000, cash_buyer_pct=0.38,
        has_code_portal=True, portal_id="detroit_mi",
        notes="Scouted: Wayne 644 + Macomb 358k distressed. Ultra-affordable, highest cash buyer %",
    ),
    Market(
        metro="Kansas City", state="MO", counties=["Jackson", "Clay", "Platte"],
        median_price=246_000, population=2_200_000, cash_buyer_pct=0.27,
        has_code_portal=True, portal_id="kansas_city_mo",
        notes="Scouted: Jackson 314k distressed. Strong rental market, code portal live",
    ),
    Market(
        metro="Houston", state="TX", counties=["Harris", "Fort Bend", "Montgomery"],
        median_price=281_000, population=7_100_000, cash_buyer_pct=0.26,
        has_code_portal=True, portal_id="chicago_il",
        notes="Scouted: Harris 1.6M pre-foreclosure. Largest distressed volume in nation",
    ),
    Market(
        metro="San Antonio", state="TX", counties=["Bexar", "Comal", "Guadalupe"],
        median_price=257_000, population=2_600_000, cash_buyer_pct=0.25,
        has_code_portal=False,
        notes="Scouted: Bexar 751k distressed. Massive pre-foreclosure pipeline",
    ),
    Market(
        metro="Jacksonville", state="FL", counties=["Duval", "St. Johns", "Clay"],
        median_price=293_000, population=1_650_000, cash_buyer_pct=0.30,
        has_code_portal=False,
        notes="Scouted: Duval 419k distressed. High cash buyer %, no state income tax",
    ),
    Market(
        metro="St. Louis", state="MO", counties=["St. Louis city", "St. Louis County"],
        median_price=177_000, population=1_269_000, cash_buyer_pct=0.27,
        has_code_portal=False,
        notes="Scouted: city 148k + county 29k distressed. Very affordable metro",
    ),
    Market(
        metro="Wichita", state="KS", counties=["Sedgwick"],
        median_price=223_000, population=528_000, cash_buyer_pct=0.25,
        has_code_portal=False,
        notes="Scouted: 26k distressed. Affordable Midwest, score 79",
    ),
    Market(
        metro="El Paso", state="TX", counties=["El Paso"],
        median_price=231_000, population=870_000, cash_buyer_pct=0.22,
        has_code_portal=False,
        notes="Scouted: 123k distressed. Heavy tax delinquent + probate signals",
    ),
    Market(
        metro="Macon", state="GA", counties=["Bibb"],
        median_price=168_000, population=157_000, cash_buyer_pct=0.28,
        has_code_portal=False,
        notes="Scouted: 74k distressed. Ultra-affordable, strong signals for size",
    ),
    Market(
        metro="Lakeland", state="FL", counties=["Polk"],
        median_price=298_000, population=818_000, cash_buyer_pct=0.28,
        has_code_portal=False,
        notes="Scouted: 7.9k distressed. Growing FL market, good price point",
    ),
    # ── EXISTING MARKETS (updated with scouted intel) ────────
    Market(
        metro="Cincinnati", state="OH", counties=["Hamilton", "Butler", "Warren"],
        median_price=210_000, population=2_250_000, cash_buyer_pct=0.28,
        has_code_portal=True, portal_id="cincinnati_oh",
        notes="Strong Socrata portal, high violation volume. OH now high-friction",
    ),
    Market(
        metro="Cleveland", state="OH", counties=["Cuyahoga", "Lake", "Lorain"],
        median_price=130_000, population=2_050_000, cash_buyer_pct=0.35,
        has_code_portal=True, portal_id="cleveland_oh",
        notes="Very affordable, high cash buyer %, ArcGIS portal. OH now high-friction",
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
        metro="Columbus", state="OH", counties=["Franklin", "Delaware", "Licking"],
        median_price=230_000, population=2_150_000, cash_buyer_pct=0.23,
        has_code_portal=False,
        notes="Steady growth. OH now high-friction",
    ),
    Market(
        metro="Memphis", state="TN", counties=["Shelby"],
        median_price=150_000, population=1_350_000, cash_buyer_pct=0.32,
        has_code_portal=False,
        notes="Very affordable, high cash buyers, TN is high-friction",
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
        metro="Montgomery", state="AL", counties=["Montgomery"],
        median_price=165_000, population=225_000, cash_buyer_pct=0.25,
        has_code_portal=False,
        notes="Scouted: 112k distressed. Affordable but AL is high-friction",
    ),
    Market(
        metro="Birmingham", state="AL", counties=["Jefferson", "Shelby"],
        median_price=170_000, population=1_150_000, cash_buyer_pct=0.30,
        has_code_portal=False,
        notes="Low prices, high cash buyers. AL is high-friction",
    ),
    # ── NEWLY DISCOVERED (scouted, need further evaluation) ──
    Market(
        metro="Shreveport", state="LA", counties=["Caddo"],
        median_price=141_000, population=226_000, cash_buyer_pct=0.25,
        has_code_portal=False,
        notes="Scouted: Caddo Parish awaiting results. Ultra-affordable LA market",
    ),
    Market(
        metro="Jackson", state="MS", counties=["Hinds"],
        median_price=133_000, population=215_000, cash_buyer_pct=0.28,
        has_code_portal=False,
        notes="Scouted: Hinds 5.9k distressed. Very affordable, good signals",
    ),
    Market(
        metro="Beaumont", state="TX", counties=["Jefferson"],
        median_price=169_000, population=251_000, cash_buyer_pct=0.24,
        has_code_portal=False,
        notes="Scouted: 31k distressed. Affordable TX coastal market",
    ),
    Market(
        metro="Charleston", state="WV", counties=["Kanawha"],
        median_price=151_000, population=175_000, cash_buyer_pct=0.26,
        has_code_portal=False,
        notes="Scouted: 30k distressed (25k tax delinquent, 5k probate). Affordable Appalachia",
    ),
    Market(
        metro="Hidalgo", state="TX", counties=["Hidalgo"],
        median_price=194_000, population=898_000, cash_buyer_pct=0.20,
        has_code_portal=False,
        notes="Scouted: 62k distressed. Large TX border metro, strong tax delinquent signal",
    ),
]


def get_ranked_markets() -> list[dict[str, Any]]:
    ranked = sorted(MARKETS, key=lambda m: m.score(), reverse=True)
    return [m.to_dict() for m in ranked if not m.to_dict()["blocked"]]


def get_markets_with_portals() -> list[dict[str, Any]]:
    return [m.to_dict() for m in MARKETS if m.has_code_portal]
