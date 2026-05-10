from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from .base import SourceAdapter

_REGISTRY: dict[str, type[SourceAdapter]] = {}


def register_source(adapter_cls: type[SourceAdapter]) -> type[SourceAdapter]:
    instance = adapter_cls()
    _REGISTRY[instance.source_type] = adapter_cls
    return adapter_cls


def get_adapter(source_type: str) -> SourceAdapter:
    if source_type not in _REGISTRY:
        available = ", ".join(sorted(_REGISTRY.keys()))
        raise ValueError(f"Unknown source type: {source_type}. Registered: [{available}]")
    return _REGISTRY[source_type]()


def list_sources() -> list[str]:
    return sorted(_REGISTRY.keys())
