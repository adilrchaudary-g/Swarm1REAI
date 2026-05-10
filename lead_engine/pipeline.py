import json
from pathlib import Path
from .config import PIPELINE_DIR, DEFAULT_TOP_N
from .intake import run_intake
from .enrich import run_enrich
from .score import run_score
from .classify import run_classify
from .route import run_route
from .rank import run_rank
from .queue import build_queue
from .sources import get_adapter


def run_pipeline(harvest_dir: Path, top_n: int = DEFAULT_TOP_N) -> Path:
    manifest_path = harvest_dir / "manifest.json"
    with open(manifest_path) as f:
        manifest = json.load(f)
    harvest_date = manifest.get("harvest_date", harvest_dir.name)

    print(f"\n{'='*60}")
    print(f"PIPELINE {manifest.get('county', '')} — {harvest_date}")
    print(f"{'='*60}\n")

    leads = run_intake(harvest_dir)
    total_intake = len(leads)

    leads = run_enrich(leads)
    total_enriched = len(leads)

    leads = run_classify(leads)
    leads = run_score(leads)

    proceed, review, dead = run_route(leads)
    top, rest = run_rank(proceed, top_n=top_n)

    queue_dir = PIPELINE_DIR / "queue" / harvest_date
    csv_path = build_queue(
        top_leads=top,
        review_leads=review,
        dead_leads=dead,
        total_intake=total_intake,
        total_enriched=total_enriched,
        queue_dir=queue_dir,
        harvest_date=harvest_date,
    )

    _write_intake_manifest(leads, harvest_date, total_intake)
    _write_dead(dead, harvest_date)

    print(f"\n{'='*60}")
    print(f"DONE     Open: {csv_path}")
    print(f"{'='*60}\n")
    return csv_path


def run_multi_pipeline(harvest_dirs: list, top_n: int = DEFAULT_TOP_N, label: str = None) -> Path:
    from datetime import date as date_cls
    all_leads = []
    total_intake = 0
    counties = []

    for harvest_dir in harvest_dirs:
        harvest_dir = Path(harvest_dir)
        manifest_path = harvest_dir / "manifest.json"
        with open(manifest_path) as f:
            manifest = json.load(f)
        counties.append(manifest.get("county", harvest_dir.parent.name))
        leads = run_intake(harvest_dir)
        total_intake += len(leads)
        all_leads.extend(leads)

    harvest_date = label or date_cls.today().isoformat()
    region_label = label or "-".join(c.split(",")[0].strip().lower().replace(" ", "-") for c in counties[:3])
    if len(counties) > 3:
        region_label += f"-+{len(counties)-3}"

    print(f"\n{'='*60}")
    print(f"MULTI-PIPELINE {len(counties)} counties — {region_label}")
    print(f"  Counties: {', '.join(counties)}")
    print(f"{'='*60}\n")

    leads = run_enrich(all_leads)
    total_enriched = len(leads)

    leads = run_classify(leads)
    leads = run_score(leads)

    proceed, review, dead = run_route(leads)
    top, rest = run_rank(proceed, top_n=top_n)

    queue_dir = PIPELINE_DIR / "queue" / region_label
    csv_path = build_queue(
        top_leads=top,
        review_leads=review,
        dead_leads=dead,
        total_intake=total_intake,
        total_enriched=total_enriched,
        queue_dir=queue_dir,
        harvest_date=harvest_date,
    )

    print(f"\n{'='*60}")
    print(f"DONE     Open: {csv_path}")
    print(f"{'='*60}\n")
    return csv_path


def run_source_pipeline(harvest_dir: Path, top_n: int = DEFAULT_TOP_N) -> Path:
    """Route a harvest through its source adapter, then the standard pipeline."""
    manifest_path = harvest_dir / "manifest.json"
    with open(manifest_path) as f:
        manifest = json.load(f)

    source_type = manifest.get("source_type", "propstream")
    harvest_date = manifest.get("harvest_date", harvest_dir.name)

    print(f"\n{'='*60}")
    print(f"PIPELINE [{source_type}] {manifest.get('county', manifest.get('geography', ''))} — {harvest_date}")
    print(f"{'='*60}\n")

    adapter = get_adapter(source_type)
    leads, harvest_manifest = adapter.parse(harvest_dir)
    total_intake = len(leads)

    leads = run_enrich(leads)
    total_enriched = len(leads)

    leads = run_classify(leads)
    leads = run_score(leads)

    proceed, review, dead = run_route(leads)
    top, rest = run_rank(proceed, top_n=top_n)

    queue_dir = PIPELINE_DIR / "queue" / harvest_date
    csv_path = build_queue(
        top_leads=top,
        review_leads=review,
        dead_leads=dead,
        total_intake=total_intake,
        total_enriched=total_enriched,
        queue_dir=queue_dir,
        harvest_date=harvest_date,
    )

    _write_intake_manifest(leads, harvest_date, total_intake)
    _write_dead(dead, harvest_date)

    print(f"\n{'='*60}")
    print(f"DONE     Open: {csv_path}")
    print(f"{'='*60}\n")
    return csv_path


def run_multi_source_pipeline(
    harvest_dirs: list[Path],
    top_n: int = DEFAULT_TOP_N,
    label: str = None,
) -> Path:
    """Run pipeline across multiple harvest dirs from any source type."""
    from datetime import date as date_cls

    all_leads = []
    total_intake = 0
    sources_seen = []

    for harvest_dir in harvest_dirs:
        harvest_dir = Path(harvest_dir)
        manifest_path = harvest_dir / "manifest.json"
        with open(manifest_path) as f:
            manifest = json.load(f)

        source_type = manifest.get("source_type", "propstream")
        geo = manifest.get("county", manifest.get("geography", harvest_dir.parent.name))
        sources_seen.append(f"{source_type}:{geo}")

        adapter = get_adapter(source_type)
        leads, _ = adapter.parse(harvest_dir)
        total_intake += len(leads)
        all_leads.extend(leads)

    harvest_date = label or date_cls.today().isoformat()
    region_label = label or "-".join(s.split(":")[0] for s in sources_seen[:3])
    if len(sources_seen) > 3:
        region_label += f"-+{len(sources_seen)-3}"

    print(f"\n{'='*60}")
    print(f"MULTI-SOURCE PIPELINE {len(sources_seen)} harvests — {region_label}")
    print(f"  Sources: {', '.join(sources_seen)}")
    print(f"{'='*60}\n")

    leads = run_enrich(all_leads)
    total_enriched = len(leads)

    leads = run_classify(leads)
    leads = run_score(leads)

    proceed, review, dead = run_route(leads)
    top, rest = run_rank(proceed, top_n=top_n)

    queue_dir = PIPELINE_DIR / "queue" / region_label
    csv_path = build_queue(
        top_leads=top,
        review_leads=review,
        dead_leads=dead,
        total_intake=total_intake,
        total_enriched=total_enriched,
        queue_dir=queue_dir,
        harvest_date=harvest_date,
    )

    print(f"\n{'='*60}")
    print(f"DONE     Open: {csv_path}")
    print(f"{'='*60}\n")
    return csv_path


def _write_intake_manifest(leads: list[dict], harvest_date: str, total: int):
    intake_dir = PIPELINE_DIR / "intake" / harvest_date
    intake_dir.mkdir(parents=True, exist_ok=True)
    manifest = {
        "harvest_date": harvest_date,
        "total_intake": total,
        "unique_enriched": len(leads),
    }
    with open(intake_dir / "_manifest.json", "w") as f:
        json.dump(manifest, f, indent=2)


def _write_dead(dead: list[dict], harvest_date: str):
    done_dir = PIPELINE_DIR / "done" / harvest_date / "dead"
    done_dir.mkdir(parents=True, exist_ok=True)
    for lead in dead:
        slug = lead.get("slug", lead.get("apn", "unknown"))
        with open(done_dir / f"{slug}.json", "w") as f:
            json.dump({
                "apn": lead.get("apn"),
                "address": lead.get("address_full"),
                "router_decision": "dead",
                "router_reason": lead.get("router_reason"),
                "gates_failed": lead.get("gates_failed"),
                "est_value": lead.get("est_value"),
                "property_type": lead.get("property_type"),
            }, f, indent=2, default=str)
