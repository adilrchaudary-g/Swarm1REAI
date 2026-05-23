#!/usr/bin/env python3
"""Monday Pipeline: Scrape PropStream + Code Violations → 4,000 lead call list.

Phase 1: Queue top 2,000 PropStream enriched leads (already have phones)
Phase 2: Scrape code violations from all non-blocked portals
Phase 3: Ingest code violations into DB, cross-reference with PropStream leads
Phase 4: Report final call list stats
"""

import json
import os
import re
import sqlite3
import sys
import uuid
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

REPO = Path(__file__).resolve().parent
sys.path.insert(0, str(REPO))

_STREET_ABBREVS = {
    "street": "st", "saint": "st", "avenue": "ave", "boulevard": "blvd",
    "drive": "dr", "court": "ct", "place": "pl", "lane": "ln",
    "road": "rd", "circle": "cir", "terrace": "ter", "trail": "trl",
    "way": "wy", "parkway": "pkwy", "highway": "hwy",
    "north": "n", "south": "s", "east": "e", "west": "w",
    "northeast": "ne", "northwest": "nw", "southeast": "se", "southwest": "sw",
    "apartment": "apt", "suite": "ste", "building": "bldg", "floor": "fl",
}

def _normalize_address(addr: str) -> str:
    addr = addr.lower().strip()
    addr = re.sub(r"[.,#\-/]", " ", addr)
    addr = re.sub(r"\s+", " ", addr)
    parts = addr.split()
    parts = [_STREET_ABBREVS.get(p, p) for p in parts]
    return "".join(parts)

DB_PATH = REPO / "hermes" / "data" / "propstream.db"
BLOCKED_STATES = {"SC", "IL", "OK", "KY", "PA", "VA", "NC", "NE", "NY"}

def now_iso():
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()

def connect():
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    return conn

# ═══════════════════════════════════════════════════════════════════
# PHASE 1: Queue top 2,000 PropStream leads
# ═══════════════════════════════════════════════════════════════════

def phase1_queue_propstream():
    print("\n" + "=" * 70)
    print("PHASE 1: Queue top 2,000 PropStream leads")
    print("=" * 70)

    conn = connect()
    ts = now_iso()

    # Select best 2,000 enriched PropStream leads with phones
    # Priority: triple distress > double > single > none
    # Then by motivation_score DESC
    rows = conn.execute("""
        SELECT l.lead_id, l.distress_signals_json, l.motivation_score, l.motivation_tier,
               p.address_state,
               (SELECT COUNT(*) FROM owner_phones op WHERE op.owner_id = l.owner_id) as phone_count
        FROM leads l
        JOIN properties p ON p.property_id = l.property_id
        WHERE l.source = 'propstream'
          AND l.status = 'enriched'
          AND (SELECT COUNT(*) FROM owner_phones op WHERE op.owner_id = l.owner_id) > 0
          AND p.address_state NOT IN ({blocked})
        ORDER BY
            CASE
                WHEN l.distress_signals_json LIKE '%nod_filed%'
                     AND l.distress_signals_json LIKE '%probate%'
                     AND l.distress_signals_json LIKE '%tax%' THEN 0
                WHEN l.distress_signals_json LIKE '%nod_filed%'
                     AND (l.distress_signals_json LIKE '%probate%'
                          OR l.distress_signals_json LIKE '%tax%') THEN 1
                WHEN l.distress_signals_json LIKE '%nod_filed%' THEN 2
                WHEN l.distress_signals_json LIKE '%probate%'
                     OR l.distress_signals_json LIKE '%tax%' THEN 3
                WHEN l.distress_signals_json != '[]' THEN 4
                ELSE 5
            END,
            COALESCE(l.motivation_score, 0) DESC,
            phone_count DESC
        LIMIT 2000
    """.format(blocked=",".join(f"'{s}'" for s in BLOCKED_STATES))).fetchall()

    if not rows:
        print("  ERROR: No enriched PropStream leads with phones found!")
        conn.close()
        return 0

    # Update status to queued
    lead_ids = [r["lead_id"] for r in rows]
    queued = 0
    for lid in lead_ids:
        conn.execute(
            "UPDATE leads SET status = 'queued', updated_at = ? WHERE lead_id = ?",
            (ts, lid),
        )
        queued += 1

    conn.commit()

    # Stats
    states = Counter(r["address_state"] for r in rows)
    tiers = Counter(r["motivation_tier"] for r in rows)
    signals = Counter()
    for r in rows:
        try:
            sigs = json.loads(r["distress_signals_json"] or "[]")
            for s in sigs:
                signals[s] += 1
        except:
            pass

    total_phones = sum(r["phone_count"] for r in rows)
    with_signals = sum(1 for r in rows if r["distress_signals_json"] != "[]")

    print(f"  QUEUED   {queued} PropStream leads")
    print(f"  PHONES   {total_phones} total phone records")
    print(f"  SIGNALS  {with_signals} leads with distress signals")
    print(f"  STATES   {dict(states.most_common(10))}")
    print(f"  TIERS    {dict(tiers)}")
    print(f"  TOP SIG  {dict(signals.most_common(5))}")

    conn.close()
    return queued


# ═══════════════════════════════════════════════════════════════════
# PHASE 2: Scrape code violations from non-blocked portals
# ═══════════════════════════════════════════════════════════════════

def phase2_scrape_code_violations():
    print("\n" + "=" * 70)
    print("PHASE 2: Scrape code violations (non-blocked states)")
    print("=" * 70)

    from lead_engine.sources.scrapers.runner import scrape_all_portals
    from lead_engine.sources.scrapers.portals import PORTALS

    # Filter to non-blocked states
    allowed_ids = [p["id"] for p in PORTALS if p["state"] not in BLOCKED_STATES]
    blocked_ids = [p["id"] for p in PORTALS if p["state"] in BLOCKED_STATES]

    print(f"  ALLOWED  {len(allowed_ids)} portals: {', '.join(allowed_ids)}")
    print(f"  BLOCKED  {len(blocked_ids)} portals: {', '.join(blocked_ids)}")

    # Scrape with expanded lookback (90 days) and high limit to maximize leads
    results = scrape_all_portals(
        days_back=90,
        limit=10000,
        portal_ids=allowed_ids,
    )

    ok = [r for r in results if r.get("status") == "ok"]
    total = sum(r.get("count", 0) for r in ok)

    print(f"\n  RESULTS  {len(ok)}/{len(allowed_ids)} portals OK")
    for r in results:
        status = r.get("status", "?")
        count = r.get("count", 0)
        name = r.get("name", r.get("portal", "?"))
        print(f"    {status.upper():8s} {name}: {count} leads")

    print(f"  TOTAL    {total} code violation leads scraped")
    return results


# ═══════════════════════════════════════════════════════════════════
# PHASE 3: Ingest code violations into DB
# ═══════════════════════════════════════════════════════════════════

def phase3_ingest_code_violations(scrape_results):
    print("\n" + "=" * 70)
    print("PHASE 3: Ingest code violations into DB")
    print("=" * 70)

    import csv as csv_mod

    conn = connect()
    ts = now_iso()

    total_ingested = 0
    total_stacked = 0
    total_new = 0
    total_deduped = 0

    for r in scrape_results:
        if r.get("status") != "ok" or not r.get("csv_path"):
            continue

        csv_path = Path(r["csv_path"])
        if not csv_path.exists():
            continue

        portal_name = r.get("name", r.get("portal", "?"))

        with open(csv_path, "r") as f:
            reader = csv_mod.DictReader(f)
            all_rows = list(reader)

        portal_new = 0
        portal_stacked = 0
        portal_deduped = 0

        for row in all_rows:
            addr_street = (row.get("address_street") or "").strip()
            city = (row.get("city") or "").strip()
            state = (row.get("state") or "").strip()
            zipcode = (row.get("zip") or "").strip()
            county = (row.get("county") or "").strip()

            if not addr_street or not city:
                continue

            street_norm = _normalize_address(addr_street)
            city_norm = city.replace(" ", "").lower()

            # Check if address already exists in DB (use street number prefix for SQL narrowing)
            first_token = addr_street.split()[0].lower() if addr_street.split() else ""
            candidates = conn.execute("""
                SELECT l.lead_id, l.distress_signals_json, l.status, l.owner_id,
                       p.address_street,
                       (SELECT COUNT(*) FROM owner_phones op WHERE op.owner_id = l.owner_id) as phone_count
                FROM leads l
                JOIN properties p ON p.property_id = l.property_id
                WHERE LOWER(REPLACE(p.address_city, ' ', '')) = ?
                  AND LOWER(REPLACE(p.address_street, ' ', '')) LIKE ?
            """, (city_norm, f"%{first_token}%")).fetchall()
            existing = None
            for c in candidates:
                if _normalize_address(c["address_street"]) == street_norm:
                    existing = c
                    break

            if existing:
                signals = []
                try:
                    signals = json.loads(existing["distress_signals_json"] or "[]")
                except:
                    pass

                if "code_violation" not in signals:
                    signals.append("code_violation")
                    # If this lead was archived, re-activate it if it has phones
                    new_status = existing["status"]
                    if existing["status"] == "archived" and existing["phone_count"] > 0:
                        new_status = "queued"

                    conn.execute(
                        "UPDATE leads SET distress_signals_json = ?, status = ?, updated_at = ? WHERE lead_id = ?",
                        (json.dumps(signals), new_status, ts, existing["lead_id"]),
                    )
                    portal_stacked += 1
                else:
                    portal_deduped += 1
                continue

            # New address — create lead record
            addr_full = ", ".join(p for p in [addr_street, city, state, zipcode] if p)
            prop_token = addr_full.lower().replace(" ", "-").replace(",", "")
            property_id = f"cv:{prop_token}"
            owner_id = f"cv:{prop_token}:unknown"
            lead_id = f"{property_id}:{owner_id}"

            # Create property
            lat = row.get("latitude")
            lon = row.get("longitude")
            conn.execute("""
                INSERT OR IGNORE INTO properties (
                    property_id, lane, address_full, address_street, address_city,
                    address_state, address_zip, latitude, longitude,
                    updated_at
                ) VALUES (?, 'houses', ?, ?, ?, ?, ?, ?, ?, ?)
            """, (property_id, addr_full, addr_street, city, state, zipcode,
                  float(lat) if lat else None, float(lon) if lon else None,
                  ts))

            # Create owner
            conn.execute("""
                INSERT OR IGNORE INTO owners (
                    owner_id, property_id, owner_name, updated_at
                ) VALUES (?, ?, ?, ?)
            """, (owner_id, property_id, "", ts))

            # Create lead
            conn.execute("""
                INSERT OR IGNORE INTO leads (
                    lead_id, property_id, owner_id, source, status,
                    distress_signals_json, created_at, updated_at
                ) VALUES (?, ?, ?, 'code_violations', 'new', ?, ?, ?)
            """, (lead_id, property_id, owner_id,
                  json.dumps(["code_violation"]), ts, ts))

            portal_new += 1

        total_stacked += portal_stacked
        total_new += portal_new
        total_deduped += portal_deduped
        total_ingested += len(all_rows)

        print(f"  {portal_name}: {portal_new} new, {portal_stacked} stacked, {portal_deduped} deduped")

    conn.commit()

    # Stage new leads for verification
    batch_id = f"cv-monday-{uuid.uuid4().hex[:8]}"
    new_leads = conn.execute("""
        SELECT l.lead_id, p.address_street, p.address_city, p.address_state, p.address_zip
        FROM leads l
        JOIN properties p ON p.property_id = l.property_id
        WHERE l.source = 'code_violations' AND l.status = 'new'
        AND l.lead_id LIKE 'cv:%'
    """).fetchall()

    if new_leads:
        for nl in new_leads:
            conn.execute("""
                INSERT OR IGNORE INTO pending_verification (
                    source, address_street, address_city, address_state,
                    address_zip, owner_name, source_ref, batch_id,
                    status, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
            """, ("code_violations", nl["address_street"], nl["address_city"],
                  nl["address_state"], nl["address_zip"], "", "", batch_id, ts))
        conn.commit()

    conn.close()

    print(f"\n  SUMMARY:")
    print(f"    Total processed:  {total_ingested}")
    print(f"    New leads:        {total_new}")
    print(f"    Stacked on existing: {total_stacked}")
    print(f"    Deduped:          {total_deduped}")
    print(f"    Staged for verification: {len(new_leads)}")

    return {
        "total_ingested": total_ingested,
        "new": total_new,
        "stacked": total_stacked,
        "deduped": total_deduped,
        "staged": len(new_leads),
    }


# ═══════════════════════════════════════════════════════════════════
# PHASE 4: Final report
# ═══════════════════════════════════════════════════════════════════

def phase4_report():
    print("\n" + "=" * 70)
    print("PHASE 4: Final Call List Report")
    print("=" * 70)

    conn = connect()

    # Queued leads breakdown
    queued = conn.execute("""
        SELECT l.source, COUNT(*) as cnt,
               SUM(CASE WHEN (SELECT COUNT(*) FROM owner_phones op WHERE op.owner_id = l.owner_id) > 0 THEN 1 ELSE 0 END) as with_phones
        FROM leads l
        WHERE l.status = 'queued'
        GROUP BY l.source
    """).fetchall()

    print("\n  QUEUED LEADS (ready to call):")
    total_queued = 0
    total_with_phones = 0
    for row in queued:
        print(f"    {row['source']:20s} {row['cnt']:5d} leads ({row['with_phones']} with phones)")
        total_queued += row["cnt"]
        total_with_phones += row["with_phones"]

    # All leads by status
    by_status = conn.execute("""
        SELECT status, source, COUNT(*) as cnt
        FROM leads
        GROUP BY status, source
        ORDER BY status, source
    """).fetchall()

    print(f"\n  ALL LEADS BY STATUS:")
    for row in by_status:
        print(f"    {row['status']:15s} {row['source']:20s} {row['cnt']:5d}")

    # Code violation leads needing skip-trace
    cv_no_phone = conn.execute("""
        SELECT COUNT(*) as cnt FROM leads l
        WHERE l.source = 'code_violations'
          AND l.status IN ('new', 'queued')
          AND (SELECT COUNT(*) FROM owner_phones op WHERE op.owner_id = l.owner_id) = 0
    """).fetchone()

    # Dual-source leads (PropStream + code_violations signal)
    dual = conn.execute("""
        SELECT COUNT(*) as cnt FROM leads l
        WHERE l.status = 'queued'
          AND l.distress_signals_json LIKE '%code_violation%'
    """).fetchone()

    pending = conn.execute("SELECT COUNT(*) as cnt FROM pending_verification WHERE status = 'pending'").fetchone()

    print(f"\n  CALL LIST SUMMARY:")
    print(f"    Total queued:               {total_queued}")
    print(f"    With phone numbers:         {total_with_phones}")
    print(f"    Dual-source (PS+CV):        {dual['cnt']}")
    print(f"    CV needing skip-trace:      {cv_no_phone['cnt']}")
    print(f"    Pending verification:       {pending['cnt']}")

    conn.close()
    return total_queued


# ═══════════════════════════════════════════════════════════════════
# MAIN
# ═══════════════════════════════════════════════════════════════════

if __name__ == "__main__":
    print("=" * 70)
    print(f"MONDAY PIPELINE — {datetime.now().strftime('%Y-%m-%d %H:%M')}")
    print(f"Target: 2,000 PropStream + 2,000 Code Violations")
    print("=" * 70)

    # Phase 1: Queue PropStream leads
    ps_count = phase1_queue_propstream()

    # Phase 2: Scrape code violations
    scrape_results = phase2_scrape_code_violations()

    # Phase 3: Ingest into DB
    cv_stats = phase3_ingest_code_violations(scrape_results)

    # Phase 4: Report
    total = phase4_report()

    print("\n" + "=" * 70)
    print("PIPELINE COMPLETE")
    print("=" * 70)
