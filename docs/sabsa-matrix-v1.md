# SABSA 6×6 Matrix — Wholesaling-Swarm v1

**Scope:** The entire wholesaling operation as implemented in this repo — Hermes backend (`hermes/`), SWARM dashboard (`dashboard/`), PropStream runner (`propstream-runner/`), lead_engine pipeline, lead-vault data, and the human operation around them (Adil as admin, offshore callers, sellers, cash buyers).

**Date:** 2026-07-11 · **Basis:** `README.md`, `docs/system-design-v1.md`, `docs/motivation-scoring-v1.md`, `docs/regulatory-blocklist.md`, `docs/operational-readiness-working.md`, `hermes/server.py`, `hermes/store.py`, `lead_engine/config.py`, `dashboard/src/auth/permissions.ts`.

The six columns are the SABSA interrogatives: **Assets (What)** · **Motivation (Why)** · **Process (How)** · **People (Who)** · **Location (Where)** · **Time (When)**.

---

## Row 1 — Contextual Architecture (Business View)

*"What is the business, and what does it need to protect?"*

| | |
|---|---|
| **What — Business assets** | The deal pipeline itself: distressed-seller leads (4,266 intake → 604 dial-ready in the Ohio funnel), assignment contracts with $20k-floor / $25–50k-target fees, cash-buyer relationships, the PropStream subscription ($200/mo) and its quota, TCPA/DNC compliance standing, and revenue/payroll records. |
| **Why — Business risks** | TCPA/DNC litigation from calling flagged numbers (litigator + DNC gates exist for a reason); operating in blocked states (SC, IL, OK, KY, PA, VA + code-level NC/NE/NY); breach of thousands of skip-traced PII records sitting unencrypted on one laptop; PropStream account loss via quota abuse or ToS violation; offshore-caller fraud (fabricated hours/calls); total pipeline loss — there are no backups. |
| **How — Business processes** | Harvest (PropStream/gov lists/FSBO/court records) → skip-trace → score & route (motivation 0–100, confidence gates) → cold-call via VAs → underwrite (MAO = ARV × 0.70 − repairs − $25k fee) → contract → e-sign via emailed link → assign to cash buyer → collect fee. |
| **Who — Organization & relationships** | Adil: owner, sole admin, closer. Offshore setters/callers at ~$2/hr (e.g., Braden, Jaylen). Sellers (PII subjects and contract counterparties). Cash buyers. Vendors: PropStream, Twilio, Anthropic/OpenAI, Google (Gmail), Cloudflare. |
| **Where — Geography** | Virtual/national operation run from one macOS machine. GREEN markets: Ohio (15+ counties, heaviest), Texas, Missouri, Michigan, Kansas, Mississippi + 13 code-violation cities. Blocked and high-friction states excluded by policy. Public internet touchpoint: cloudflared e-sign links to sellers. |
| **When — Time dependencies** | Operator hours 08:00–23:00 ET gate all cost-bearing automation. Leads go stale (motivation decays 30→180 days). 10-day re-queue, 6-attempt cooldown. Weekly payroll. Quarterly regulatory blocklist refresh — **next due July 2026**. |

## Row 2 — Conceptual Architecture (Architect's View)

*"What security attributes and control objectives follow from the business?"*

| | |
|---|---|
| **What — Business attributes profile** | **Compliant** (TCPA/DNC/state law), **confidential** (seller PII, recordings, financials), **accurate** (underwriting confidence ≥ 0.75 before green-light), **available** (dial queues populated every session), **traceable** (every call attempt and status change logged), **trustworthy** (caller-reported work verifiable), **non-repudiable** (signed contracts hold up). |
| **Why — Control objectives** | Never dial a DNC/litigator/blocked-state lead. Contain PII inside Hermes — never to Discord, logs, or git. Restrict lead, financial, and payroll data to authenticated, role-appropriate users. Preserve pipeline continuity (backup/recovery). Bind e-signatures to unguessable, single-purpose tokens. Keep vendor quota usage inside caps to protect account standing. |
| **How — Security strategies** | Layered policy gates in the router (regulatory tier → litigator → DNC → equity → confidence). Least-privilege two-role RBAC. PII containment by architecture ("PII flows through Hermes only"; userscript redacts phones/emails from logs). Defense-in-depth quota protection (userscript caps + runner caps + PropStream hard cap). Human-in-the-loop approval tiers for agents (read / write / approval in MegaOrchestrator). |
| **Who — Trust framework** | Two internal trust levels: admin (full) and caller (dial-and-log only). Agents trusted below humans — write actions require approval tier. Vendors trusted per contract/ToS. Sellers untrusted until token-verified on the signing page. Offshore callers semi-trusted: work is independently verified via integrity analytics, not taken on faith. |
| **Where — Security domain framework** | Five domains: (1) trusted local core — Hermes + SQLite + lead-vault; (2) operator browser — authenticated PropStream session; (3) caller endpoints — offshore machines reaching the dashboard; (4) public edge — cloudflared `/sign/<token>` pages; (5) third-party clouds — PropStream, Anthropic, OpenAI, Gmail, Twilio, Discord. Data crossing any boundary is a control point. |
| **When — Lifetimes & deadlines** | Lead data has a value half-life (freshness 1.0 under 30 days → 0.35 past 180). Session tokens live until logout (no expiry — a gap). Signing tokens live until signed (no expiry — a gap). Quota windows reset monthly. Compliance blocklist expires quarterly. Credentials have a documented rotation procedure (`secrets/README.md`) but no enforced cadence. |

## Row 3 — Logical Architecture (Designer's View)

*"What information, services, and privilege profiles implement the concept?"*

| | |
|---|---|
| **What — Information assets** | Five-entity canonical model: Property / Owner / Lead / Contact / Deal (75-column export schema). ~40 SQLite tables incl. `owners`, `owner_phones` (dnc, bad_number flags), `leads`, `call_attempts`, `call_recordings` + Whisper transcripts, `contracts` (signatures, signing_token, PDFs), `users`/`sessions`, `payroll`/`revenue`/`expenses`, `kpi_snapshots`, `lead_status_history`, FTS5 `lead_search`. |
| **Why — Risk management policies** | Router gates: proceed / review / dead on confidence (≥0.75 / 0.50–0.74 / <0.50), equity, DNC, litigator, state tier. Cell-only queue policy — landlines never enter the dial queue. PII-never-to-Discord/logs policy. Quota alerting at 70/85/95%. Max 6 contact attempts, then cooldown. |
| **How — Security services** | Authentication service (login → session token). Authorization service (`_require_auth` / `_require_role` per endpoint). E-sign token service (`/sign/<token>`). Audit trail (`lead_status_history`, `agent_runs`, `call_attempts`). Caller-integrity analytics (`/api/activity/integrity`, admin-only). Transcription/grading pipeline (local Whisper + Claude). Secrets loading service (.env / `secrets/`). |
| **Who — Entity schema & privilege profiles** | `admin`: `["*"]` — finances, payroll, integrity reports, user management, all-caller schedule, lead assignment. `caller`: `view:call_list`, `view:dial_mode`, `view:own_kpi`, `view:schedule`, `action:log_call`, `action:add_note`, `action:upload_recording` — nothing financial, nothing cross-caller. Agents: read / write / approval tiers. Seller: unauthenticated, scoped to one signing token. |
| **Where — Domain definitions (logical boundaries)** | API boundary at `127.0.0.1:8765`; dashboard token domain in `localStorage` (`swarm_token`); filesystem PII domain at `lead-vault/` + `hermes/data/`; public path `/sign/*` (only unauthenticated data-bearing route); external service boundaries at `app.propstream.com`, `api.anthropic.com`, `api.openai.com`, `smtp.gmail.com`, Discord webhooks, Socrata/ArcGIS/Carto/CaseNet scrape targets. |
| **When — Processing cycle** | 10s command poll, 30s long-poll, 60s heartbeat, 10-min Discord mirror, 6h quota cache TTL. Daily KPI snapshots per caller. 10-day `requeue_stale_leads` sweep. 14-day harvest cooldown per zip. Weekly payroll cycle (`week_start`). |

## Row 4 — Physical Architecture (Builder's View)

*"What actual mechanisms and infrastructure realize the design?"*

| | |
|---|---|
| **What — Data mechanisms** | `hermes/data/hermes.db` (SQLite, WAL) + `propstream.db` + `swarm.db`. `lead-vault/` CSV/JSON tree (call lists with names, cells, addresses, DNC, MAO). Call audio + transcripts under `hermes/data/recordings/`. Contract PDFs at `pdf_path` / `signed_pdf_path`. Secrets in `.env` + `secrets/` (gitignored). Token in browser `localStorage`. **All plaintext at rest.** |
| **Why — Risk management practices (current vs. gap)** | In place: thorough `.gitignore` PII exclusions (working tree clean), server-side role checks on every endpoint, log redaction in userscript, litigator/DNC hard gates at queue build. **Gaps:** unsalted SHA-256 password hashing (`store.py` `_hash_password`); seeded `admin`/`admin` account; `Access-Control-Allow-Origin: *`; token accepted via `?token=` query string; no encryption at rest; no backups; no auth rate limiting; hand-rolled multipart parser on the upload path. |
| **How — Security mechanisms** | Bearer-token auth over plain HTTP (local). Per-endpoint `_require_role` guards. Cloudflared provides the only TLS, terminating at the tunnel for `/sign/` pages. DNC/litigator enforcement as columns checked at queue build. Three-layer quota caps (userscript 42k saves / 40k exports / 40k skip-traces; runner caps; vendor hard cap). Whisper runs locally — call audio never leaves the machine. |
| **Who — Human-machine interface** | SWARM Tauri desktop app (`com.wholesaling-swarm.app`) with login screen; caller dial-mode UI; admin-only Finances/Payroll/Agents panels; Jarvis overlay assistant; public e-sign web page for sellers; Discord/Slack channels for ops chatter (PII-redacted by policy). |
| **Where — Platform & network infrastructure** | Single macOS host: Hermes `127.0.0.1:8765`, Vite dev `:5173`, Playwright CDP `:9222`, Tauri desktop binary. Public exposure only via ephemeral cloudflared quick tunnel. Twilio carries dialing; recordings return to local disk. Offshore caller machines are unmanaged endpoints — how they reach the dashboard is the largest unresolved physical-architecture question. |
| **When — Timing & sequencing mechanisms** | `OPERATOR_HOURS` 8–23 gate in userscript + runner config. `requeue_stale_leads(days_threshold=10, max_attempts=6)` in `store.py`. Harvest cooldown 14 days. Fixed sequence on session upload: recording → ffmpeg → Whisper transcript → Claude call-splitting → auto-link to leads → grade → `call_attempts`. |

## Row 5 — Component Architecture (Tradesman's View)

*"What specific products, standards, and identifiers are in play?"*

| | |
|---|---|
| **What — Components & products** | Python 3.14 stdlib `ThreadingHTTPServer`; SQLite + FTS5; React 18 + TypeScript + Vite + Zustand; Tauri (Rust); Playwright + Chromium; TamperMonkey userscript (`GM_setValue`); ffmpeg; mlx-whisper/openai-whisper "medium"; `claude-sonnet-4-6`; `gpt-5-mini` (optional supervisor); cloudflared. |
| **Why — Risk parameters & standards** | `TIER_THRESHOLDS` (HOT→ICE), confidence gates 0.75/0.50, `discount_factor` 0.65–0.75, `ASSIGNMENT_FEE = 25_000`, `MIN_SPREAD = 20_000`, ARV band $80k–$500k, regulatory blocklist constants in `lead_engine/config.py`, quota caps 42k/40k/40k/45k, alert thresholds 70/85/95%. |
| **How — Protocols & tools** | REST/JSON over HTTP; `Authorization: Bearer` sessions; hand-rolled multipart upload; SMTP with Gmail app password (stored in `user_settings` table); Chrome DevTools Protocol to PropStream; Discord webhooks; hex signing tokens in `/sign/<token>` URLs; `GM_setValue` bridge polling. |
| **Who — Identities & ACLs** | `users` + `sessions` tables; `dashboard/src/auth/permissions.ts` permission list; seeded admin identity; per-caller `user_id` foreign keys on `call_attempts`/`payroll`/`revenue`; machine identities via `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `PROPSTREAM_USERNAME/PASSWORD`, Gmail app password, Discord webhook URLs. |
| **Where — Node addresses** | `127.0.0.1:8765` (Hermes), `localhost:5173` (Vite), `:9222` (CDP), `*.trycloudflare.com` (e-sign), `app.propstream.com`, `api.anthropic.com`, `api.openai.com`, `smtp.gmail.com`, `courts.mo.gov/cnet`, Socrata/ArcGIS/Carto portals, Zillow. Port 3000 reserved for another project — check listening ports before starting dev servers. |
| **When — Timing standards** | Intervals: 10s poll, 30s long-poll, 60s heartbeat, 600s Discord mirror, 6h quota cache. Timezone standard `America/New_York`. Freshness decay curve constants (1.0/<30d → 0.35/180d+). Agents are on-demand only — no cron/scheduled agents by explicit operating rule. |

## Row 6 — Operational Architecture (Service Management View)

*"How is all of this run, monitored, and kept alive day to day?"*

| | |
|---|---|
| **What — Continuity & assurance of assets** | **Currently absent — highest-priority build-out.** Required: nightly encrypted backup of `hermes/data/*.db` + `lead-vault/` + contracts to off-machine storage; SQLite WAL checkpoint routine; documented restore drill. Track the operational-readiness blockers (`docs/operational-readiness-working.md`: runner save/export/skip-trace is NO-GO) as availability risks to the harvest pipeline. |
| **Why — Risk management operations** | Watch quota alerts at 70/85/95%. Run caller integrity reports each payroll cycle. Verify DNC/litigator data currency on every fresh skip-trace batch. Execute the quarterly blocklist refresh (**due this month, July 2026**). Audit for blocked-state leads leaking into queues. Add and monitor auth rate limiting / failed-login review — currently nothing watches the login endpoint. |
| **How — Process delivery management** | Daily: build queue → dial session → upload recording → transcription/grading pipeline → KPI snapshot. Review `agent_runs` after any agent action. Use the operational-readiness doc as the formal go/no-go gate before production harvest batches. Rotate secrets per `secrets/README.md` when a caller leaves or a tunnel URL leaks. |
| **Who — Personnel management** | VA onboarding per SOP; provision caller accounts with `caller` role only — never admin. Deprovision (delete session + user, rotate anything they saw) the day a setter exits. Weekly payroll runs off verified hours, cross-checked against the integrity report before payment. Adil is the sole secret-holder and sole admin — also a single point of failure worth documenting for continuity. |
| **Where — Environment management** | One macOS host is a single point of failure for the whole business — mitigate via backups first, second machine later. Open cloudflared tunnels only for active signing windows; kill them after. Port hygiene before dev servers. Set minimum endpoint standards for offshore caller machines (OS updates, no shared accounts, browser-only access). |
| **When — Schedule management** | Enforce operator-hours window on all cost-bearing automation. Daily KPI snapshot; weekly payroll; 10-day re-queue sweep; 14-day harvest cooldown; quarterly compliance refresh on the calendar with an owner and a deadline; credential rotation on role change or at most quarterly. |

---

## Gap register (mapped to matrix cells)

Priority-ordered; each gap names the cell where the control belongs.

1. **No backups / no restore path** — Operational·What. The entire pipeline (604 dial-ready leads, contracts, revenue records) lives on one disk. One `rsync`-style encrypted nightly job removes the top business risk.
2. **Unsalted SHA-256 passwords + seeded `admin`/`admin`** — Physical·Why. Replace with bcrypt/argon2, force-change the seeded credential, add login rate limiting (Operational·Why).
3. **PII plaintext at rest** — Physical·What. FileVault full-disk encryption is the cheap 90% fix; verify it is on. Consider SQLCipher for `hermes.db` if VAs ever get machine access.
4. **CORS `*` + token in URL query** — Physical·Why / Component·How. Pin allowed origins to the Tauri app and localhost; drop `?token=` support so tokens stop landing in logs and referrers.
5. **Non-expiring session and signing tokens** — Conceptual·When. Add TTLs: sessions ~7 days sliding, signing tokens 14 days or single-use.
6. **Unmanaged offshore endpoints** — Physical·Where / Operational·Where. Define how callers reach the dashboard (tunnel? Tailscale? hosted deploy?) before scaling past two setters — this is the largest open architecture decision.
7. **Quarterly blocklist refresh due July 2026** — Operational·Why. Compliance control with a hard date this month.
