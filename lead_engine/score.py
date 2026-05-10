from .config import SCORE_WEIGHTS, CONDITION_FLOOR, TIER_THRESHOLDS, PERSONA_TIER_ADJUSTMENTS


def _distress_urgency(lead: dict) -> int:
    signals = lead.get("distress_signals", [])
    base = 20
    if "nod_filed" in signals:
        base = max(base, 80)
    if "tax_delinquent" in signals:
        base = max(base, 85)
    if "probate_filed" in signals:
        base = max(base, 75)
    if "mls_expired" in signals:
        base = max(base, 50)
    if "mls_withdrawn" in signals:
        base = max(base, 45)
    if "code_violation" in signals:
        base = max(base, 65)
    if "water_shutoff" in signals:
        base = max(base, 70)
    if "eviction_filed" in signals:
        base = max(base, 60)
    if "fsbo_stale" in signals:
        base = max(base, 45)
    if "fsbo_price_reduced" in signals:
        base = max(base, 55)

    ff = (lead.get("foreclosure_factor") or "").lower()
    if "very high" in ff:
        base = min(100, base + 15)
    elif "high" in ff:
        base = min(100, base + 10)

    return min(base, 100)


def _financial_pressure(lead: dict) -> int:
    est_value = lead.get("est_value") or 0
    est_equity = lead.get("est_equity") or 0
    ltv = lead.get("est_ltv") or 0
    balance = lead.get("est_remaining_balance") or 0
    lien = lead.get("lien_amount") or 0

    score = 30

    if est_value > 0:
        equity_pct = est_equity / est_value * 100
        if equity_pct > 60:
            score += 25
        elif equity_pct > 30:
            score += 15
        elif equity_pct > 0:
            score += 5

    if isinstance(ltv, (int, float)):
        if ltv > 90:
            score += 20
        elif ltv > 70:
            score += 10

    if lien and lien > 0:
        score += 15

    if balance and est_value and est_value > 0:
        if balance / est_value > 0.8:
            score += 10

    return min(score, 100)


def _life_event(lead: dict) -> int:
    signals = lead.get("distress_signals", [])
    if "probate_filed" in signals:
        return 70
    return 20


def _engagement(lead: dict) -> int:
    status = lead.get("status", "new")
    if status == "responded":
        return 70
    if status == "contacted":
        return 45
    return 10


def _condition_score(lead: dict) -> int:
    total = (lead.get("total_condition") or "").lower()
    if not total:
        return CONDITION_FLOOR

    condition_map = {
        "excellent": 20,
        "good": 30,
        "average": 45,
        "fair": 60,
        "poor": 80,
        "unsound": 95,
    }
    for label, val in condition_map.items():
        if label in total:
            return val
    return CONDITION_FLOOR


def score_lead(lead: dict) -> dict:
    components = {
        "distress_urgency": _distress_urgency(lead),
        "financial_pressure": _financial_pressure(lead),
        "life_event": _life_event(lead),
        "engagement": _engagement(lead),
        "condition": _condition_score(lead),
    }

    raw_score = sum(
        components[k] * SCORE_WEIGHTS[k]
        for k in SCORE_WEIGHTS
    )
    lead["motivation_score"] = round(raw_score)
    lead["motivation_components"] = components

    persona = lead.get("persona_primary", "")
    adjustment = PERSONA_TIER_ADJUSTMENTS.get(persona, 0)
    adjusted = lead["motivation_score"] - adjustment

    for tier, threshold in sorted(TIER_THRESHOLDS.items(), key=lambda x: -x[1]):
        if adjusted >= threshold:
            lead["motivation_tier"] = tier
            break
    else:
        lead["motivation_tier"] = "ICE"

    return lead


def run_score(leads: list[dict]) -> list[dict]:
    tier_counts = {}
    for lead in leads:
        score_lead(lead)
        t = lead["motivation_tier"]
        tier_counts[t] = tier_counts.get(t, 0) + 1

    order = ["HOT", "WARM", "LUKEWARM", "COLD", "ICE"]
    parts = [f"{t} {tier_counts.get(t, 0)}" for t in order if tier_counts.get(t, 0)]
    print(f"SCORE    {' | '.join(parts)}")
    return leads
