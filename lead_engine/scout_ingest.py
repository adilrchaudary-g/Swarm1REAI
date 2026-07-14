"""Ingest bulk-scout results into the county catalog.

Merges propstream-runner bulk-scout results.json files into
lead_engine/data/us_counties.json so scouted_score() can rank markets.

Safety rules:
- Entries with an error or no scouted_at are skipped (failed scouts must be
  re-run, never ingested as zeros).
- Entries flagged suspect (stale count read, or a signal count exceeding ~40%
  of county population) are skipped and reported for re-scouting.
- Newer scouted_at always wins over older data for the same county.

Usage:
    python3 -m lead_engine.scout_ingest <results.json> [<results.json> ...]
    python3 -m lead_engine.scout_ingest --report   # print top markets only
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

from .county_catalog import _DATA_PATH, load_counties

SIGNAL_FIELDS = {
    "pre_foreclosure": "pre_foreclosure_count",
    "tax_delinquent": "tax_delinquent_count",
    "probate": "probate_count",
}


def ingest(results_paths: list[Path]) -> dict:
    with open(_DATA_PATH) as f:
        catalog = json.load(f)
    by_fips = {r["fips"]: r for r in catalog}

    stats = {"ingested": 0, "skipped_failed": 0, "skipped_suspect": 0, "skipped_older": 0, "unknown_fips": 0}
    suspects: list[str] = []

    for path in results_paths:
        for entry in json.load(open(path)):
            fips = entry.get("fips")
            record = by_fips.get(fips)
            if record is None:
                stats["unknown_fips"] += 1
                continue
            if entry.get("error") or not entry.get("scouted_at"):
                stats["skipped_failed"] += 1
                continue
            if entry.get("suspect"):
                stats["skipped_suspect"] += 1
                suspects.append(entry.get("search_term", fips))
                continue
            if record.get("scouted_at") and record["scouted_at"] >= entry["scouted_at"]:
                stats["skipped_older"] += 1
                continue

            signals = {s["signal"]: s["count"] for s in entry.get("signals", [])}
            for signal, field in SIGNAL_FIELDS.items():
                if signal in signals:
                    record[field] = signals[signal]
            record["total_distressed"] = entry.get(
                "total_distressed", sum(signals.values())
            )
            record["scouted_at"] = entry["scouted_at"]
            stats["ingested"] += 1

    with open(_DATA_PATH, "w") as f:
        json.dump(catalog, f, indent=1)

    if suspects:
        print(f"SUSPECT (not ingested, re-scout these): {', '.join(suspects)}")
    return stats


def report(top_n: int = 50) -> None:
    scouted = [c for c in load_counties() if c.scouted_at]
    ranked = sorted(scouted, key=lambda c: c.scouted_score(), reverse=True)
    print(f"{len(scouted)} counties scouted. Top {min(top_n, len(ranked))} markets by scouted_score:")
    for c in ranked[:top_n]:
        print(
            f"  {c.scouted_score():3d}  {c.search_term:<32} "
            f"pf={c.pre_foreclosure_count or 0:<7} tax={c.tax_delinquent_count or 0:<7} "
            f"pb={c.probate_count or 0:<6} total={c.total_distressed or 0}"
        )


def main() -> None:
    args = [a for a in sys.argv[1:] if a != "--report"]
    if args:
        stats = ingest([Path(a) for a in args])
        print(json.dumps(stats))
    report()


if __name__ == "__main__":
    main()
