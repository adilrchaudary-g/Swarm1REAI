import re
from datetime import datetime


def _parse_year_from_date(date_str: str):
    if not date_str:
        return None
    for fmt in ("%m/%d/%Y", "%Y-%m-%d", "%m-%d-%Y"):
        try:
            return datetime.strptime(date_str.strip(), fmt).year
        except ValueError:
            continue
    m = re.search(r"(\d{4})", date_str)
    return int(m.group(1)) if m else None


def _infer_owner_type(name: str) -> str:
    upper = (name or "").upper()
    if "LLC" in upper or "INC" in upper or "CORP" in upper or "LP" in upper:
        return "llc"
    if "TRUST" in upper:
        return "trust"
    if "ESTATE" in upper:
        return "estate"
    return "individual"


def _mailing_distance(prop_state: str, prop_zip: str, mail_state: str, mail_zip: str) -> str:
    if not mail_state or not prop_state:
        return "unknown"
    if mail_state.upper() != prop_state.upper():
        return "out-of-state"
    if mail_zip and prop_zip and mail_zip[:5] != prop_zip[:5]:
        return "in-state-different-zip"
    if mail_zip and prop_zip and mail_zip[:5] == prop_zip[:5]:
        return "same-zip"
    return "unknown"


def enrich_lead(lead: dict) -> dict:
    sale_year = _parse_year_from_date(lead.get("last_sale_date", ""))
    lead["years_owned"] = (2026 - sale_year) if sale_year else None

    lead["owner_type"] = _infer_owner_type(lead.get("owner_name", ""))

    lead["mailing_distance"] = _mailing_distance(
        lead.get("address_state", ""),
        lead.get("address_zip", ""),
        lead.get("mailing_state", ""),
        lead.get("mailing_address", "").split(",")[-1].strip()[:5] if lead.get("mailing_address") else "",
    )

    est_value = lead.get("est_value")
    est_equity = lead.get("est_equity")
    if est_value and est_equity and est_value > 0:
        lead["equity_pct"] = round(est_equity / est_value * 100, 1)
    else:
        lead["equity_pct"] = None

    lead["has_callable_phone"] = len(lead.get("callable_phones", [])) > 0
    lead["phone_count"] = len(lead.get("callable_phones", []))

    cell_phones = [p for p in lead.get("callable_phones", []) if p.get("type", "").lower() == "cell"]
    lead["has_cell"] = len(cell_phones) > 0

    return lead


_TIER_RANK = {"MINIMAL": 0, "VARIABLE": 1, "PARTIAL": 2, "MODERATE": 3, "FULL": 4}

_PROPERTY_FIELDS = [
    "property_type", "bedrooms", "bathrooms", "sqft", "lot_sqft", "year_built",
    "assessed_value", "total_condition", "interior_condition", "exterior_condition",
    "bathroom_condition", "kitchen_condition",
]
_FINANCIAL_FIELDS = [
    "est_value", "est_equity", "est_ltv", "est_remaining_balance",
    "total_open_loans", "last_sale_date", "last_sale_price", "lien_amount",
    "foreclosure_factor", "mls_status", "mls_date", "mls_amount",
]


def _merge_leads(existing: dict, incoming: dict):
    for sig in incoming.get("distress_signals", []):
        if sig not in existing.get("distress_signals", []):
            existing["distress_signals"].append(sig)

    if not existing.get("source_lists"):
        existing["source_lists"] = [existing.get("source_list", "")]
    existing["source_lists"].append(incoming.get("source_list", ""))

    if not existing.get("source_types"):
        existing["source_types"] = [existing.get("source_type", "")]
    inc_type = incoming.get("source_type", "")
    if inc_type and inc_type not in existing["source_types"]:
        existing["source_types"].append(inc_type)

    for phone in incoming.get("phones", []):
        if phone.get("number") and phone not in existing.get("phones", []):
            existing.setdefault("phones", []).append(phone)
    for phone in incoming.get("callable_phones", []):
        if phone.get("number") and phone not in existing.get("callable_phones", []):
            existing.setdefault("callable_phones", []).append(phone)
    for email in incoming.get("emails", []):
        if email and email not in existing.get("emails", []):
            existing.setdefault("emails", []).append(email)

    existing_rank = _TIER_RANK.get(existing.get("data_quality_tier", "FULL"), 4)
    incoming_rank = _TIER_RANK.get(incoming.get("data_quality_tier", "FULL"), 4)
    if incoming_rank > existing_rank:
        for field in _PROPERTY_FIELDS + _FINANCIAL_FIELDS:
            if incoming.get(field) is not None and existing.get(field) is None:
                existing[field] = incoming[field]
        existing["data_quality_tier"] = incoming["data_quality_tier"]

    existing["has_callable_phone"] = len(existing.get("callable_phones", [])) > 0
    existing["phone_count"] = len(existing.get("callable_phones", []))
    cell_phones = [p for p in existing.get("callable_phones", []) if p.get("type", "").lower() == "cell"]
    existing["has_cell"] = len(cell_phones) > 0
    existing["needs_skip_trace"] = not existing["has_callable_phone"]


def run_enrich(leads: list[dict]) -> list[dict]:
    seen_apns = {}
    enriched = []
    dupes = 0

    for lead in leads:
        lead = enrich_lead(lead)
        key = lead.get("apn") or lead.get("address_full", "")
        if key in seen_apns:
            _merge_leads(seen_apns[key], lead)
            dupes += 1
        else:
            lead["source_lists"] = [lead.get("source_list", "")]
            lead.setdefault("source_types", [lead.get("source_type", "")])
            seen_apns[key] = lead
            enriched.append(lead)

    print(f"ENRICH   {len(enriched)} unique leads ({dupes} duplicates merged)")
    callable_count = sum(1 for l in enriched if l.get("has_callable_phone"))
    print(f"         {callable_count} with callable phones")
    source_types = {}
    for l in enriched:
        for st in l.get("source_types", []):
            if st:
                source_types[st] = source_types.get(st, 0) + 1
    if len(source_types) > 1:
        parts = [f"{v} {k}" for k, v in sorted(source_types.items(), key=lambda x: -x[1])]
        print(f"         sources: {' | '.join(parts)}")
    return enriched
