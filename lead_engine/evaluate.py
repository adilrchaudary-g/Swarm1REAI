"""Post-import evaluation engine.

Runs on leads with status='imported' after PropStream ingest. Scores,
classifies, and gates each lead. Passing leads promote to 'new';
failing leads stay 'imported' with evaluation_json explaining why.
"""

from __future__ import annotations

import json
from typing import Any

from .classify import classify_lead
from .config import ARV_MAX, ARV_MIN, BLOCKED_STATES
from .score import score_lead

NON_RESIDENTIAL = {"commercial", "industrial", "apartment", "condo", "multi-family", "multifamily"}
PASS_THRESHOLD = 30  # LUKEWARM+


def _build_lead_dict(lead_row: dict, prop_row: dict, owner_row: dict | None, phone_count: int) -> dict:
    """Flatten DB rows into the dict shape score.py / classify.py expect."""
    d: dict[str, Any] = {}
    d["lead_id"] = lead_row.get("lead_id")
    d["status"] = lead_row.get("status", "imported")
    d["source"] = lead_row.get("source")

    d["distress_signals"] = []
    try:
        d["distress_signals"] = json.loads(lead_row.get("distress_signals_json") or "[]")
    except (json.JSONDecodeError, TypeError):
        pass

    d["est_value"] = prop_row.get("propstream_arv_estimate") or 0
    d["est_equity"] = prop_row.get("propstream_equity") or 0
    d["est_ltv"] = prop_row.get("propstream_ltv") or 0
    d["foreclosure_factor"] = prop_row.get("propstream_foreclosure_factor") or ""
    d["total_condition"] = prop_row.get("total_condition") or ""
    d["exterior_condition"] = prop_row.get("exterior_condition") or ""
    d["interior_condition"] = prop_row.get("interior_condition") or ""
    d["property_type"] = prop_row.get("property_type") or ""
    d["owner_occupied"] = prop_row.get("owner_occupied")
    d["address_state"] = prop_row.get("address_state") or ""

    if owner_row:
        d["owner_name"] = owner_row.get("owner_name") or ""
        d["owner_type"] = owner_row.get("owner_type") or ""
        d["mailing_address"] = owner_row.get("mailing_address") or ""
        d["mailing_distance"] = owner_row.get("mailing_address_distance_mi") or ""
        d["years_owned"] = owner_row.get("years_owned")

    d["phone_count"] = phone_count
    return d


def evaluate_lead(lead_row: dict, prop_row: dict, owner_row: dict | None = None, phone_count: int = 0) -> dict[str, Any]:
    """Evaluate a single lead. Returns evaluation result dict."""
    d = _build_lead_dict(lead_row, prop_row, owner_row, phone_count)
    flags: list[str] = []
    gates_failed: list[str] = []

    # Gate: blocked state
    state = d.get("address_state", "").upper()
    if state in BLOCKED_STATES:
        gates_failed.append(f"blocked_state:{state}")

    # Gate: non-residential property
    prop_type = (d.get("property_type") or "").lower()
    if any(nr in prop_type for nr in NON_RESIDENTIAL):
        gates_failed.append(f"non_residential:{prop_type}")

    # Gate: must have phone
    if phone_count == 0:
        gates_failed.append("no_phone")

    # ARV sanity check
    arv = d.get("est_value") or 0
    tax = prop_row.get("current_tax_assessment") or 0
    if arv and tax and tax > 0:
        divergence = abs(arv - tax) / tax
        if divergence > 0.5:
            flags.append(f"arv_tax_divergence:{divergence:.0%}")
    if arv and (arv < ARV_MIN or arv > ARV_MAX):
        flags.append(f"arv_out_of_range:{arv}")

    # Score and classify
    score_lead(d)
    classify_lead(d)

    motivation_score = d.get("motivation_score", 0)
    motivation_tier = d.get("motivation_tier", "ICE")
    persona = d.get("persona_primary", "")

    # Threshold gate
    if motivation_score < PASS_THRESHOLD and not gates_failed:
        gates_failed.append(f"low_score:{motivation_score}")

    passed = len(gates_failed) == 0

    reason_parts = []
    if passed:
        reason_parts.append(f"score={motivation_score} tier={motivation_tier} persona={persona}")
        if flags:
            reason_parts.append(f"flags=[{', '.join(flags)}]")
    else:
        reason_parts.append(f"failed gates: {', '.join(gates_failed)}")

    return {
        "passed": passed,
        "score": motivation_score,
        "tier": motivation_tier,
        "persona": persona,
        "persona_scores": d.get("persona_scores", {}),
        "components": d.get("motivation_components", {}),
        "flags": flags,
        "gates_failed": gates_failed,
        "reason": "; ".join(reason_parts),
    }


def evaluate_batch(rows: list[tuple[dict, dict, dict | None, int]]) -> list[dict[str, Any]]:
    """Evaluate a batch of (lead_row, prop_row, owner_row, phone_count) tuples."""
    results = []
    for lead_row, prop_row, owner_row, phone_count in rows:
        result = evaluate_lead(lead_row, prop_row, owner_row, phone_count)
        result["lead_id"] = lead_row.get("lead_id")
        results.append(result)
    return results
