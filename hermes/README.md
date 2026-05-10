# Hermes

Hermes is the orchestrator/backend behind Alfred. This folder now includes the first local state layer for PropStream bridge data: a SQLite store, a queryable CLI, and tests for ingestion/search behavior.

## What Hermes is

Hermes is the operator-facing runtime that:

- receives PropStream bridge events
- stores them locally on disk as the source of truth
- projects raw bridge outputs into searchable lead/property/owner state
- answers workspace and Discord-surface queries from local state, not from chat history

The bridge still emits `lane: "houses"` for forward compatibility with future additional lanes.

## What is implemented here

- `python3 -m hermes init`
  - creates `hermes/data/propstream.db`
  - creates `hermes/data/artifacts/exports/`
  - enables SQLite WAL mode
- `python3 -m hermes ingest --file /path/to/envelope.json`
  - stores the raw bridge envelope
  - projects canonical property/owner/lead state
- `python3 -m hermes enqueue --file /path/to/command-envelope.json`
  - queues a bridge command for `/bridge/poll`
- `python3 -m hermes ingest --file /path/to/export-result.json --export-csv /path/to/export.csv`
  - stores the raw export artifact on disk
  - records the artifact path in SQLite
  - projects export rows into canonical state
- `python3 -m hermes serve --host 127.0.0.1 --port 8765`
  - runs a local Hermes HTTP runtime
  - exposes `GET /bridge/poll`
  - exposes `POST /bridge/events`
  - exposes `POST /bridge/heartbeat`
  - exposes `POST /commands`
  - exposes `POST /discord/command`
- Query commands:
  - `python3 -m hermes lead "<term>"`
  - `python3 -m hermes owner "<term>"`
  - `python3 -m hermes property "<term>"`
  - `python3 -m hermes queue [hot|all]`
  - `python3 -m hermes outstanding [skip-trace|underwrite|bridge]`
  - `python3 -m hermes event <message_id>`
  - `python3 -m hermes quota`
- Discord context recording:
  - `python3 -m hermes record-discord-ref --message-id ... --lead-id ...`
- Discord command emulation:
  - `python3 -m hermes discord-command "@alfred lead Jane Seller" --message-id msg-1`

Global flags go before the subcommand, for example:

```bash
python3 -m hermes --root /Users/adilchaudary/Desktop/wholesaling-swarm/hermes lead "Jane Seller"
```

## Storage model

The store is hybrid:

- raw bridge events for replay/debugging
- projected canonical tables for fast queries
- FTS-backed lead search for agent-friendly lookup

Important tables:

- `bridge_events`
- `bridge_artifacts`
- `command_queue`
- `properties`
- `owners`
- `owner_phones`
- `owner_emails`
- `leads`
- `lead_status_history`
- `quota_snapshots`
- `discord_refs`

Important views:

- `v_outstanding_leads`
- `v_hot_queue`
- `v_needs_skip_trace`
- `v_needs_underwrite`
- `v_open_bridge_issues`

## Runtime wiring

The userscript can point directly at the local runtime:

- poll URL: `http://127.0.0.1:8765/bridge/poll`
- event URL: `http://127.0.0.1:8765/bridge/events`
- heartbeat URL: `http://127.0.0.1:8765/bridge/heartbeat`

Manual examples:

```bash
python3 -m hermes --root /Users/adilchaudary/Desktop/wholesaling-swarm/hermes serve --port 8765
curl -s http://127.0.0.1:8765/bridge/poll?lane=houses
curl -s -X POST http://127.0.0.1:8765/discord/command \
  -H 'Content-Type: application/json' \
  -d '{"text":"@alfred quota","message_id":"demo-1"}'
```

## Testing

Run:

```bash
python3 -m unittest discover -s hermes/tests -v
```
