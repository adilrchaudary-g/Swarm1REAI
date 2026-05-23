import os
from pathlib import Path

SWARM_ROOT = Path(os.environ.get(
    "SWARM_ROOT",
    os.path.join(os.path.expanduser("~"), "Desktop", "wholesaling-swarm"),
))

LEAD_VAULT = SWARM_ROOT / "lead-vault"
ACQUISITION_DIR = LEAD_VAULT / "acquisition"
PROPSTREAM_ACQUISITION_DIR = ACQUISITION_DIR / "propstream"
PIPELINE_DIR = LEAD_VAULT / "pipeline"
HERMES_DB = SWARM_ROOT / "hermes" / "data" / "propstream.db"

LANE = "houses"

SCORE_WEIGHTS = {
    "distress_urgency": 0.35,
    "financial_pressure": 0.25,
    "life_event": 0.15,
    "engagement": 0.15,
    "condition": 0.10,
}

CONDITION_FLOOR = 50

TIER_THRESHOLDS = {
    "HOT": 80,
    "WARM": 60,
    "LUKEWARM": 40,
    "COLD": 20,
    "ICE": 0,
}

PERSONA_TIER_ADJUSTMENTS = {
    "Pre-Foreclosure": -10,
    "Probate Heir": -10,
    "Vacant/Distant Absentee": -5,
    "Tired Landlord": 0,
    "Tired Homeowner": 0,
    "Code Violation": 0,
}

ARV_MIN = 80_000
ARV_MAX = 500_000
MIN_SPREAD = 20_000
DISCOUNT_FACTOR = 0.70
ASSIGNMENT_FEE = 25_000

BLOCKED_STATES = {"SC", "IL", "OK", "KY", "PA", "VA", "NC", "NE", "NY"}
HIGH_FRICTION_STATES = {"CT", "OR", "MD", "AZ", "CA", "IA", "TN", "IN", "WI", "ND", "AL", "OH"}
HIGH_FRICTION_PENALTY = -30

SIGNAL_MAP = {
    "pre-foreclosure": "nod_filed",
    "tax-delinquent": "tax_delinquent",
    "probate": "probate_filed",
    "code-violations": "code_violation",
    "foreclosure": "nod_filed",
    "eviction": "eviction_filed",
    "water-shutoff": "water_shutoff",
    "fsbo": "fsbo_stale",
}

DATA_QUALITY_TIERS = ["MINIMAL", "VARIABLE", "PARTIAL", "MODERATE", "FULL"]

PERSONA_URGENCY_ORDER = [
    "Pre-Foreclosure",
    "Probate Heir",
    "Tired Landlord",
    "Vacant/Distant Absentee",
    "Tired Homeowner",
    "Code Violation",
]


DEFAULT_TOP_N = 2000
