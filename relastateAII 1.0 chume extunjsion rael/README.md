# PropStream x Swarm Bridge

This repo currently ships the Houses-lane TamperMonkey bridge described in the April 26, 2026 handoff. The bridge runs inside the operator's authenticated PropStream browser session, polls Hermes over HTTP for commands, mirrors activity to Discord for auditability, and executes UI actions inside PropStream.

## Files

- `propstream-swarm-bridge.user.js`: installable TamperMonkey userscript.
- `PROTOCOL.md`: Hermes-facing envelope and command contract.
- `SELECTORS.md`: selector catalog and fallback expectations.
- `TEST_CHECKLIST.md`: operator test path.

## Install

1. Install TamperMonkey in Chrome.
2. Create a new userscript and paste in `propstream-swarm-bridge.user.js`.
3. Save the script, then open PropStream.
4. Click the floating `Swarm Bridge` button.
5. Fill in:
   - Hermes poll URL
   - Hermes event URL
   - Hermes heartbeat URL, if separate
   - Auth mode and token
   - Commands webhook URL
   - Results webhook URL
   - `#ai-hq` alert webhook URL
   - Operator timezone
   - Optional usage-page URL override
6. Save config.

The script stores config with `GM_setValue`, so the values persist across reloads and browser restarts.

## First-run expectations

- Until the Hermes URLs are configured, the panel will warn that config is incomplete.
- A heartbeat is sent immediately on startup, then every 60 seconds.
- A compact heartbeat mirror is sent to the results webhook every 10 minutes.
- The script only runs cost-bearing automation during the configured operator hours by default.

## Hermes assumptions

The script assumes a simple HTTP contract:

- Poll URL: `GET` returning either a single JSON command envelope or an array of envelopes
- Event URL: `POST` accepting result, error, and heartbeat envelopes
- Optional heartbeat URL: if blank, heartbeat payloads are posted to the main event URL

The auth mode is configurable in the control panel:

- `Bearer`: `Authorization: Bearer <token>`
- `Custom header`: configurable header name and raw token
- `None`

## Safety model

- The bridge rejects any inbound command whose `lane` is not `"houses"`.
- Blocklisted states are rejected defense-in-depth if the payload exposes a state value.
- Save, export, skip-trace, and monitor commands are quota-guarded locally before execution.
- Skip-trace PII is never mirrored to Discord and never written to the rolling log.
- `HALT` persists through reloads. `RESUME` clears it.

## Known implementation boundaries

- PropStream DOM selectors are intentionally heuristic until validated against the live site.
- `EXPORT` attempts to capture downloadable CSV/XLSX links, but some export flows may still need a selector adjustment in `SELECTORS.md`.
- Skip-trace caching is in-memory only for the actual contact payload because persistent storage of that PII is intentionally forbidden.
- Because I could not attach to a live PropStream session from this environment, selector verification and end-to-end testing remain operator follow-up tasks.

## Troubleshooting

- If you see `SESSION_EXPIRED`, re-open PropStream and log in manually.
- If you see `CAPTCHA_REQUIRED`, solve it manually and then resume.
- If you see `DOM_SELECTOR_MISSING`, capture the affected page and update the selectors listed in `SELECTORS.md`.
- If counters drift more than 5% from PropStream's usage page, the bridge trusts PropStream and mirrors an alert to `#ai-hq`.
