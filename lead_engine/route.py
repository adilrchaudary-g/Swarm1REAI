from .config import ARV_MIN, ARV_MAX, MIN_SPREAD, DISCOUNT_FACTOR, BLOCKED_STATES, HIGH_FRICTION_STATES, HIGH_FRICTION_PENALTY


def route_lead(lead: dict) -> dict:
    gates = []
    failures = []
    quality = lead.get("data_quality_tier", "FULL")
    is_partial = quality in ("PARTIAL", "MINIMAL", "VARIABLE")

    if lead.get("has_cell"):
        gates.append("cell_phone")
    elif is_partial:
        failures.append("no_cell_phone=needs_skip_trace")
    else:
        failures.append("no_cell_phone")

    pt = (lead.get("property_type") or "").lower()
    if "single family" in pt:
        gates.append("sfr_detached")
    elif is_partial and not pt:
        failures.append("property_type=missing")
    else:
        failures.append(f"property_type={lead.get('property_type')}")

    arv = lead.get("est_value")
    if arv and ARV_MIN <= arv <= ARV_MAX:
        gates.append("arv_range")
    elif arv:
        failures.append(f"arv=${arv:,} outside ${ARV_MIN:,}-${ARV_MAX:,}")
    else:
        failures.append("arv=missing")

    if arv:
        balance = lead.get("est_remaining_balance") or 0
        spread = (arv * DISCOUNT_FACTOR) - balance - MIN_SPREAD
        if spread > 0:
            gates.append("spread_ok")
            lead["estimated_spread"] = round(spread)
        else:
            failures.append(f"spread=${round(spread):,} below $0")
    else:
        failures.append("spread=cannot_compute")

    if lead.get("litigator") is not True:
        gates.append("not_litigator")
    else:
        failures.append("litigator=yes")

    state = (lead.get("address_state") or "").upper()
    if state in BLOCKED_STATES:
        failures.append(f"blocked_state={state}")
        lead["router_decision"] = "dead"
        lead["router_reason"] = f"Blocked state: {state}"
        lead["gates_passed"] = gates
        lead["gates_failed"] = failures
        return lead

    if state in HIGH_FRICTION_STATES:
        lead["regulatory_flag"] = "high_friction"
        lead["regulatory_penalty"] = HIGH_FRICTION_PENALTY

    hard_fails = [f for f in failures if not any(tag in f for tag in ("missing", "cannot_compute", "needs_skip_trace"))]
    soft_fails = [f for f in failures if any(tag in f for tag in ("missing", "cannot_compute", "needs_skip_trace"))]

    if len(failures) == 0:
        lead["router_decision"] = "proceed"
        lead["router_reason"] = "All gates passed"
    elif is_partial and len(hard_fails) == 0:
        lead["router_decision"] = "review"
        lead["router_reason"] = f"Partial source, needs enrichment: {'; '.join(soft_fails)}"
    elif len(hard_fails) == 0 and soft_fails:
        lead["router_decision"] = "review"
        lead["router_reason"] = f"Missing data: {'; '.join(soft_fails)}"
    elif len(hard_fails) == 1 and any("spread" in f for f in hard_fails):
        lead["router_decision"] = "review"
        lead["router_reason"] = f"Borderline: {hard_fails[0]}"
    else:
        lead["router_decision"] = "dead"
        lead["router_reason"] = "; ".join(failures)

    lead["gates_passed"] = gates
    lead["gates_failed"] = failures
    return lead


def run_route(leads: list[dict]) -> tuple[list[dict], list[dict], list[dict]]:
    proceed = []
    review = []
    dead = []

    for lead in leads:
        route_lead(lead)
        if lead["router_decision"] == "proceed":
            proceed.append(lead)
        elif lead["router_decision"] == "review":
            review.append(lead)
        else:
            dead.append(lead)

    print(f"ROUTE    {len(proceed)} proceed | {len(review)} review | {len(dead)} dead")
    if dead:
        reason_counts = {}
        for d in dead:
            for f in d.get("gates_failed", []):
                tag = f.split("=")[0]
                reason_counts[tag] = reason_counts.get(tag, 0) + 1
        top = sorted(reason_counts.items(), key=lambda x: -x[1])[:5]
        print(f"         top kill reasons: {', '.join(f'{r}({c})' for r, c in top)}")
    return proceed, review, dead
