from __future__ import annotations

import re
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any


def _slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")


@dataclass
class HarvestManifest:
    source_type: str
    source_name: str
    harvest_date: str
    geography: str
    record_count: int
    data_quality_tier: str
    acquisition_method: str
    raw_file_paths: list[str] = field(default_factory=list)
    metadata: dict[str, Any] = field(default_factory=dict)


LEAD_SCAFFOLD_DEFAULTS = {
    "apn": None,
    "slug": "",
    "address_street": None,
    "address_city": None,
    "address_state": None,
    "address_zip": None,
    "address_full": None,
    "county": "",
    "property_type": None,
    "bedrooms": None,
    "bathrooms": None,
    "sqft": None,
    "lot_sqft": None,
    "year_built": None,
    "assessed_value": None,
    "last_sale_date": None,
    "last_sale_price": None,
    "total_open_loans": None,
    "est_remaining_balance": None,
    "est_value": None,
    "est_ltv": None,
    "est_equity": None,
    "total_condition": None,
    "interior_condition": None,
    "exterior_condition": None,
    "bathroom_condition": None,
    "kitchen_condition": None,
    "foreclosure_factor": None,
    "mls_status": None,
    "mls_date": None,
    "mls_amount": None,
    "lien_amount": None,
    "owner_name": None,
    "owner_occupied": None,
    "mailing_address": None,
    "mailing_state": None,
    "do_not_mail": None,
    "litigator": None,
    "phones": [],
    "callable_phones": [],
    "emails": [],
    "distress_signals": [],
    "source_list": "",
    "date_added": None,
    "skip_traces": None,
    "source_type": "",
    "data_quality_tier": "",
    "needs_skip_trace": True,
    "source_metadata": {},
}


class SourceAdapter(ABC):

    @property
    @abstractmethod
    def source_type(self) -> str:
        ...

    @property
    @abstractmethod
    def source_name(self) -> str:
        ...

    @property
    @abstractmethod
    def data_quality_tier(self) -> str:
        ...

    @abstractmethod
    def parse(self, harvest_dir: Path) -> tuple[list[dict], HarvestManifest]:
        ...

    def validate_lead(self, lead: dict) -> bool:
        return bool(lead.get("apn") or lead.get("address_street"))

    def build_lead_scaffold(self, **known_fields) -> dict:
        scaffold = {}
        for k, v in LEAD_SCAFFOLD_DEFAULTS.items():
            if isinstance(v, list):
                scaffold[k] = list(v)
            elif isinstance(v, dict):
                scaffold[k] = dict(v)
            else:
                scaffold[k] = v

        scaffold["source_type"] = self.source_type
        scaffold["data_quality_tier"] = self.data_quality_tier
        scaffold.update(known_fields)

        if scaffold["address_street"]:
            scaffold["slug"] = _slug(scaffold["address_street"])
        elif scaffold["apn"]:
            scaffold["slug"] = _slug(scaffold["apn"])

        scaffold["address_full"] = ", ".join(
            p for p in [
                scaffold["address_street"],
                scaffold["address_city"],
                scaffold["address_state"],
                scaffold["address_zip"],
            ] if p
        )
        scaffold["needs_skip_trace"] = len(scaffold["callable_phones"]) == 0
        return scaffold
