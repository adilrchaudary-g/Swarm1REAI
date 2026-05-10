import csv
import json
import os
from pathlib import Path
from .config import DISCOUNT_FACTOR, ASSIGNMENT_FEE


def _deal_math(lead: dict) -> dict:
    arv = lead.get("est_value") or 0
    equity = lead.get("est_equity") or 0
    balance = lead.get("est_remaining_balance") or 0
    holding = round(arv * 0.06)
    repair_est = 30_000
    mao = round(arv * DISCOUNT_FACTOR - repair_est - ASSIGNMENT_FEE - holding)

    return {
        "arv": arv,
        "discount_factor": DISCOUNT_FACTOR,
        "repair_estimate": repair_est,
        "assignment_fee": ASSIGNMENT_FEE,
        "holding_costs": holding,
        "mao": mao,
    }


def _why_this_lead(lead: dict) -> str:
    parts = []
    persona = lead.get("persona_primary", "")
    signals = lead.get("distress_signals", [])

    if "nod_filed" in signals:
        parts.append("Pre-foreclosure")
    if "tax_delinquent" in signals:
        parts.append("Tax delinquent")
    if "probate_filed" in signals:
        parts.append("Probate")

    equity_pct = lead.get("equity_pct")
    if equity_pct and equity_pct > 50:
        parts.append(f"{equity_pct:.0f}% equity")

    dist = lead.get("mailing_distance", "")
    if dist == "out-of-state":
        parts.append("out-of-state owner")

    years = lead.get("years_owned")
    if years and years >= 5:
        parts.append(f"owned {years}yr")

    mls = lead.get("mls_status", "").upper()
    if mls in ("EXPIRED", "WITHDRAWN"):
        parts.append(f"MLS {mls.lower()}")

    return " + ".join(parts) if parts else persona



def build_queue(
    top_leads: list[dict],
    review_leads: list[dict],
    dead_leads: list[dict],
    total_intake: int,
    total_enriched: int,
    queue_dir: Path,
    harvest_date: str,
):
    queue_dir.mkdir(parents=True, exist_ok=True)
    review_dir = queue_dir / "_review"
    review_dir.mkdir(exist_ok=True)

    rows = []
    lead_cards = []
    for lead in top_leads:
        deal = _deal_math(lead)
        lead["deal_math"] = deal

        cell_phone = ""
        cell_dnc = ""
        cell_phones = [p for p in lead.get("callable_phones", []) if p.get("type", "").lower() == "cell"]
        non_dnc_cells = [p for p in cell_phones if not p.get("dnc")]
        if non_dnc_cells:
            cell_phone = non_dnc_cells[0].get("number", "")
        elif cell_phones:
            cell_phone = cell_phones[0].get("number", "")
            cell_dnc = cell_phones[0].get("dnc_raw", "DNC")

        full_address = ", ".join(p for p in [
            lead.get("address_street", ""),
            lead.get("address_city", ""),
            lead.get("address_state", ""),
            lead.get("address_zip", ""),
        ] if p)

        row = {
            "Address": full_address,
            "Owner": lead.get("owner_name", ""),
            "Cell": cell_phone,
            "DNC": cell_dnc,
            "Rank": lead.get("rank", ""),
            "Score": lead.get("motivation_score", ""),
            "Tier": lead.get("motivation_tier", ""),
            "Persona": lead.get("persona_primary", ""),
            "Est Value": lead.get("est_value", ""),
            "Est Equity": lead.get("est_equity", ""),
            "Equity%": lead.get("equity_pct", ""),
            "MAO": deal.get("mao", ""),
            "Distress": ", ".join(lead.get("distress_signals", [])),
            "Why This Lead": _why_this_lead(lead),
        }
        rows.append(row)

        card = {
            "rank": lead.get("rank"),
            "apn": lead.get("apn"),
            "address": lead.get("address_full"),
            "owner": {
                "name": lead.get("owner_name"),
                "type": lead.get("owner_type"),
                "owner_occupied": lead.get("owner_occupied"),
                "mailing_address": lead.get("mailing_address"),
                "mailing_distance": lead.get("mailing_distance"),
                "years_owned": lead.get("years_owned"),
            },
            "contact": {
                "phones": lead.get("callable_phones", []),
                "emails": lead.get("emails", []),
            },
            "property": {
                "type": lead.get("property_type"),
                "beds": lead.get("bedrooms"),
                "baths": lead.get("bathrooms"),
                "sqft": lead.get("sqft"),
                "year_built": lead.get("year_built"),
                "lot_sqft": lead.get("lot_sqft"),
            },
            "financials": {
                "est_value": lead.get("est_value"),
                "est_equity": lead.get("est_equity"),
                "ltv": lead.get("est_ltv"),
                "assessed_value": lead.get("assessed_value"),
                "last_sale_date": lead.get("last_sale_date"),
                "last_sale_price": lead.get("last_sale_price"),
                "open_loans": lead.get("total_open_loans"),
                "est_remaining_balance": lead.get("est_remaining_balance"),
            },
            "scoring": {
                "motivation_score": lead.get("motivation_score"),
                "motivation_tier": lead.get("motivation_tier"),
                "persona": lead.get("persona_primary"),
                "persona_confidence": lead.get("persona_confidence"),
                "distress_signals": lead.get("distress_signals"),
                "components": lead.get("motivation_components"),
            },
            "deal_math": deal,
            "routing": {
                "decision": lead.get("router_decision"),
                "gates_passed": lead.get("gates_passed"),
                "reason": lead.get("router_reason"),
            },
            "call_prep": {
                "persona": lead.get("persona_primary"),
                "why_this_lead": _why_this_lead(lead),
            },
        }
        lead_cards.append(card)

    csv_path = queue_dir / "_call-list.csv"
    if rows:
        with open(csv_path, "w", newline="") as fh:
            writer = csv.DictWriter(fh, fieldnames=rows[0].keys())
            writer.writeheader()
            writer.writerows(rows)

    json_path = queue_dir / "_call-list.json"
    with open(json_path, "w") as fh:
        json.dump(lead_cards, fh, indent=2, default=str)

    for card in lead_cards:
        slug = card.get("apn", "unknown").replace(" ", "-")
        addr = (card.get("address", "") or "").split(",")[0].strip().lower().replace(" ", "-")
        folder_name = f"{card['rank']:02d}-{addr}" if addr else f"{card['rank']:02d}-{slug}"
        lead_dir = queue_dir / folder_name
        lead_dir.mkdir(exist_ok=True)
        with open(lead_dir / "lead-card.json", "w") as fh:
            json.dump(card, fh, indent=2, default=str)

    for rl in review_leads:
        slug = (rl.get("address_street") or rl.get("apn", "unknown")).lower().replace(" ", "-")
        with open(review_dir / f"{slug}.json", "w") as fh:
            json.dump({
                "address": rl.get("address_full"),
                "apn": rl.get("apn"),
                "review_reason": rl.get("router_reason"),
                "owner": rl.get("owner_name"),
                "est_value": rl.get("est_value"),
                "score": rl.get("motivation_score"),
                "persona": rl.get("persona_primary"),
                "phones": rl.get("callable_phones", []),
            }, fh, indent=2, default=str)

    stats = {
        "harvest_date": harvest_date,
        "pipeline": {
            "intake": total_intake,
            "enriched": total_enriched,
            "routed_proceed": len(top_leads) + (total_enriched - len(top_leads) - len(review_leads) - len(dead_leads)),
            "routed_review": len(review_leads),
            "routed_dead": len(dead_leads),
            "queued": len(top_leads),
        },
        "queue_leads": len(top_leads),
        "review_leads": len(review_leads),
    }
    with open(queue_dir / "_stats.json", "w") as fh:
        json.dump(stats, fh, indent=2)

    print(f"QUEUE    {len(top_leads)} leads → {csv_path}")
    if review_leads:
        print(f"         {len(review_leads)} review leads → {review_dir}")
    print(f"         Stats → {queue_dir / '_stats.json'}")
    return csv_path
