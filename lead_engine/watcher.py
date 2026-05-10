import json
import time
from pathlib import Path
from .config import ACQUISITION_DIR, PIPELINE_DIR


STATE_FILE = PIPELINE_DIR / "_processed_harvests.json"


def _load_processed() -> set:
    if STATE_FILE.exists():
        with open(STATE_FILE) as f:
            return set(json.load(f))
    return set()


def _save_processed(processed: set):
    STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(STATE_FILE, "w") as f:
        json.dump(sorted(processed), f, indent=2)


def find_new_harvests() -> list[Path]:
    processed = _load_processed()
    new = []
    if not ACQUISITION_DIR.exists():
        return new

    for source_dir in sorted(ACQUISITION_DIR.iterdir()):
        if not source_dir.is_dir():
            continue
        for geo_dir in sorted(source_dir.iterdir()):
            if not geo_dir.is_dir():
                continue
            for date_dir in sorted(geo_dir.iterdir()):
                if not date_dir.is_dir():
                    continue
                manifest = date_dir / "manifest.json"
                if manifest.exists():
                    key = str(date_dir.relative_to(ACQUISITION_DIR))
                    if key not in processed:
                        new.append(date_dir)
    return new


def mark_processed(harvest_dir: Path):
    processed = _load_processed()
    key = str(harvest_dir.relative_to(ACQUISITION_DIR))
    processed.add(key)
    _save_processed(processed)


def watch(interval: int = 30, run_pipeline=None):
    print(f"WATCH    Scanning {ACQUISITION_DIR} every {interval}s for new harvests...")
    while True:
        new = find_new_harvests()
        if new:
            for harvest_dir in new:
                print(f"\nWATCH    New harvest detected: {harvest_dir.name}")
                if run_pipeline:
                    try:
                        run_pipeline(harvest_dir)
                        mark_processed(harvest_dir)
                    except Exception as e:
                        print(f"ERROR    Pipeline failed for {harvest_dir}: {e}")
                else:
                    print(f"         (dry run — no pipeline function provided)")
                    mark_processed(harvest_dir)
        time.sleep(interval)
