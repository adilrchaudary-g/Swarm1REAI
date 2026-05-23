"""Orchestrator for code violation scraping across all portals."""

from __future__ import annotations

import csv
import json
import re
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

from .portals import PORTALS, VIOLATION_KEYWORDS
from .socrata import fetch_socrata
from .arcgis import fetch_arcgis
from .carto import fetch_carto

from ...config import ACQUISITION_DIR


def _normalize_address(raw: str | None) -> str:
    if not raw:
        return ""
    raw = raw.strip()
    if raw.startswith("{"):
        try:
            parsed = json.loads(raw)
            return parsed.get("address", raw)
        except (json.JSONDecodeError, TypeError):
            pass
    return re.sub(r"\s+", " ", raw).strip()


def _extract_fields(record: dict, field_map: dict, portal: dict) -> dict[str, str]:
    """Map raw API fields to our normalized schema."""
    out: dict[str, str] = {}

    addr_field = field_map.get("address", "")
    if addr_field and addr_field in record:
        out["address_street"] = _normalize_address(str(record[addr_field]))
    elif "address_number" in field_map and "street_name" in field_map:
        num = str(record.get(field_map["address_number"], "")).strip()
        name = str(record.get(field_map["street_name"], "")).strip()
        suffix = str(record.get(field_map.get("street_suffix", ""), "")).strip()
        out["address_street"] = f"{num} {name} {suffix}".strip()

    for our_key, api_key in field_map.items():
        if our_key in ("address", "address_number", "street_name", "street_suffix"):
            continue
        val = record.get(api_key)
        if val is not None:
            if isinstance(val, (int, float)):
                if our_key == "date_opened" and val > 1e10:
                    try:
                        val = datetime.fromtimestamp(val / 1000).strftime("%Y-%m-%d")
                    except (OSError, ValueError):
                        val = str(val)
                else:
                    val = str(val)
            out[our_key] = str(val).strip()

    if "city" not in out:
        out["city"] = portal["name"].split(",")[0].strip()
    out["state"] = portal["state"]
    out["county"] = portal["county"]

    return out


def _is_valuable_violation(record: dict, field_map: dict) -> bool:
    """Filter for violation types that indicate motivated sellers."""
    VIOLATION_EXCLUSIONS = [
        "commercial", "apartment", "multi-family", "multifamily",
        "condo", "hotel", "motel", "church", "school", "hospital",
        "parking", "vehicle", "sidewalk", "sign", "billboard",
        "permit", "zoning", "license", "certificate",
    ]

    vtype_field = field_map.get("violation_type", "")
    vsubtype_field = field_map.get("violation_subtype", "")

    text = ""
    if vtype_field and vtype_field in record:
        text += " " + str(record[vtype_field])
    if vsubtype_field and vsubtype_field in record:
        text += " " + str(record[vsubtype_field])

    text = text.lower()
    if not text.strip():
        return True

    # Exclude non-residential and administrative violations
    if any(exc in text for exc in VIOLATION_EXCLUSIONS):
        return False

    return any(kw in text for kw in VIOLATION_KEYWORDS)


def scrape_portal(
    portal: dict,
    *,
    days_back: int = 30,
    limit: int = 5000,
    output_dir: Path | None = None,
) -> dict[str, Any]:
    """Scrape a single portal and save results as CSV with manifest."""
    portal_id = portal["id"]
    portal_type = portal["type"]
    print(f"\nSCRAPE   {portal['name']} ({portal_type})")

    try:
        if portal_type == "socrata":
            raw_records = fetch_socrata(
                portal["base_url"],
                portal["dataset_id"],
                status_filter=portal.get("status_filter", ""),
                date_field=portal.get("date_field", ""),
                days_back=days_back,
                limit=limit,
            )
        elif portal_type == "arcgis":
            raw_records = fetch_arcgis(
                portal["base_url"],
                where_filter=portal.get("where_filter", "1=1"),
                date_field=portal.get("date_field", ""),
                days_back=days_back,
                limit=limit,
            )
        elif portal_type == "carto":
            raw_records = fetch_carto(
                portal["base_url"],
                portal["table_name"],
                date_field=portal.get("date_field", ""),
                days_back=days_back,
                limit=limit,
                extra_where=portal.get("extra_where", ""),
            )
        else:
            print(f"  SKIP     Unknown portal type: {portal_type}")
            return {"portal": portal_id, "status": "error", "message": f"Unknown type: {portal_type}"}
    except Exception as e:
        print(f"  ERROR    {e}")
        return {"portal": portal_id, "status": "error", "message": str(e)}

    field_map = portal["field_map"]

    if portal_type == "arcgis" and days_back > 0:
        date_key = field_map.get("date_opened", "")
        cutoff_ms = (datetime.now() - timedelta(days=days_back)).timestamp() * 1000
        filtered_by_date = []
        for r in raw_records:
            val = r.get(date_key)
            if val is None:
                filtered_by_date.append(r)
            elif isinstance(val, (int, float)) and val >= cutoff_ms:
                filtered_by_date.append(r)
            elif isinstance(val, str):
                filtered_by_date.append(r)
        if len(filtered_by_date) < len(raw_records):
            print(f"  DATE     {len(filtered_by_date)} of {len(raw_records)} within {days_back} days")
        raw_records = filtered_by_date

    valuable = [r for r in raw_records if _is_valuable_violation(r, field_map)]
    print(f"  FILTER   {len(valuable)} of {len(raw_records)} are high-value violations")

    leads = []
    seen_addresses: set[str] = set()
    for record in valuable:
        fields = _extract_fields(record, field_map, portal)
        addr = fields.get("address_street", "").lower()
        if not addr or addr in seen_addresses:
            continue
        seen_addresses.add(addr)
        leads.append(fields)

    print(f"  DEDUP    {len(leads)} unique addresses")

    if not leads:
        return {"portal": portal_id, "status": "empty", "count": 0}

    today = datetime.now().strftime("%Y-%m-%d")
    city_slug = re.sub(r"[^a-z0-9]+", "-", portal["name"].lower()).strip("-")

    if output_dir is None:
        output_dir = ACQUISITION_DIR / "code-violations" / city_slug / today
    output_dir.mkdir(parents=True, exist_ok=True)

    csv_name = f"violations-{city_slug}.csv"
    csv_path = output_dir / csv_name

    fieldnames = [
        "address_street", "city", "state", "county", "zip",
        "violation_type", "violation_subtype", "status",
        "date_opened", "case_id", "parcel",
        "latitude", "longitude",
    ]
    existing_keys = set()
    for lead in leads:
        existing_keys.update(lead.keys())
    fieldnames = [f for f in fieldnames if f in existing_keys]

    with open(csv_path, "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(leads)

    manifest = {
        "source_type": "code_violations",
        "harvest_date": today,
        "geography": portal["name"],
        "county": portal["county"],
        "state": portal["state"],
        "portal_id": portal_id,
        "portal_type": portal_type,
        "data_quality_tier": "PARTIAL",
        "acquisition_method": "api_scrape",
        "files": [csv_name],
        "record_count": len(leads),
        "raw_fetched": len(raw_records),
        "filtered": len(valuable),
        "days_back": days_back,
        "scraped_at": datetime.now().isoformat(),
        "column_map": {
            "address_street": "address_street",
            "city": "address_city",
            "state": "address_state",
            "zip": "address_zip",
            "county": "county",
            "violation_type": "_violation_type",
            "date_opened": "_violation_date",
            "status": "_violation_status",
            "case_id": "_case_number",
        },
    }

    with open(output_dir / "manifest.json", "w") as f:
        json.dump(manifest, f, indent=2)

    print(f"  SAVED    {csv_path} ({len(leads)} leads)")
    return {
        "portal": portal_id,
        "name": portal["name"],
        "status": "ok",
        "count": len(leads),
        "csv_path": str(csv_path),
        "harvest_dir": str(output_dir),
    }


def scrape_all_portals(
    *,
    days_back: int = 30,
    limit: int = 5000,
    portal_ids: list[str] | None = None,
) -> list[dict[str, Any]]:
    """Scrape all configured portals (or a subset by ID)."""
    results = []
    portals = PORTALS
    if portal_ids:
        portals = [p for p in PORTALS if p["id"] in portal_ids]

    print(f"\n{'='*60}")
    print(f"CODE VIOLATION SCRAPER — {len(portals)} portals")
    print(f"{'='*60}")

    for portal in portals:
        result = scrape_portal(portal, days_back=days_back, limit=limit)
        results.append(result)

    ok = [r for r in results if r.get("status") == "ok"]
    total = sum(r.get("count", 0) for r in ok)
    print(f"\n{'='*60}")
    print(f"SCRAPE DONE  {len(ok)}/{len(portals)} portals OK — {total} total leads")
    print(f"{'='*60}\n")

    return results
