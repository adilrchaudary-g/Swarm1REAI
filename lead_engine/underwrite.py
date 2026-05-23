"""Underwriting engine — full deal analysis for interested leads.

Produces a comprehensive report: multi-source ARV, repair estimate,
MAO, assignment fee range, buyer math, property photos, external links,
situation summary, discrepancies, and overall grade.
"""

from __future__ import annotations

import json
import re
from typing import Any
from urllib.parse import quote_plus

from .config import ASSIGNMENT_FEE, DISCOUNT_FACTOR

# ── Condition → repair estimate mapping ─────────────────────────

CONDITION_REPAIR_MAP = {
    "excellent": (5_000, 10_000),
    "good": (8_000, 18_000),
    "average": (15_000, 30_000),
    "fair": (30_000, 50_000),
    "poor": (50_000, 80_000),
    "unsound": (80_000, 120_000),
}

CONDITION_LABELS = {
    "excellent": "Minimal cosmetic touch-up needed",
    "good": "Light cosmetic updates — paint, fixtures, minor repairs",
    "average": "Moderate rehab — flooring, kitchen/bath refresh, some systems",
    "fair": "Significant rehab — full kitchen/bath remodel, structural repairs possible",
    "poor": "Major renovation — gut rehab likely, structural and systems work",
    "unsound": "Complete rebuild or demolish — foundation, roof, systems all compromised",
}

# ── Assignment fee brackets ─────────────────────────────────────

def _assignment_fee_range(arv: int) -> tuple[int, int]:
    if arv < 150_000:
        return (8_000, 15_000)
    if arv < 250_000:
        return (15_000, 25_000)
    return (20_000, 35_000)


# ── ARV analysis ────────────────────────────────────────────────

def _analyze_arv(property_data: dict) -> dict[str, Any]:
    sources: list[dict] = []
    arv_ps = property_data.get("propstream_arv_estimate") or 0
    arv_tax = property_data.get("current_tax_assessment") or 0

    if arv_ps:
        sources.append({"source": "PropStream", "value": arv_ps})
    if arv_tax:
        adjusted = round(arv_tax * 1.1)
        sources.append({"source": "County Tax Assessment (×1.1)", "value": adjusted})

    values = [s["value"] for s in sources if s["value"] > 0]
    if not values:
        return {"arv_final": 0, "arv_confidence": 0, "sources": sources, "discrepancies": []}

    arv_final = round(sum(values) / len(values))
    confidence = 0.7 if len(values) >= 2 else 0.4

    discrepancies = []
    if len(values) >= 2:
        spread = max(values) - min(values)
        pct = spread / arv_final if arv_final else 0
        if pct > 0.15:
            confidence = max(0.3, confidence - 0.2)
            discrepancies.append({
                "field": "ARV",
                "sources": [{"name": s["source"], "value": s["value"]} for s in sources],
                "spread_pct": round(pct * 100, 1),
                "note": f"Sources diverge by {pct:.0%} — verify with comps",
            })

    return {
        "arv_final": arv_final,
        "arv_confidence": round(confidence, 2),
        "sources": sources,
        "discrepancies": discrepancies,
    }


# ── Repair estimate from condition ──────────────────────────────

def _estimate_repairs(property_data: dict) -> dict[str, Any]:
    conditions = {}
    for field in ("total_condition", "exterior_condition", "interior_condition", "bathroom_condition", "kitchen_condition"):
        val = (property_data.get(field) or "").strip().lower()
        if val:
            conditions[field.replace("_condition", "")] = val

    if not conditions:
        return {
            "low": 25_000,
            "high": 45_000,
            "notes": "No condition data available — using default mid-range estimate",
            "conditions": {},
        }

    worst = "average"
    for label in ("unsound", "poor", "fair", "average", "good", "excellent"):
        if any(label in v for v in conditions.values()):
            worst = label
            break

    low, high = CONDITION_REPAIR_MAP.get(worst, (25_000, 45_000))
    notes = CONDITION_LABELS.get(worst, "")
    detail_parts = [f"{k}: {v}" for k, v in conditions.items()]
    if detail_parts:
        notes += f" ({', '.join(detail_parts)})"

    return {"low": low, "high": high, "notes": notes, "conditions": conditions}


# ── External URLs ───────────────────────────────────────────────

def _build_urls(property_data: dict) -> dict[str, str | None]:
    addr = property_data.get("address_full") or ""
    street = property_data.get("address_street") or ""
    city = property_data.get("address_city") or ""
    state = property_data.get("address_state") or ""
    zipcode = property_data.get("address_zip") or ""

    full_addr = addr or f"{street}, {city}, {state} {zipcode}".strip(", ")
    encoded = quote_plus(full_addr)
    slug = re.sub(r"[^a-z0-9]+", "-", full_addr.lower()).strip("-")

    urls: dict[str, str | None] = {}
    urls["street_view"] = f"https://www.google.com/maps/@?api=1&map_action=pano&viewpoint={encoded}" if full_addr else None
    urls["google_maps"] = f"https://www.google.com/maps/search/?api=1&query={encoded}" if full_addr else None
    urls["zillow"] = f"https://www.zillow.com/homes/{slug}_rb/" if full_addr else None
    urls["propstream"] = property_data.get("property_detail_url")
    urls["county_assessor"] = None

    return urls


# ── Photo collection ────────────────────────────────────────────

def _collect_photos(property_data: dict, urls: dict) -> list[dict]:
    photos: list[dict] = []

    raw_photos = property_data.get("photo_urls_json")
    if raw_photos:
        try:
            ps_photos = json.loads(raw_photos) if isinstance(raw_photos, str) else raw_photos
            if isinstance(ps_photos, list):
                for url in ps_photos[:6]:
                    if isinstance(url, str) and url.startswith("http"):
                        photos.append({"url": url, "source": "PropStream", "condition_note": ""})
        except (json.JSONDecodeError, TypeError):
            pass

    sv = urls.get("street_view")
    if sv:
        photos.append({"url": sv, "source": "Google Street View", "condition_note": "Verify exterior condition"})

    return photos


# ── Situation summary ───────────────────────────────────────────

def _build_summary(
    lead: dict, prop: dict, owner: dict | None, notes: list[dict], arv_analysis: dict, repairs: dict, grade: str,
) -> str:
    parts: list[str] = []

    addr = prop.get("address_full") or prop.get("address_street") or "Unknown address"
    parts.append(f"**{addr}**")

    # Owner situation
    owner_name = (owner or {}).get("owner_name") or "Unknown owner"
    years = (owner or {}).get("years_owned")
    occupied = prop.get("owner_occupied")
    owner_desc = owner_name
    if years:
        owner_desc += f", owned {years} years"
    if occupied is False:
        owner_desc += ", non-owner-occupied"
    elif occupied is True:
        owner_desc += ", owner-occupied"
    parts.append(f"Owner: {owner_desc}")

    # Distress signals
    signals = []
    try:
        signals = json.loads(lead.get("distress_signals_json") or "[]")
    except (json.JSONDecodeError, TypeError):
        pass
    if signals:
        signal_labels = [s.replace("_", " ").title() for s in signals]
        parts.append(f"Distress: {', '.join(signal_labels)}")

    # Property details
    details = []
    if prop.get("property_type"):
        details.append(prop["property_type"].replace("_", " ").title())
    if prop.get("bedrooms"):
        details.append(f"{prop['bedrooms']}bd")
    if prop.get("bathrooms"):
        details.append(f"{prop['bathrooms']}ba")
    if prop.get("square_feet"):
        details.append(f"{prop['square_feet']:,} sqft")
    if prop.get("year_built"):
        details.append(f"built {prop['year_built']}")
    if details:
        parts.append(f"Property: {' / '.join(details)}")

    # Financials
    arv = arv_analysis.get("arv_final", 0)
    if arv:
        parts.append(f"ARV: ${arv:,} (confidence: {arv_analysis.get('arv_confidence', 0):.0%})")
    repair_avg = (repairs["low"] + repairs["high"]) // 2
    parts.append(f"Repairs: ${repairs['low']:,}–${repairs['high']:,} (avg ${repair_avg:,})")

    # Condition
    if repairs.get("conditions"):
        worst = max(repairs["conditions"].values(), key=lambda v: list(CONDITION_REPAIR_MAP.keys()).index(v) if v in CONDITION_REPAIR_MAP else 2)
        parts.append(f"Condition: {worst.title()}")

    # Equity
    equity = prop.get("propstream_equity")
    ltv = prop.get("propstream_ltv")
    if equity:
        parts.append(f"Equity: ${equity:,}" + (f" (LTV: {ltv}%)" if ltv else ""))

    # Call notes
    if notes:
        recent = sorted(notes, key=lambda n: n.get("created_at", ""), reverse=True)
        for n in recent[:3]:
            content = (n.get("content") or "").strip()
            if content:
                ntype = n.get("note_type", "note")
                parts.append(f"[{ntype}] {content[:200]}")

    return "\n".join(parts)


# ── Grade calculation ───────────────────────────────────────────

def _calculate_grade(arv: int, mao_70: int, repair_avg: int, confidence: float) -> tuple[str, str]:
    if arv <= 0:
        return "F", "Insufficient data to evaluate"

    spread = arv - mao_70 - repair_avg
    if spread >= 40_000 and confidence >= 0.5:
        return "A", "Strong Buy — healthy spread, good data confidence"
    if spread >= 25_000 and confidence >= 0.4:
        return "B", "Proceed — solid numbers, verify condition and comps"
    if spread >= 15_000:
        return "C", "Proceed with Caution — tight margins, need accurate repair estimate"
    if spread >= 5_000:
        return "D", "Marginal — very thin deal, only if repairs come in low"
    return "F", "Pass — numbers don't work at 70% rule"


# ── Main entry point ────────────────────────────────────────────

def underwrite_lead(
    lead: dict,
    property_data: dict,
    owner: dict | None = None,
    notes: list[dict] | None = None,
) -> dict[str, Any]:
    """Run full underwriting analysis. Returns data ready for underwriting_reports table."""
    notes = notes or []

    arv_analysis = _analyze_arv(property_data)
    arv_final = arv_analysis["arv_final"]
    arv_ps = property_data.get("propstream_arv_estimate") or 0
    arv_tax = property_data.get("current_tax_assessment") or 0

    repairs = _estimate_repairs(property_data)
    repair_avg = (repairs["low"] + repairs["high"]) // 2

    holding = round(arv_final * 0.06) if arv_final else 0
    fee_low, fee_high = _assignment_fee_range(arv_final)
    fee_mid = (fee_low + fee_high) // 2

    mao_70 = round(arv_final * 0.70 - repair_avg - fee_mid - holding) if arv_final else 0
    mao_65 = round(arv_final * 0.65 - repair_avg - fee_mid - holding) if arv_final else 0

    # Buyer cash-on-cash estimate (1% rule for monthly rent)
    monthly_rent = round(arv_final * 0.01) if arv_final else 0
    annual_rent = monthly_rent * 12
    annual_expenses = round(annual_rent * 0.45)  # 45% expense ratio
    total_investment = max(1, mao_70 + repair_avg)
    cash_on_cash = round((annual_rent - annual_expenses) / total_investment * 100, 1) if total_investment > 0 else 0

    grade, recommendation = _calculate_grade(arv_final, mao_70, repair_avg, arv_analysis["arv_confidence"])

    urls = _build_urls(property_data)
    photos = _collect_photos(property_data, urls)

    summary = _build_summary(lead, property_data, owner, notes, arv_analysis, repairs, grade)

    all_discrepancies = arv_analysis.get("discrepancies", [])

    return {
        "arv_propstream": arv_ps or None,
        "arv_county": arv_tax or None,
        "arv_zillow": None,
        "arv_final": arv_final or None,
        "arv_confidence": arv_analysis["arv_confidence"],
        "arv_sources_json": json.dumps(arv_analysis["sources"]),
        "repair_estimate_low": repairs["low"],
        "repair_estimate_high": repairs["high"],
        "repair_notes": repairs["notes"],
        "mao_70": mao_70,
        "mao_65": mao_65,
        "assignment_fee_low": fee_low,
        "assignment_fee_high": fee_high,
        "cash_on_cash_buyer": cash_on_cash,
        "holding_costs": holding,
        "photo_urls_json": json.dumps(photos),
        "street_view_url": urls.get("street_view"),
        "zillow_url": urls.get("zillow"),
        "county_assessor_url": urls.get("county_assessor"),
        "propstream_url": urls.get("propstream"),
        "condition_assessment": repairs["notes"],
        "situation_summary": summary,
        "discrepancies_json": json.dumps(all_discrepancies),
        "overall_grade": grade,
        "recommendation": recommendation,
        "status": "complete",
    }
