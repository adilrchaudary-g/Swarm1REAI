import csv
import json
import re
from pathlib import Path
from .config import SIGNAL_MAP


def _clean(val: str) -> str:
    return (val or "").strip()


def _number(val: str):
    raw = _clean(val).replace("$", "").replace(",", "").replace("%", "")
    if not raw:
        return None
    try:
        return float(raw) if "." in raw else int(raw)
    except ValueError:
        return None


def _yes_no(val: str):
    v = _clean(val).lower()
    if v == "yes":
        return True
    if v == "no":
        return False
    return None


def _is_dnc(val: str) -> bool:
    v = _clean(val).lower()
    return v in ("yes", "public dnc", "state dnc", "dnc")


def _slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")


def parse_row(row: dict, signal_name: str) -> dict:
    def v(key): return _clean(row.get(key, ""))
    def n(key): return _number(row.get(key, ""))

    owner1 = " ".join(filter(None, [v("Owner 1 First Name"), v("Owner 1 Last Name")]))
    owner2 = " ".join(filter(None, [v("Owner 2 First Name"), v("Owner 2 Last Name")]))
    owner_name = " & ".join(part for part in [owner1, owner2] if part)

    mailing_parts = [v("Mailing Care of Name"), v("Mailing Address"), v("Mailing Unit #"),
                     v("Mailing City"), v("Mailing State"), v("Mailing Zip")]
    mailing_address = ", ".join(p for p in mailing_parts if p)

    phones = []
    for i in range(1, 6):
        num = v(f"Phone {i}")
        if num:
            phones.append({
                "number": num,
                "type": v(f"Phone {i} Type") or "Unknown",
                "dnc": _is_dnc(row.get(f"Phone {i} DNC", "")),
                "dnc_raw": v(f"Phone {i} DNC"),
            })

    callable_phones = [p for p in phones if p["number"]]

    emails = [v(f"Email {j}") for j in range(1, 5) if v(f"Email {j}")]

    signals = []
    mls = v("MLS Status").upper()
    if mls == "EXPIRED":
        signals.append("mls_expired")
    if mls == "WITHDRAWN":
        signals.append("mls_withdrawn")
    if signal_name in SIGNAL_MAP:
        signals.append(SIGNAL_MAP[signal_name])

    address_street = v("Address")
    address_city = v("City")
    address_state = v("State")
    address_zip = v("Zip")
    full_address = ", ".join(p for p in [address_street, address_city, address_state, address_zip] if p)
    apn = v("APN")

    return {
        "apn": apn,
        "slug": _slug(address_street) if address_street else _slug(apn),
        "address_street": address_street,
        "address_city": address_city,
        "address_state": address_state,
        "address_zip": address_zip,
        "address_full": full_address,
        "county": v("County"),
        "property_type": v("Property Type"),
        "bedrooms": n("Bedrooms"),
        "bathrooms": n("Total Bathrooms"),
        "sqft": n("Building Sqft"),
        "lot_sqft": n("Lot Size Sqft"),
        "year_built": n("Effective Year Built"),
        "assessed_value": n("Total Assessed Value"),
        "last_sale_date": v("Last Sale Recording Date"),
        "last_sale_price": n("Last Sale Amount"),
        "total_open_loans": n("Total Open Loans"),
        "est_remaining_balance": n("Est. Remaining balance of Open Loans"),
        "est_value": n("Est. Value"),
        "est_ltv": n("Est. Loan-to-Value"),
        "est_equity": n("Est. Equity"),
        "total_condition": v("Total Condition"),
        "interior_condition": v("Interior Condition"),
        "exterior_condition": v("Exterior Condition"),
        "bathroom_condition": v("Bathroom Condition"),
        "kitchen_condition": v("Kitchen Condition"),
        "foreclosure_factor": v("Foreclosure Factor"),
        "mls_status": v("MLS Status"),
        "mls_date": v("MLS Date"),
        "mls_amount": n("MLS Amount"),
        "lien_amount": n("Lien Amount"),
        "owner_name": owner_name,
        "owner_occupied": _yes_no(row.get("Owner Occupied", "")),
        "mailing_address": mailing_address,
        "mailing_state": v("Mailing State"),
        "do_not_mail": _yes_no(row.get("Do Not Mail", "")),
        "litigator": _yes_no(row.get("Litigator", "")),
        "phones": phones,
        "callable_phones": callable_phones,
        "emails": emails,
        "distress_signals": signals,
        "source_list": signal_name,
        "date_added": v("Date Added to List"),
        "skip_traces": n("Skip Traces"),
    }


def run_intake(harvest_dir: Path) -> list[dict]:
    manifest_path = harvest_dir / "manifest.json"
    with open(manifest_path) as f:
        manifest = json.load(f)

    leads = []
    for signal_name, signal_info in manifest.get("signals", {}).items():
        csv_path = harvest_dir / signal_info["file"]
        with open(csv_path, "r", newline="") as fh:
            reader = csv.DictReader(fh)
            for row in reader:
                lead = parse_row(row, signal_name)
                if lead["apn"] or lead["address_street"]:
                    leads.append(lead)

    print(f"INTAKE   {len(leads)} rows from {len(manifest.get('signals', {}))} signal lists")
    return leads
