"""Scraper for Socrata SODA API portals (Cincinnati, Dallas, Austin)."""

from __future__ import annotations

import json
import urllib.request
import urllib.parse
from datetime import datetime, timedelta
from typing import Any


def fetch_socrata(
    base_url: str,
    dataset_id: str,
    *,
    status_filter: str = "",
    date_field: str = "",
    days_back: int = 30,
    limit: int = 5000,
) -> list[dict[str, Any]]:
    endpoint = f"{base_url}/resource/{dataset_id}.json"

    clauses = []
    if status_filter:
        clauses.append(status_filter)
    if date_field and days_back > 0:
        cutoff = (datetime.utcnow() - timedelta(days=days_back)).strftime("%Y-%m-%dT00:00:00")
        clauses.append(f"{date_field} > '{cutoff}'")

    where = " AND ".join(clauses) if clauses else "1=1"

    params = {
        "$where": where,
        "$limit": str(limit),
        "$order": f"{date_field} DESC" if date_field else ":id",
    }

    url = f"{endpoint}?{urllib.parse.urlencode(params)}"
    print(f"  SOCRATA  {url[:120]}...")

    req = urllib.request.Request(url, headers={"Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=60) as resp:
        data = json.loads(resp.read().decode("utf-8"))

    print(f"  SOCRATA  {len(data)} records fetched")
    return data
