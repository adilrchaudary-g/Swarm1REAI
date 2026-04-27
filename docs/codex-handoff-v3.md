# Codex Handoff — TamperMonkey × Swarm × PropStream (v3)

**To:** Codex
**From:** Adil (operator) + Claude (architect)
**Date:** April 26, 2026
**Version:** 3.0 — supersedes v2
**Goal:** Build a TamperMonkey userscript that turns PropStream's web app into a remote-controllable interface for the Swarm.

**What changed since v2:**
- Server restructured by pipeline stage (00 → 05) instead of houses-vs-land lane split. Land is fully retired from scope.
- Hermes is self-hosted on the operator's Mac (not a friend's machine). Bot is named **Alfred** (Discord handle `@alfred`).
- New dedicated category `04-propstream-bridge` with three channels: `#propstream-commands`, `#propstream-results`, `#propstream-quota`.
- All `house-*` channel prefixes were removed from Discord channel names, but the bridge still explicitly belongs to the `houses` lane and retains lane-scope checks for future additional lanes.
- Operator command channel renamed `#ai-hq` → `#alfred`.

---

## 1. Mission brief

You are joining a project mid-flight. The operator (Adil) is building an autonomous virtual wholesaling system — software that scouts, scores, and qualifies single-family-residence wholesale deals across the U.S. without him driving every step manually. The architecture is a swarm of specialized AI agents organized by **pipeline stage** (market intel → lead engine → underwriting → propstream bridge → build), coordinated through a Discord-based operating layer powered by a self-hosted orchestrator bot named **Alfred** (Discord handle `@alfred`). Alfred runs locally on the operator's Mac and exposes an HTTP endpoint. Internally the orchestrator codebase is called Hermes; "Alfred" is the running instance the operator interacts with.

The data engine is PropStream Pro. PropStream does not expose a customer-facing API at the Pro tier, so the bridge between the Swarm and PropStream is a TamperMonkey userscript running in the operator's browser. **That userscript is what you're building.**

You are the "hands" of the Swarm inside PropStream for the `houses` lane. The Swarm has a brain (the agents), a nervous system (Hermes routing messages), and a memory (the data schema). What it doesn't have is hands inside PropStream. You're those hands.

If you're a game design person reading this: the Swarm is the AI director, Hermes is the input router, the userscript is the input controller wired into PropStream.

---

## 2. Background you need

### 2.1 The operator's profile

- National virtual wholesaling, SFR detached only
- Price band: $200k–$400k sweet spot, $150k–$500k acceptable
- Assignment fee target: $20k floor, $25–50k typical
- Buyer pool already solved (do not build buyer-side modules)
- Account: PropStream Pro, $199/month, 50,000 saves / 50,000 exports / 50,000 skip traces / 50,000 monitored properties per month, resets May 22

### 2.2 The Swarm architecture

The Discord server "adils demo agent home" is organized into six numbered categories. Each category represents a pipeline stage, and the numbering is intentional — `00` is the operator's command surface, `01–04` are the operational pipeline in flow order, `05` is dev/build infra.

**00-command-center** — operator command surface
| Channel | Role |
|---|---|
| `#alfred` | Primary Hermes command channel. Operator mentions the bot here. Set-home is set to this channel. |
| `#ops-log` | Operational event log |
| `#announcements` | Cross-cutting announcements |

**01-market-intel** — find the battlefield
| Channel | Role |
|---|---|
| `#market-selector` | Zip code ranking with regulatory blocklist |
| `#distress-monitoring` | Distress signal ingestion |
| `#list-builder` | SFR candidate extraction in target zips |

**02-lead-engine** — turn raw candidates into qualified leads
| Channel | Role |
|---|---|
| `#opportunity-intake` | Lead lifecycle entry point |
| `#lead-enrichment` | Skip trace + record completion |
| `#seller-motivation` | Motivation scoring (0–100) |
| `#seller-persona` | Persona classification |
| `#seller-response-triage` | Inbound response handling |
| `#strategy-router` | Four-gate filter |
| `#follow-up-orchestrator` | Cadence and re-engagement |
| `#queue` | Priority queue sorted by motivation |

**03-underwriting** — price the deals
| Channel | Role |
|---|---|
| `#fast-underwriting` | MAO + ARV + repair confidence |
| `#kpi-intelligence` | Dashboards and reporting |
| `#done-feed` | Closed/dead lead archive |

**04-propstream-bridge** — your channels for the `houses` lane
| Channel | Role |
|---|---|
| `#propstream-commands` | Hermes → userscript inbound mirror (audit only) |
| `#propstream-results` | Userscript → Hermes outbound mirror (audit only, PII-redacted) |
| `#propstream-quota` | Usage dashboard + threshold alerts |

**05-build** — dev infrastructure (operator side, not yours)
| Channel | Role |
|---|---|
| `#hermes-dev` | Hermes development |
| `#swarm-dev` | Swarm-level changes |
| `#automation` | Automation scripts |
| `#bugs` | Bug tracking |

### 2.2.1 The lane scoping rule (still required)

Even though houses is the only active lane today, the PropStream bridge still belongs to the `houses` lane. This is deliberate future-proofing.

- **Inbound commands must still carry `lane: "houses"`**. If a future lane is added and a command arrives with a different lane, reject it as `OUT_OF_LANE_SCOPE`.
- **Operator override from `#alfred` supersedes lane concerns for HALT/RESUME.** Those commands are always honored.
- **All emitted records remain tagged `lane: "houses"`** so future routing rules do not need a protocol break when another lane returns.

### 2.3 The agent framework (your inputs)

The userscript will be told what to do by the Swarm based on the following logic chain. You don't implement any of this — it lives upstream — but commands you receive will reference these concepts.

**Regulatory pre-filter** (`#market-selector`). Zips in these states are excluded entirely: SC, IL, OK, KY, PA, VA. Zips in these states are deprioritized: CT, OR, MD, AZ, CA, IA, TN, IN, WI, ND. The Swarm will never tell you to operate in a blocked state. If you somehow receive a command targeting a blocked-state zip, reject as `INVALID_COMMAND` with reason "regulatory blocklist" — defense in depth.

**Zip ranking** (`#market-selector`). Top 50 zips ranked weekly. You receive a target zip + filter set per command.

**Router gates** (`#strategy-router`). Before any expensive operation (save, skip trace), the lead must pass: SFR detached, ARV $150k–$500k, spread supports $20k+ fee, motivation score above threshold. If you receive a SAVE or SKIP_TRACE command, the lead has already cleared these.

**Motivation score** (`#seller-motivation`). 0–100, computed from distress urgency (0.35), financial pressure (0.25), life event (0.15), engagement (0.15), condition deterioration (0.10), with a freshness decay factor.

**Underwriting** (`#fast-underwriting`). MAO formula: `(ARV × discount_factor) − repairs − assignment_fee − holding_costs`. Confidence = min of ARV / repair / freshness sub-scores.

### 2.4 The launch plan you're plugging into

Per-month soft caps that the userscript must respect:

| Operation | PropStream cap | Swarm soft cap |
|---|---|---|
| Saves | 50,000 | 42,000 |
| Exports | 50,000 | 40,000 |
| Skip traces | 50,000 | 40,000 |
| Monitored properties | 50,000 | 45,000 |

**Halt thresholds:** at 70% of any quota → warning posted to `#propstream-quota` and `#alfred`. At 85% → switch to high-confidence-only mode (Swarm-side filtering). At 95% → operator/Swarm sends HALT command for that operation type.

---

## 3. Your specific task

Build a TamperMonkey userscript (`propstream-swarm-bridge.user.js`) that:

1. Runs on PropStream's web app pages.
2. Connects to Hermes's HTTP endpoint as the primary command channel.
3. Mirrors all activity to the dedicated bridge channels (`#propstream-commands`, `#propstream-results`, `#propstream-quota`) for audit/observability.
4. Receives structured commands: SEARCH, SAVE, EXPORT, SKIP_TRACE, MONITOR, QUOTA_CHECK, HALT, RESUME, PING.
5. Executes each command by interacting with the PropStream UI (DOM manipulation, simulated clicks, form fills, navigation).
6. Extracts results (property records, owner data, skip-trace returns, current quota counters) from the PropStream UI.
7. Reports results back to Hermes (HTTP) and mirrors to Discord (results channel).
8. Tracks local quota state and refuses to execute commands that would exceed soft caps, even if instructed.
9. Surfaces errors (DOM not found, session expired, rate-limited, captcha) cleanly so the Swarm can react.
10. Provides a kill-switch the operator can trigger from `#alfred`.

You are not building the Swarm. You are not building agents. You are not building Hermes. You are not building the data schema (it exists — see Section 7). You are building the bridge.

---

## 4. Architecture decisions

### 4.1 Decided

- **Userscript host:** TamperMonkey (Chrome). Operator runs the script in their daily-driver browser session, which means the script inherits an authenticated PropStream session — no credentials in the script.
- **Primary transport (both directions):** Hermes HTTP endpoint, running locally on the operator's Mac. Operator will provide the endpoint URL + authentication scheme on first run; you store via `GM_setValue`.
- **Audit transport (mirroring only):** Discord webhooks posting to `#propstream-commands` (inbound mirror), `#propstream-results` (outbound mirror), and `#propstream-quota` (threshold alerts). The bridge does **not** read commands from Discord — Discord is observability only. Hermes is the source of truth.
- **Data format:** JSON envelopes for all messages. UTF-8.
- **State persistence:** `GM_setValue` / `GM_getValue` for local quota counters, last-seen command ID, killswitch state, configuration.

### 4.2 The transport pattern

```
                        ┌─────────────────────┐
                        │   Pipeline agents   │
                        │  (Discord channels) │
                        └──────────┬──────────┘
                                   │
                                   ▼
                        ┌─────────────────────┐
                        │       Hermes        │
                        │  (HTTP + Discord)   │
                        │   local on Mac      │
                        └──────────┬──────────┘
                                   │
              ┌────────────────────┼─────────────────────┐
              │ HTTP (primary)     │ Discord (mirror)    │
              ▼                    ▼                     ▼
      ┌───────────────┐   ┌──────────────────┐  ┌──────────────────┐
      │  Userscript   │   │   #propstream-   │  │   #propstream-   │
      │   (browser)   │   │     commands     │  │     results      │
      └───────┬───────┘   └──────────────────┘  └──────────────────┘
              │                                          │
              ▼                                          ▼
      ┌───────────────┐                         ┌──────────────────┐
      │   PropStream  │                         │   #propstream-   │
      │   web app     │                         │      quota       │
      └───────────────┘                         └──────────────────┘
```

The userscript polls Hermes's HTTP endpoint for commands (long-poll preferred — operator to confirm support; otherwise short-poll every 5–15s). Results POST back to Hermes synchronously. Every command received and every result sent is *also* mirrored to the corresponding Discord channel via webhook so the operator has a human-readable trail.

### 4.3 Why mirror to Discord if Hermes is the source of truth?

Three reasons:
1. **Operator visibility.** The operator lives in Discord. He should see what's happening in real time without opening a separate dashboard.
2. **Audit immutability.** Discord channels are append-only and timestamped. If the Hermes backend ever has a state bug, the Discord trail is the recovery source.
3. **Cross-agent observability.** Other agents in the Swarm (motivation scorer, persona classifier, etc.) can subscribe to `#propstream-results` for raw lead data without needing Hermes-side coupling.

### 4.4 Open questions for the operator before you start

1. Hermes endpoint URL + auth scheme (since Hermes is local: `localhost:port` or LAN IP? Bearer token? Signed request?)
2. Does Hermes support long-polling or do we short-poll?
3. Operator timezone (for the 8am–11pm operating window) — needed for the "human-plausible hours" throttle.
4. Confirm browser is Chrome (Edge / Brave / Arc all work too).

---

## 5. The userscript skeleton

This is shape, not implementation. You write the logic.

```javascript
// ==UserScript==
// @name         PropStream × Swarm Bridge
// @namespace    swarm.wholesaling
// @version      0.1.0
// @description  Bridges the Swarm's command queue to PropStream's web UI
// @match        https://app.propstream.com/*
// @match        https://*.propstream.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addStyle
// @grant        GM_notification
// @connect      *
// @run-at       document-idle
// ==/UserScript==
```

Suggested module layout:

- `bridge.js` — main loop, command dispatch, killswitch
- `transport/`
  - `hermes.js` — HTTP client for Hermes endpoint (poll + post)
  - `discord.js` — webhook client for audit mirroring (3 channels)
- `quota.js` — local counters, threshold checks, halt enforcement
- `propstream/`
  - `search.js` — search by zip + apply filters
  - `results.js` — extract property rows from results table
  - `propertyDetail.js` — extract a single property's full record
  - `save.js` — add property/list to saved
  - `export.js` — trigger export and capture the file
  - `skipTrace.js` — initiate skip trace, capture returned contact info
  - `monitor.js` — add to monitored list
  - `quotaReader.js` — read PropStream's own quota counters
- `dom.js` — selector helpers, retry-with-backoff, mutation observers
- `protocol.js` — JSON envelope schemas, validation
- `ops/`
  - `panel.js` — small floating control panel (status, kill, manual override, config)
  - `log.js` — in-page log viewer

---

## 6. PropStream interaction map

You will need to inspect the live DOM to confirm selectors. Treat all of this as "structure, not specifics" — PropStream redesigns periodically and you should code for resilience.

### 6.1 Search flow

1. Navigate to the search/filter page.
2. Set location filter to the zip code from the command.
3. Apply filters: property type = SFR detached, price range from command, distress filters from command (pre-foreclosure, tax delinquent, vacant, code violation, probate as flagged).
4. Wait for results table to render.
5. Read total result count from results header.
6. Page through results, extracting one row at a time.

### 6.2 Property record extraction

For each result row, extract at minimum: address, parcel ID (APN), beds, baths, square feet, year built, lot size, last sale date and price, current tax assessment, owner name, owner mailing address, owner type (individual / trust / LLC / estate), distress flags. Also capture: property detail URL, any photo URLs, last MLS status.

Field name mapping is critical. The data schema (Section 7) defines the canonical field names. PropStream may call things differently. Map at the extraction layer, not later, so the rest of the pipeline only ever sees canonical names.

### 6.3 Save flow

A SAVE command targets a list of property IDs. For each:
1. Verify the property is in the current view (or navigate to it).
2. Click the save / add-to-list button.
3. If a list-picker modal appears, select the list specified in the command.
4. Confirm save succeeded (UI state change, toast notification, etc.).
5. Increment the local saves counter.
6. Report success or failure per property.

### 6.4 Export flow

EXPORT commands target a saved list. The flow:
1. Navigate to the saved list.
2. Trigger export (CSV preferred; XLSX acceptable).
3. Capture the downloaded file.
4. Parse and forward to Hermes (and mirror summary to `#propstream-results`; never mirror full PII payload to Discord).
5. Increment the local exports counter.

### 6.5 Skip trace flow

This is the most expensive and the most legally sensitive. SKIP_TRACE commands target individual properties or batches.

1. Navigate to the property (or saved list) the command targets.
2. Trigger skip trace.
3. Wait for results — skip trace can take several seconds per record.
4. Extract returned contacts: phone numbers (with type — landline / mobile / VOIP), email addresses, additional addresses, possible relatives.
5. Report each contact to Hermes (HTTP). **Do not mirror to Discord** — Discord receives only a redacted summary like `{property_id: ..., contacts_returned: 3, phone_count: 2, email_count: 1}`.
6. Increment local skip-trace counter per record processed.

**Critical:** never log skip-trace results to console at any verbosity, never write them to the page DOM beyond what's necessary to extract them, never include them in a screenshot if you build a debug screenshot feature, never mirror them to Discord channels at any verbosity. They are PII with TCPA implications. Flow: PropStream UI → in-memory variable → outbound HTTPS to Hermes → nowhere else.

### 6.6 Monitor flow

A MONITOR command tags a property for ongoing monitoring. For each property in the command, click the monitor toggle and confirm. Increment the monitored counter.

### 6.7 Quota reading

A QUOTA_CHECK command navigates to the account/usage page and reads PropStream's own counters. This is the source of truth that reconciles against your local counters. Do this:
- At script startup
- After every 50 operations of a given type
- On demand from the Swarm
- Right before any halt threshold check

If PropStream's reported number drifts more than 5% from your local counter, post a reconciliation alert to `#propstream-quota` (via webhook) and trust PropStream's number.

---

## 7. Data schema (canonical field names)

Use these exact names. The Swarm's downstream agents expect them.

### Property
`property_id, address_full, address_street, address_city, address_state, address_zip, latitude, longitude, property_type, year_built, square_feet, bedrooms, bathrooms, lot_size_sqft, last_sale_date, last_sale_price, current_tax_assessment, parcel_number`

### Owner
`owner_id, property_id, owner_name, owner_type, mailing_address, mailing_address_distance_mi, years_owned, estimated_age, phone_numbers (list), email_addresses (list)`

### Distress signals
`distress_signals` is a list of enums: `nod_filed, lis_pendens, tax_delinquent, code_violation, probate_filed, mls_expired, mls_withdrawn, utility_shutoff, usps_vacant`. Each comes with a `*_date` field where available.

### Lane tag (forward compatibility)
Every record emitted by this bridge is tagged `lane: "houses"`. Land lane is currently retired but the field stays in case it returns. Future-proofing for free.

### Lead lifecycle states
`new → enriched → underwritten → qualified → contacted → responded | no_response → negotiating → under_contract | dead → assigned → closed`

You will primarily emit `new` and `enriched` states. The Swarm transitions to later states.

---

## 8. Communication protocol

### 8.1 Message envelope (both directions)

```json
{
  "envelope_version": "1.0",
  "message_id": "uuid-v4",
  "timestamp": "ISO8601",
  "source": "swarm" | "userscript",
  "lane": "houses",
  "type": "command" | "result" | "error" | "heartbeat",
  "correlation_id": "uuid-of-command-this-responds-to-or-null",
  "payload": { ... }
}
```

### 8.2 Command types (Swarm → userscript)

- `SEARCH` — payload: `{ zip, filters, max_results }`. Returns: list of property records.
- `SAVE` — payload: `{ property_ids[], list_name }`. Returns: per-id success/fail.
- `EXPORT` — payload: `{ list_name, format }`. Returns: parsed records.
- `SKIP_TRACE` — payload: `{ property_ids[] }`. Returns: per-id contact records.
- `MONITOR` — payload: `{ property_ids[] }`. Returns: per-id success/fail.
- `QUOTA_CHECK` — payload: `{}`. Returns: current PropStream-reported quotas + local counters.
- `HALT` — payload: `{ scope: "all" | "saves" | "exports" | "skip_trace" | "monitor" }`.
- `RESUME` — payload: `{ scope }`.
- `PING` — payload: `{}`. Returns: heartbeat with version + uptime.

### 8.3 Result envelope payload

```json
{
  "command_type": "...",
  "status": "success" | "partial" | "failure",
  "items": [ ... ],
  "errors": [ { "code": "...", "message": "...", "item_ref": "..." } ],
  "quota_snapshot": {
    "saves_used": N, "saves_cap": 42000,
    "exports_used": N, "exports_cap": 40000,
    "skip_traces_used": N, "skip_traces_cap": 40000,
    "monitored_used": N, "monitored_cap": 45000
  }
}
```

Every result includes a `quota_snapshot`. The Swarm watches this to apply its own throttling.

### 8.4 Error codes (non-exhaustive starter set)

- `DOM_SELECTOR_MISSING` — element not found; PropStream may have changed
- `SESSION_EXPIRED` — operator needs to re-login
- `RATE_LIMITED` — PropStream is throttling
- `CAPTCHA_REQUIRED` — manual operator intervention needed
- `QUOTA_LOCAL_HALT` — soft cap reached, command refused
- `QUOTA_REMOTE_EXHAUSTED` — PropStream's own counter at zero
- `INVALID_COMMAND` — payload didn't validate (includes regulatory blocklist hits)
- `OUT_OF_LANE_SCOPE` — command targeted a non-houses lane
- `EXECUTION_TIMEOUT` — operation took too long
- `UNKNOWN` — fallback; include exception details

Errors that require operator attention (`SESSION_EXPIRED`, `CAPTCHA_REQUIRED`, persistent `DOM_SELECTOR_MISSING`) should also trigger a `GM_notification` so the operator notices even if they're not watching Discord.

### 8.5 Heartbeat

Every 60 seconds while idle, send a `heartbeat` envelope to Hermes with: script version, uptime, last successful command timestamp, current quota snapshot, queue depth. Mirror a compact version (one-line) to `#propstream-results` every 10 minutes — not every minute, to avoid channel spam.

---

## 9. Quota safety (must-have, not nice-to-have)

The userscript is the last line of defense before PropStream's hard cap. Even if Hermes makes a mistake and asks you to do something that would blow the budget, you refuse.

```
on every command of cost-bearing type:
  read local counter
  if local_counter + command_cost > soft_cap:
    return error QUOTA_LOCAL_HALT
  read remote counter (PropStream UI)
  if remote_counter <= 0:
    return error QUOTA_REMOTE_EXHAUSTED
  execute
  increment local counter
  if local / soft_cap crosses 70%, 85%, 95% threshold:
    emit threshold-crossing alert to Hermes AND mirror to #propstream-quota AND #alfred
```

Local counters reset at the start of each PropStream billing cycle (May 22 for the operator's account). Build in a manual reset command so the operator can flush at the right time.

---

## 10. Operational guardrails

### 10.1 DOM brittleness

PropStream is a third-party app you don't control. Every selector you write will eventually break.

- Prefer attribute-based selectors over class-name selectors.
- Wrap every selector lookup in a retry-with-backoff helper that waits up to 10 seconds for the element to appear.
- On `DOM_SELECTOR_MISSING`, fall back to a "page snapshot" mode: capture the page's outer HTML structure (sanitized — no PII), post it to `#alfred`, halt the relevant operation. Operator can adjust selectors in `SELECTORS.md` and resume.

### 10.2 Anti-automation

PropStream may detect aggressive automation and rate-limit, captcha, or suspend.

- Throttle. Insert randomized 1.5–4.5 second delays between actions in a batch.
- Don't run 24/7. Operate during human-plausible hours (operator timezone, 8am–11pm).
- Honor any UI-level rate-limit indicators.
- If a captcha appears, do not attempt to solve. Halt, notify, wait for operator.

### 10.3 Session management

The userscript inherits the operator's logged-in session. If the session expires mid-batch, fail cleanly and alert. Do not attempt to log in programmatically.

### 10.4 Idempotency

Some commands may be retried by Hermes if a previous attempt's result didn't make it back. Build idempotency keys: a SAVE on an already-saved property is a no-op success. A SKIP_TRACE on a property whose data was returned within the last 24 hours can return the cached result without burning quota.

---

## 11. Security and ops

- **Hermes endpoint URL + auth token:** stored via `GM_setValue`, never in source. Operator sets via floating control panel on first run.
- **Discord webhook URLs:** stored via `GM_setValue`. Operator creates webhooks for the three bridge channels and pastes URLs into the panel.
- **PII handling:** skip-trace results never go to console, never go to the page DOM beyond what's necessary to extract them, never get stored in `GM_setValue`, never get mirrored to Discord. They flow: PropStream UI → in-memory variable → HTTPS to Hermes. Period.
- **Killswitch:** operator posts `@alfred kill-bridge` in `#alfred`. Hermes forwards a HALT/all command. The userscript receives it, sets a master kill flag in `GM_setValue`, refuses all further commands until `RESUME/all`. Kill flag survives page reloads.
- **Audit log:** every command received and every result sent gets a one-line entry in a local rolling log (last 1,000 entries, stored via `GM_setValue`). PII redacted. Operator can dump from the control panel.
- **Version reporting:** include script version in every heartbeat and result.
- **ToS reality check:** PropStream's terms generally restrict automated access. The operator is aware. The script's design — running in the operator's authenticated browser session, throttled to human-plausible rates, executing only the operator's normal workflow — keeps the footprint minimal. Don't add features that escalate this risk profile.

---

## 12. Testing path

Build in this order. Don't skip steps.

1. **Skeleton + heartbeat.** Userscript loads on PropStream, posts heartbeat to Hermes (HTTP) every 60s, mirrors compact heartbeat to `#propstream-results` every 10min. No PropStream interaction yet. Verify both channels receive heartbeats.
2. **Quota reader.** Implement only `QUOTA_CHECK`. Read PropStream's own counters from the usage page. Verify against the operator's account screenshot.
3. **Search + extract, dry run.** `SEARCH` command for a known zip. Extract first 10 results. Verify field mapping against canonical schema.
4. **Single property save.** `SAVE` command on one property. Verify it appears in PropStream's saved list and the local counter incremented by 1.
5. **Single property skip trace.** `SKIP_TRACE` on one property. Verify return shape, verify counter increment, **verify nothing leaks to console or Discord**.
6. **Batch operations (10 items).** Run small batches end-to-end. Verify error handling on partial failures.
7. **Quota threshold simulation.** Manually set local counter near 70%, 85%, 95%. Verify alerts fire to Hermes, `#propstream-quota`, and `#alfred`.
8. **Lane discipline test.** Send a command with `lane: "land"` and verify `OUT_OF_LANE_SCOPE` rejection without any PropStream interaction.
9. **Killswitch.** Verify HALT/all stops everything within 5 seconds and RESUME unsticks it.
10. **Session-expiry recovery.** Manually expire the session in another tab. Verify clean error.
11. **First live batch.** 5 zips, ~50 saves total, ~25 skip traces. Operator watches in real-time. Stop at any anomaly.

Only after step 11 passes cleanly should the Swarm be allowed to drive at full target volume.

---

## 13. Deliverables

1. `propstream-swarm-bridge.user.js` — the userscript itself, ready to install in TamperMonkey.
2. `README.md` — install instructions, first-run setup (Hermes endpoint, auth token, three webhook URLs, operator timezone), control panel walkthrough, troubleshooting.
3. `PROTOCOL.md` — JSON envelope schema, command/result types, error codes. Reference doc for whoever maintains the Hermes side.
4. `SELECTORS.md` — every PropStream DOM selector, with description and fallback strategy. Updated when PropStream redesigns.
5. `TEST_CHECKLIST.md` — testing path from Section 12 as a runnable checklist.
6. Optional but recommended: a 60-second screen recording of one full SEARCH → SAVE → SKIP_TRACE cycle.

---

## 14. What "done" looks like

The operator posts in `#alfred`:

> `@alfred run market-selector → top 5 zips → list builder dry run`

Hermes dispatches commands to the userscript via HTTP. The userscript executes a SEARCH per zip, returns result counts via HTTP, and mirrors a summary to `#propstream-results`. The summary surfaces in `#kpi-intelligence` via Hermes routing. Operator approves. Hermes dispatches SAVE, SKIP_TRACE, and MONITOR commands. The userscript executes and reports. Quota counters update. Skip-trace PII goes only to Hermes, never to Discord. Nothing crashes. Operator goes to sleep, wakes up, and there are 200 new qualified leads in `#queue` ranked by motivation, ready to act on.

That's the system. You're building the part that makes it possible.

Good luck. Ask questions early.
