from .config import PERSONA_TIER_ADJUSTMENTS


def _classify_tired_landlord(lead: dict) -> float:
    score = 0.0
    if lead.get("owner_occupied") is False:
        score += 0.35
    if lead.get("mailing_distance") in ("out-of-state", "in-state-different-zip"):
        score += 0.20
    years = lead.get("years_owned")
    if years is not None and years >= 3:
        score += 0.20
    if lead.get("owner_type") == "individual":
        score += 0.15
    signals = lead.get("distress_signals", [])
    if "tax_delinquent" in signals:
        score += 0.10
    if "eviction_filed" in signals:
        score += 0.10
    return min(score, 1.0)


def _classify_probate_heir(lead: dict) -> float:
    score = 0.0
    if lead.get("source_list") == "probate" or "probate" in (lead.get("source_lists") or []):
        score += 0.60
    if lead.get("owner_type") == "estate":
        score += 0.30
    if "probate_filed" in lead.get("distress_signals", []):
        score += 0.10
    return min(score, 1.0)


def _classify_pre_foreclosure(lead: dict) -> float:
    score = 0.0
    if lead.get("source_list") == "pre-foreclosure" or "pre-foreclosure" in (lead.get("source_lists") or []):
        score += 0.50
    if "nod_filed" in lead.get("distress_signals", []):
        score += 0.20
    ff = (lead.get("foreclosure_factor") or "").lower()
    if "very high" in ff:
        score += 0.20
    elif "high" in ff:
        score += 0.10
    return min(score, 1.0)


def _classify_tired_homeowner(lead: dict) -> float:
    score = 0.0
    if lead.get("owner_occupied") is True:
        score += 0.30
    years = lead.get("years_owned")
    if years is not None and years >= 10:
        score += 0.30
    signals = lead.get("distress_signals", [])
    if not any(s in signals for s in ("nod_filed", "probate_filed", "tax_delinquent")):
        score += 0.20
    if lead.get("owner_type") == "individual":
        score += 0.10
    return min(score, 1.0)


def _classify_vacant_distant(lead: dict) -> float:
    score = 0.0
    if lead.get("owner_occupied") is False:
        score += 0.30
    if lead.get("mailing_distance") == "out-of-state":
        score += 0.40
    elif lead.get("mailing_distance") == "in-state-different-zip":
        score += 0.20
    years = lead.get("years_owned")
    if years is not None and years >= 5:
        score += 0.15
    if "water_shutoff" in lead.get("distress_signals", []):
        score += 0.15
    return min(score, 1.0)


def _classify_code_violation(lead: dict) -> float:
    score = 0.0
    signals = lead.get("distress_signals", [])
    if "code_violation" in signals:
        score += 0.50
    for cond_key in ("total_condition", "exterior_condition", "interior_condition"):
        cond = (lead.get(cond_key) or "").lower()
        if "poor" in cond or "unsound" in cond:
            score += 0.25
        elif "fair" in cond:
            score += 0.10
    if len(signals) >= 2:
        score += 0.15
    return min(score, 1.0)


CLASSIFIERS = {
    "Pre-Foreclosure": _classify_pre_foreclosure,
    "Probate Heir": _classify_probate_heir,
    "Tired Landlord": _classify_tired_landlord,
    "Tired Homeowner": _classify_tired_homeowner,
    "Vacant/Distant Absentee": _classify_vacant_distant,
    "Code Violation": _classify_code_violation,
}


def classify_lead(lead: dict) -> dict:
    scores = {}
    for name, fn in CLASSIFIERS.items():
        scores[name] = round(fn(lead), 3)

    total = sum(scores.values()) or 1.0
    normalized = {k: round(v / total, 3) for k, v in scores.items()}

    lead["persona_scores"] = normalized
    lead["persona_primary"] = max(normalized, key=normalized.get)
    lead["persona_confidence"] = normalized[lead["persona_primary"]]
    return lead


def run_classify(leads: list[dict]) -> list[dict]:
    persona_counts = {}
    for lead in leads:
        classify_lead(lead)
        p = lead["persona_primary"]
        persona_counts[p] = persona_counts.get(p, 0) + 1

    parts = [f"{count} {name.lower()}" for name, count in sorted(persona_counts.items(), key=lambda x: -x[1])]
    print(f"CLASSIFY {' | '.join(parts)}")
    return leads
