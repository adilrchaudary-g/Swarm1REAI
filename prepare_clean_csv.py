#!/usr/bin/env python3
"""Prepare a clean CSV for PropStream import from code violation + phoneless leads."""

import csv
import re
import sqlite3
from pathlib import Path

REPO = Path(__file__).resolve().parent
DB_PATH = REPO / "hermes" / "data" / "propstream.db"

COUNTY_TO_CITY = {
    "Miami-Dade County": "Miami",
    "miami-dade county": "Miami",
    "Baltimore City": "Baltimore",
}

def has_street_number(addr: str) -> bool:
    """Check if address starts with a valid street number."""
    if not addr:
        return False
    first = addr.split()[0] if addr.split() else ""
    return bool(re.match(r'^\d+', first)) and first != "0"

def clean_city(city: str) -> str:
    """Fix county names used as city names."""
    for county, real_city in COUNTY_TO_CITY.items():
        if city.lower().strip() == county.lower():
            return real_city
    return city

def main():
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row

    # Get all leads needing phones (not archived/dead, no phone records)
    rows = conn.execute("""
        SELECT DISTINCT
            p.address_street, p.address_city, p.address_state, p.address_zip
        FROM leads l
        JOIN properties p ON p.property_id = l.property_id
        LEFT JOIN owner_phones op ON op.owner_id = l.owner_id
        WHERE op.id IS NULL
        AND l.status NOT IN ('archived', 'dead')
        AND p.address_street IS NOT NULL
        AND p.address_street != ''
        LIMIT 5000
    """).fetchall()
    conn.close()

    print(f"Raw leads needing phones: {len(rows)}")

    clean = []
    skipped_no_number = 0
    skipped_no_zip = 0
    skipped_no_city = 0

    for r in rows:
        addr = (r["address_street"] or "").strip()
        city = (r["address_city"] or "").strip()
        state = (r["address_state"] or "").strip()
        zipcode = (r["address_zip"] or "").strip()

        if not has_street_number(addr):
            skipped_no_number += 1
            continue

        if not city:
            skipped_no_city += 1
            continue

        city = clean_city(city)

        # PropStream works better with zip codes
        if not zipcode:
            skipped_no_zip += 1
            # Still include - PropStream can match without zip
            pass

        clean.append({
            "Address": addr,
            "City": city,
            "State": state,
            "Zip": zipcode,
        })

    print(f"Clean addresses: {len(clean)}")
    print(f"Skipped (no street number): {skipped_no_number}")
    print(f"Skipped (no city): {skipped_no_city}")
    print(f"Note: {skipped_no_zip} have no zip (still included)")

    # Write clean CSV
    out_path = REPO / "hermes" / "data" / "exports" / "skip-trace-clean.csv"
    out_path.parent.mkdir(parents=True, exist_ok=True)

    with open(out_path, "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=["Address", "City", "State", "Zip"])
        writer.writeheader()
        writer.writerows(clean)

    print(f"\nSaved to: {out_path}")
    print(f"Ready for PropStream import")

if __name__ == "__main__":
    main()
