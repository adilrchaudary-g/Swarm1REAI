from __future__ import annotations

import csv
import json
from pathlib import Path

from .base import HarvestManifest, SourceAdapter
from .registry import register_source


DEFAULT_COLUMN_MAP = {
    "address": "address_street",
    "street": "address_street",
    "property_address": "address_street",
    "city": "address_city",
    "state": "address_state",
    "zip": "address_zip",
    "zipcode": "address_zip",
    "zip_code": "address_zip",
    "parcel": "apn",
    "parcel_number": "apn",
    "apn": "apn",
    "owner": "owner_name",
    "owner_name": "owner_name",
    "property_owner": "owner_name",
    "violation_type": "_violation_type",
    "violation_date": "_violation_date",
    "status": "_violation_status",
    "case_number": "_case_number",
    "county": "county",
}


def _normalize_key(key: str) -> str:
    return key.strip().lower().replace(" ", "_").replace("-", "_")


@register_source
class CodeViolationsAdapter(SourceAdapter):

    @property
    def source_type(self) -> str:
        return "code_violations"

    @property
    def source_name(self) -> str:
        return "Code Violations"

    @property
    def data_quality_tier(self) -> str:
        return "PARTIAL"

    def parse(self, harvest_dir: Path) -> tuple[list[dict], HarvestManifest]:
        manifest_path = harvest_dir / "manifest.json"
        with open(manifest_path) as f:
            raw_manifest = json.load(f)

        column_map = raw_manifest.get("column_map", {})
        if not column_map:
            column_map = DEFAULT_COLUMN_MAP

        geography = raw_manifest.get("geography", raw_manifest.get("municipality", harvest_dir.parent.name))
        county = raw_manifest.get("county", geography)

        data_files = raw_manifest.get("files", [])
        if not data_files:
            data_files = [f.name for f in harvest_dir.iterdir() if f.suffix == ".csv"]

        leads = []
        raw_paths = []
        for filename in data_files:
            filepath = harvest_dir / filename
            raw_paths.append(str(filepath))
            if not filepath.exists():
                continue

            with open(filepath, "r", newline="") as fh:
                reader = csv.DictReader(fh)
                for row in reader:
                    lead = self._parse_row(row, column_map, county)
                    if self.validate_lead(lead):
                        leads.append(lead)

        manifest = HarvestManifest(
            source_type=self.source_type,
            source_name=self.source_name,
            harvest_date=raw_manifest.get("harvest_date", harvest_dir.name),
            geography=geography,
            record_count=len(leads),
            data_quality_tier=self.data_quality_tier,
            acquisition_method=raw_manifest.get("acquisition_method", "csv_upload"),
            raw_file_paths=raw_paths,
            metadata=raw_manifest,
        )

        print(f"INTAKE   {len(leads)} rows from {self.source_name} ({geography})")
        return leads, manifest

    def _parse_row(self, row: dict, column_map: dict, county: str) -> dict:
        mapped = {}
        source_meta = {}

        for raw_key, value in row.items():
            normalized = _normalize_key(raw_key)
            canonical = column_map.get(normalized) or column_map.get(raw_key)
            if not canonical:
                canonical = DEFAULT_COLUMN_MAP.get(normalized)

            if canonical and canonical.startswith("_"):
                source_meta[canonical.lstrip("_")] = (value or "").strip()
            elif canonical:
                mapped[canonical] = (value or "").strip()

        return self.build_lead_scaffold(
            apn=mapped.get("apn"),
            address_street=mapped.get("address_street"),
            address_city=mapped.get("address_city"),
            address_state=mapped.get("address_state"),
            address_zip=mapped.get("address_zip"),
            county=mapped.get("county", county),
            owner_name=mapped.get("owner_name"),
            distress_signals=["code_violation"],
            source_list="code-violations",
            source_metadata=source_meta,
        )
