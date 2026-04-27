# PropStream x Swarm Bridge

This repo currently ships the TamperMonkey bridge described in the Alfred/Hermes v4 handoff. The bridge runs inside the operator's authenticated PropStream browser session, polls Hermes over HTTP for commands, mirrors activity to Discord for auditability, and executes UI actions inside PropStream.

## Files

- `propstream-swarm-bridge.user.js`: installable TamperMonkey userscript.
- `PROTOCOL.md`: Hermes-facing envelope and command contract.
- `SELECTORS.md`: selector catalog and fallback expectations.
- `TEST_CHECKLIST.md`: operator test path.

Read these before changing selectors or export parsing:

- `/Users/adilchaudary/Desktop/wholesaling-swarm/docs/codex-handoff-v4.md`
- `/Users/adilchaudary/Desktop/wholesaling-swarm/docs/propstream-ui-reference/README.md`
- `/Users/adilchaudary/Desktop/wholesaling-swarm/docs/propstream-ui-reference/export-schema.md`

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
   - `#propstream-quota` webhook URL
   - `#alfred` alert webhook URL
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

- The bridge keeps `lane: "houses"` in its protocol contract for forward compatibility with future lanes.
- Blocklisted states are rejected defense-in-depth if the payload exposes a state value.
- Save, export, and skip-trace commands are quota-guarded locally before execution and now fail closed until a recent `QUOTA_CHECK` has populated remote remaining-capacity state.
- Save, export, and skip-trace only increment local counters after a verified post-click success signal.
- Skip-trace PII is never mirrored to Discord and never written to the rolling log.
- Skip-trace extraction is scoped to an isolated results container rather than the full page text.
- Export capture is mapped into canonical lead/contact fields and preserves phone-type plus DNC metadata for Hermes.
- `MONITOR` is intentionally not supported in v4 because the PropStream Pro UI does not expose an operator-side monitor toggle.
- `HALT` persists through reloads. `RESUME` clears it.

## Known implementation boundaries

- PropStream DOM selectors are intentionally heuristic until validated against the live site.
- `EXPORT` assumes PropStream's CSV-only flow documented in the v4 UI reference, but the exact download/confirmation selectors may still need live adjustment in `SELECTORS.md`.
- Skip-trace caching is in-memory only for the actual contact payload because persistent storage of that PII is intentionally forbidden.
- The active implementation still uses the conservative per-property skip-trace path for live DOM extraction; the export-schema route is the preferred v4 batch path and should be validated live before relying on it for larger runs.
- Selector, captcha, session, rate-limit, and quota-sync failures now apply a protective halt to the relevant scope or to the whole bridge.
- Because I could not attach to a live PropStream session from this environment, selector verification and end-to-end testing remain operator follow-up tasks.

## Troubleshooting

- If you see `SESSION_EXPIRED`, re-open PropStream and log in manually.
- If you see `CAPTCHA_REQUIRED`, solve it manually and then resume.
- If you see `DOM_SELECTOR_MISSING`, capture the affected page and update the selectors listed in `SELECTORS.md`.
- If counters drift more than 5% from PropStream's usage page, the bridge trusts PropStream and mirrors alerts to `#propstream-quota` and `#alfred`.
