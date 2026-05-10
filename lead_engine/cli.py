import argparse
import json
import sys
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(prog="lead_engine", description="Lead Engine Pipeline")
    sub = parser.add_subparsers(dest="command")

    run_p = sub.add_parser("run", help="Run pipeline on a harvest directory")
    run_p.add_argument("--harvest", required=True, action="append", help="Path to harvest directory (repeat for multiple)")
    run_p.add_argument("--top", type=int, default=50, help="Number of top leads to queue (default: 50)")
    run_p.add_argument("--label", default=None, help="Custom label for merged output dir")

    scan_p = sub.add_parser("scan", help="Scan for new harvests and process them")
    scan_p.add_argument("--top", type=int, default=50, help="Number of top leads per harvest")

    watch_p = sub.add_parser("watch", help="Watch for new harvests and auto-process")
    watch_p.add_argument("--interval", type=int, default=30, help="Scan interval in seconds")
    watch_p.add_argument("--top", type=int, default=50, help="Number of top leads per harvest")

    sub.add_parser("sources", help="List registered source adapters")

    args = parser.parse_args()

    if args.command == "run":
        harvest_dirs = [Path(h).resolve() for h in args.harvest]
        for d in harvest_dirs:
            if not (d / "manifest.json").exists():
                print(f"ERROR: No manifest.json in {d}")
                sys.exit(1)

        first_manifest = json.loads((harvest_dirs[0] / "manifest.json").read_text())
        has_source_type = "source_type" in first_manifest

        if len(harvest_dirs) == 1:
            if has_source_type:
                from .pipeline import run_source_pipeline
                run_source_pipeline(harvest_dirs[0], top_n=args.top)
            else:
                from .pipeline import run_pipeline
                run_pipeline(harvest_dirs[0], top_n=args.top)
        else:
            if has_source_type:
                from .pipeline import run_multi_source_pipeline
                run_multi_source_pipeline(harvest_dirs, top_n=args.top, label=args.label)
            else:
                from .pipeline import run_multi_pipeline
                run_multi_pipeline(harvest_dirs, top_n=args.top, label=args.label)

    elif args.command == "scan":
        from .pipeline import run_source_pipeline, run_pipeline
        from .watcher import find_new_harvests, mark_processed
        new = find_new_harvests()
        if not new:
            print("SCAN     No new harvests found")
            return
        print(f"SCAN     Found {len(new)} new harvest(s)")
        for harvest_dir in new:
            try:
                manifest = json.loads((harvest_dir / "manifest.json").read_text())
                if "source_type" in manifest:
                    run_source_pipeline(harvest_dir, top_n=args.top)
                else:
                    run_pipeline(harvest_dir, top_n=args.top)
                mark_processed(harvest_dir)
            except Exception as e:
                print(f"ERROR    {harvest_dir}: {e}")

    elif args.command == "watch":
        from .pipeline import run_source_pipeline
        from .watcher import watch
        from functools import partial
        fn = partial(run_source_pipeline, top_n=args.top)
        watch(interval=args.interval, run_pipeline=fn)

    elif args.command == "sources":
        from .sources import list_sources, get_adapter
        sources = list_sources()
        print(f"Registered source adapters ({len(sources)}):\n")
        for src_id in sources:
            adapter = get_adapter(src_id)
            print(f"  {src_id:<20} {adapter.source_name:<25} quality={adapter.data_quality_tier}")

    else:
        parser.print_help()
