from __future__ import annotations

import json
from pathlib import Path

from .base import HarvestManifest, SourceAdapter
from .registry import register_source
from ..intake import run_intake


@register_source
class PropStreamAdapter(SourceAdapter):

    @property
    def source_type(self) -> str:
        return "propstream"

    @property
    def source_name(self) -> str:
        return "PropStream"

    @property
    def data_quality_tier(self) -> str:
        return "FULL"

    def parse(self, harvest_dir: Path) -> tuple[list[dict], HarvestManifest]:
        manifest_path = harvest_dir / "manifest.json"
        with open(manifest_path) as f:
            raw_manifest = json.load(f)

        leads = run_intake(harvest_dir)

        for lead in leads:
            lead["source_type"] = self.source_type
            lead["data_quality_tier"] = self.data_quality_tier
            lead["needs_skip_trace"] = len(lead.get("callable_phones", [])) == 0
            lead["source_metadata"] = {}

        manifest = HarvestManifest(
            source_type=self.source_type,
            source_name=self.source_name,
            harvest_date=raw_manifest.get("harvest_date", harvest_dir.name),
            geography=raw_manifest.get("county", harvest_dir.parent.name),
            record_count=len(leads),
            data_quality_tier=self.data_quality_tier,
            acquisition_method="browser_automation",
            raw_file_paths=[
                str(harvest_dir / info["file"])
                for info in raw_manifest.get("signals", {}).values()
            ],
            metadata=raw_manifest,
        )
        return leads, manifest
