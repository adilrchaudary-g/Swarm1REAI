#!/usr/bin/env python3
"""Re-run Phase 3+4: Ingest code violations from existing CSVs + report."""

import json
import os
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent
sys.path.insert(0, str(REPO))

# Import the pipeline module
from pipeline_monday_scrape import phase3_ingest_code_violations, phase4_report

BLOCKED_STATES = {"SC", "IL", "OK", "KY", "PA", "VA", "NC", "NE", "NY"}

# Reconstruct scrape results from today's CSVs on disk
cv_dir = REPO / "lead-vault" / "acquisition" / "code-violations"
today = "2026-05-18"
results = []

for city_dir in sorted(cv_dir.iterdir()):
    if not city_dir.is_dir():
        continue
    today_dir = city_dir / today
    if not today_dir.is_dir():
        continue
    manifest_path = today_dir / "manifest.json"
    if not manifest_path.exists():
        continue
    with open(manifest_path) as f:
        manifest = json.load(f)

    # Skip blocked states
    state = manifest.get("state", "")
    if state in BLOCKED_STATES:
        print(f"  SKIP (blocked state {state}): {manifest.get('geography', city_dir.name)}")
        continue

    csv_files = list(today_dir.glob("*.csv"))
    if not csv_files:
        continue

    results.append({
        "portal": manifest.get("portal_id", ""),
        "name": manifest.get("geography", city_dir.name),
        "status": "ok",
        "count": manifest.get("record_count", 0),
        "csv_path": str(csv_files[0]),
        "harvest_dir": str(today_dir),
    })

print(f"Found {len(results)} portals with today's data:")
for r in results:
    print(f"  {r['name']}: {r['count']} leads")

# Run Phase 3
cv_stats = phase3_ingest_code_violations(results)

# Run Phase 4
total = phase4_report()
