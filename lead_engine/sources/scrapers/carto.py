"""Scraper for CARTO SQL API portals (Philadelphia)."""

from __future__ import annotations

import json
import urllib.request
import urllib.parse
from datetime import datetime, timedelta
from typing import Any


def fetch_carto(
    base_url: str,
    table_name: str,
    *,
    date_field: str = "",
    days_back: int = 30,
    limit: int = 5000,
    extra_where: str = "",
) -> list[dict[str, Any]]:
    clauses = []
    if date_field and days_back > 0:
        cutoff = (datetime.utcnow() - timedelta(days=days_back)).strftime("%Y-%m-%d")
        clauses.append(f"{date_field} >= '{cutoff}'")
    if extra_where:
        clauses.append(extra_where)

    where = " AND ".join(clauses) if clauses else "1=1"
    sql = f"SELECT * FROM {table_name} WHERE {where} LIMIT {limit}"

    params = {"q": sql, "format": "json"}
    url = f"{base_url}?{urllib.parse.urlencode(params)}"
    print(f"  CARTO    {url[:120]}...")

    req = urllib.request.Request(url, headers={"Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=60) as resp:
        data = json.loads(resp.read().decode("utf-8"))

    rows = data.get("rows", [])
    print(f"  CARTO    {len(rows)} records fetched")
    return rows
