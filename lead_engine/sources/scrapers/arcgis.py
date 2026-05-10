"""Scraper for ArcGIS REST API portals (Cleveland, Fort Worth)."""

from __future__ import annotations

import json
import urllib.request
import urllib.parse
from datetime import datetime, timedelta
from typing import Any


def fetch_arcgis(
    base_url: str,
    *,
    where_filter: str = "1=1",
    date_field: str = "",
    days_back: int = 30,
    limit: int = 5000,
) -> list[dict[str, Any]]:
    where = where_filter if where_filter and where_filter != "1=1" else "1=1"

    all_records: list[dict] = []
    offset = 0
    page_size = min(limit, 2000)

    while len(all_records) < limit:
        params = {
            "where": where,
            "outFields": "*",
            "f": "json",
            "resultRecordCount": str(page_size),
            "resultOffset": str(offset),
            "orderByFields": f"{date_field} DESC" if date_field else "",
        }

        url = f"{base_url}/query?{urllib.parse.urlencode(params)}"
        if offset == 0:
            print(f"  ARCGIS   {url[:120]}...")

        req = urllib.request.Request(url, headers={"Accept": "application/json"})
        with urllib.request.urlopen(req, timeout=60) as resp:
            data = json.loads(resp.read().decode("utf-8"))

        features = data.get("features", [])
        if not features:
            break

        for feat in features:
            attrs = feat.get("attributes", {})
            geo = feat.get("geometry", {})
            if geo:
                attrs["_latitude"] = geo.get("y")
                attrs["_longitude"] = geo.get("x")
            all_records.append(attrs)

        if len(features) < page_size:
            break
        offset += page_size

    print(f"  ARCGIS   {len(all_records)} records fetched")
    return all_records
