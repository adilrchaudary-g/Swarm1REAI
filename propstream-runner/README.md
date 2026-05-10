# PropStream Runner

Autonomous Playwright-based PropStream acquisition runner that preserves the Hermes v4 envelope contract while replacing the browser-embedded Tampermonkey execution path.

This is the preferred direction when you want PropStream harvesting to be filesystem-first instead of Discord-first. It can still speak Hermes when you want orchestration, but it can also run direct authenticated harvests and write leads into the repo's on-disk lead vault without Discord in the loop.

## What it does

- Launches and owns a dedicated Chromium profile for PropStream
- Can seed that profile from the local Google Chrome user-data tree when you want to inherit saved browser state
- Polls Hermes for `SEARCH`, `SAVE`, `EXPORT`, `SKIP_TRACE`, `QUOTA_CHECK`, `HALT`, `RESUME`, and `PING`
- Injects an in-page helper bridge for compact page-state snapshots and semantic actions
- Uses deterministic automation first, then a bounded supervisor for safe recovery
- Preserves quota guardrails, operator-hour gates, and PII redaction rules

## Commands

- `npm run bootstrap-auth`
  - Opens a headed browser and waits for a usable authenticated PropStream session, then saves storage state
- `npm start -- seed-profile-from-chrome`
  - Copies the local Google Chrome user-data tree into the runner profile so Chrome-channel launches can reuse saved browser state
- `npm start`
  - Starts the long-running runner
- `npm start -- harvest-zip <zip> <listName> [maxSkipTraces]`
  - Runs a direct authenticated harvest against PropStream, then archives results into a recursive on-disk structure
- `npm test`
  - Runs unit and integration tests, including repeated browser-backed acquisition cycles against a PropStream-like mock target

## Environment

Set these before running against Hermes:

- `HERMES_POLL_URL`
- `HERMES_EVENT_URL`
- `HERMES_HEARTBEAT_URL`
- `HERMES_AUTH_TYPE`
- `HERMES_AUTH_TOKEN`
- `PROPSTREAM_BASE_URL`

Optional:

- `PROPSTREAM_HEADLESS=true|false`
- `PROPSTREAM_BROWSER_CHANNEL=chromium|chrome`
- `PROPSTREAM_ALLOW_NATIVE_KEYCHAIN=true|false`
- `PROPSTREAM_CHROME_USER_DATA_DIR=/Users/<you>/Library/Application Support/Google/Chrome`
- `SUPERVISOR_MODE=rule-based|openai`
- `OPENAI_API_KEY`
- `OPENAI_MODEL`
- `PROPSTREAM_ARCHIVE_ROOT`
- `DISCORD_COMMANDS_WEBHOOK`
- `DISCORD_RESULTS_WEBHOOK`
- `DISCORD_QUOTA_WEBHOOK`
- `DISCORD_ALFRED_WEBHOOK`

## Runtime artifacts

The runner writes persistent profile data, downloads, traces, screenshots, and state into `propstream-runner/.runtime/`. That directory is gitignored because it may contain sensitive runtime artifacts.

Harvested lead data is separate from runner runtime state. By default it is written into:

- `/Users/adilchaudary/Desktop/wholesaling-swarm/lead-vault/acquisition/propstream/`

Override this with `PROPSTREAM_ARCHIVE_ROOT` if you want the archive elsewhere.

## Auth strategy on macOS

For real PropStream runs on macOS, the preferred path is:

1. `PROPSTREAM_BROWSER_CHANNEL=chrome`
2. `PROPSTREAM_ALLOW_NATIVE_KEYCHAIN=true`
3. `npm start -- seed-profile-from-chrome`
4. `npm run bootstrap-auth`

That combination avoids Playwright's default `--use-mock-keychain` launch flag so the Chrome channel can access the native `Chrome Safe Storage` keychain entry when available.

## Archive layout

Harvest output is written into the configured archive root:

- `runs/<run-id>/manifest.json`
- `runs/<run-id>/query/query.json`
- `runs/<run-id>/pages/page-0001.json`
- `runs/<run-id>/raw-exports/<list>.json`
- `properties/<state>/<zip>/<property-id>/property.json`
- `properties/<state>/<zip>/<property-id>/contacts.json`
- `indexes/by-state/<state>.ndjson`
- `indexes/by-zip/<zip>.ndjson`
- `indexes/by-list/<list>.ndjson`
