from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

from .store import HermesStore


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Hermes local PropStream store")
    parser.add_argument(
        "--root",
        default=str(Path(__file__).resolve().parent),
        help="Hermes workspace root. Defaults to ./hermes",
    )
    parser.add_argument(
        "--format",
        choices=("json", "text"),
        default="json",
        help="Output format for query commands",
    )

    subparsers = parser.add_subparsers(dest="command", required=True)

    subparsers.add_parser("init", help="Initialize the local SQLite store")

    ingest_parser = subparsers.add_parser("ingest", help="Ingest a bridge envelope")
    ingest_parser.add_argument("--file", help="Path to an envelope JSON file")
    ingest_parser.add_argument(
        "--export-csv",
        help="Optional raw export CSV file to persist as an artifact for EXPORT results",
    )

    enqueue_parser = subparsers.add_parser("enqueue", help="Queue a bridge command envelope")
    enqueue_parser.add_argument("--file", required=True, help="Path to a command envelope JSON file")

    lead_parser = subparsers.add_parser("lead", help="Find lead records")
    lead_parser.add_argument("term")
    lead_parser.add_argument("--limit", type=int, default=10)

    owner_parser = subparsers.add_parser("owner", help="Find owner records")
    owner_parser.add_argument("term")
    owner_parser.add_argument("--limit", type=int, default=10)

    property_parser = subparsers.add_parser("property", help="Find property records")
    property_parser.add_argument("term")
    property_parser.add_argument("--limit", type=int, default=10)

    queue_parser = subparsers.add_parser("queue", help="Show queue views")
    queue_parser.add_argument("kind", nargs="?", choices=("hot", "all"), default="hot")
    queue_parser.add_argument("--limit", type=int, default=25)

    outstanding_parser = subparsers.add_parser("outstanding", help="Show outstanding work")
    outstanding_parser.add_argument(
        "kind",
        choices=("skip-trace", "underwrite", "bridge"),
    )
    outstanding_parser.add_argument("--limit", type=int, default=25)

    event_parser = subparsers.add_parser("event", help="Show a raw bridge event")
    event_parser.add_argument("message_id")

    subparsers.add_parser("quota", help="Show the latest quota snapshot")

    discord_ref_parser = subparsers.add_parser(
        "record-discord-ref",
        help="Record a Discord reference tied to a lead or event",
    )
    discord_ref_parser.add_argument("--guild-id")
    discord_ref_parser.add_argument("--channel-id")
    discord_ref_parser.add_argument("--thread-id")
    discord_ref_parser.add_argument("--message-id", required=True)
    discord_ref_parser.add_argument("--lead-id")
    discord_ref_parser.add_argument("--event-message-id")
    discord_ref_parser.add_argument("--query-text")

    serve_parser = subparsers.add_parser("serve", help="Run the Hermes HTTP runtime")
    serve_parser.add_argument("--host", default="0.0.0.0")
    serve_parser.add_argument("--port", type=int, default=8765)
    serve_parser.add_argument(
        "--static-dir",
        default=None,
        help="Path to dashboard dist/ directory for static file serving. "
             "Auto-detected from ../dashboard/dist if not specified.",
    )

    discord_command_parser = subparsers.add_parser(
        "discord-command",
        help="Handle a Discord-style command text against the local store",
    )
    discord_command_parser.add_argument("text")
    discord_command_parser.add_argument("--guild-id")
    discord_command_parser.add_argument("--channel-id")
    discord_command_parser.add_argument("--thread-id")
    discord_command_parser.add_argument("--message-id")

    return parser


def _read_envelope(path: str | None) -> dict[str, Any]:
    if path:
        return json.loads(Path(path).read_text(encoding="utf-8"))
    return json.load(sys.stdin)


def _print_output(value: Any, output_format: str) -> None:
    if output_format == "json":
        print(json.dumps(value, indent=2, sort_keys=True))
        return

    if isinstance(value, dict):
        for key, item in value.items():
            print(f"{key}: {item}")
        return

    if isinstance(value, list):
        for item in value:
            print(json.dumps(item, indent=2, sort_keys=True))
        return

    print(value)


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    store = HermesStore(Path(args.root))

    if args.command == "init":
        result = store.initialize()
    elif args.command == "ingest":
        envelope = _read_envelope(args.file)
        result = store.ingest_envelope(envelope, export_csv_path=args.export_csv)
    elif args.command == "enqueue":
        envelope = _read_envelope(args.file)
        result = store.enqueue_command(envelope)
    elif args.command == "lead":
        result = store.query_leads(args.term, limit=args.limit)
    elif args.command == "owner":
        result = store.query_owners(args.term, limit=args.limit)
    elif args.command == "property":
        result = store.query_properties(args.term, limit=args.limit)
    elif args.command == "queue":
        result = store.query_queue(args.kind, limit=args.limit)
    elif args.command == "outstanding":
        result = store.query_outstanding(args.kind, limit=args.limit)
    elif args.command == "event":
        result = store.get_event(args.message_id)
    elif args.command == "quota":
        result = store.get_latest_quota()
    elif args.command == "record-discord-ref":
        result = store.record_discord_ref(
            guild_id=args.guild_id,
            channel_id=args.channel_id,
            thread_id=args.thread_id,
            message_id=args.message_id,
            lead_id=args.lead_id,
            event_message_id=args.event_message_id,
            query_text=args.query_text,
        )
    elif args.command == "discord-command":
        result = store.handle_discord_command(
            text=args.text,
            guild_id=args.guild_id,
            channel_id=args.channel_id,
            thread_id=args.thread_id,
            message_id=args.message_id,
        )
    elif args.command == "serve":
        from .server import HermesRuntime

        static_dir = Path(args.static_dir) if args.static_dir else None
        runtime = HermesRuntime(Path(args.root), static_dir=static_dir)
        runtime.serve_forever(host=args.host, port=args.port)
        return 0
    else:
        parser.error(f"Unsupported command {args.command}")
        return 2

    _print_output(result, args.format)
    return 0
