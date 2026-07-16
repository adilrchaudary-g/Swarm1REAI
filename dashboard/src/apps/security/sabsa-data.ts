export type SabsaCol = 'What' | 'Why' | 'How' | 'Who' | 'Where' | 'When'

export interface SabsaCell {
  col: SabsaCol
  sub: string
  text: string
  warn?: string
}

export interface SabsaLayer {
  id: string
  n: number
  name: string
  view: string
  question: string
  summary: Record<SabsaCol, string>
  cells: SabsaCell[]
}

export interface SabsaGap {
  title: string
  cell: string
  detail: string
  severity: 'critical' | 'high' | 'medium'
}

export const SABSA_COLS: { col: SabsaCol; label: string }[] = [
  { col: 'What', label: 'Assets' },
  { col: 'Why', label: 'Motivation' },
  { col: 'How', label: 'Process' },
  { col: 'Who', label: 'People' },
  { col: 'Where', label: 'Location' },
  { col: 'When', label: 'Time' },
]

export const SABSA_LAYERS: SabsaLayer[] = [
  {
    id: 'contextual',
    n: 1,
    name: 'Contextual',
    view: 'Business View',
    question: 'What is the business, and what must it protect?',
    summary: {
      What: 'Deal pipeline, buyer list, compliance standing',
      Why: 'TCPA suits, PII breach, data loss',
      How: 'Harvest → call → contract → assign',
      Who: 'Adil, VAs, sellers, buyers, vendors',
      Where: 'OH/TX/MO markets + blocked states',
      When: '8–23 ET window, 10-day requeue',
    },
    cells: [
      {
        col: 'What',
        sub: 'Business assets',
        text: 'The deal pipeline itself: distressed-seller leads (4,266 intake → 604 dial-ready in the Ohio funnel), assignment contracts with a $20k floor and $25–50k target fee, cash-buyer relationships, the PropStream subscription and its quota, TCPA/DNC compliance standing, and revenue and payroll records.',
      },
      {
        col: 'Why',
        sub: 'Business risks',
        text: 'TCPA/DNC litigation from calling flagged numbers; operating in blocked states (SC, IL, OK, KY, PA, VA plus NC/NE/NY in code); breach of thousands of skip-traced PII records held unencrypted on one laptop; PropStream account loss from quota abuse; offshore-caller fraud.',
        warn: 'Total pipeline loss — no backups exist.',
      },
      {
        col: 'How',
        sub: 'Business processes',
        text: 'Harvest (PropStream, government lists, FSBO, court records) → skip-trace → score and route → cold-call via VAs → underwrite (MAO = ARV × 0.70 − repairs − $25k fee) → contract → e-sign via emailed link → assign to cash buyer → collect fee.',
      },
      {
        col: 'Who',
        sub: 'Organization & relationships',
        text: 'Adil: owner, sole admin, closer. Offshore setters at ~$2/hr. Sellers as PII subjects and contract counterparties. Cash buyers. Vendors: PropStream, Twilio, Anthropic/OpenAI, Google, Cloudflare.',
      },
      {
        col: 'Where',
        sub: 'Geography',
        text: 'Virtual national operation run from one macOS machine. GREEN markets: Ohio (heaviest, 15+ counties), Texas, Missouri, Michigan, Kansas, Mississippi, plus 13 code-violation cities. Blocked and high-friction states excluded by policy. Public touchpoint: cloudflared e-sign links to sellers.',
      },
      {
        col: 'When',
        sub: 'Time dependencies',
        text: 'Operator hours 08:00–23:00 ET gate all cost-bearing automation. Motivation decays from 30 to 180 days. 10-day re-queue, 6-attempt cooldown. Weekly payroll.',
        warn: 'Quarterly regulatory blocklist refresh due July 2026.',
      },
    ],
  },
  {
    id: 'conceptual',
    n: 2,
    name: 'Conceptual',
    view: "Architect's View",
    question: 'What security attributes and control objectives follow?',
    summary: {
      What: 'Compliant, confidential, traceable…',
      Why: 'Never dial DNC; contain PII',
      How: 'Layered gates, least privilege',
      Who: 'Admin/caller trust model',
      Where: 'Five security domains',
      When: 'Lead half-life, token lifetimes',
    },
    cells: [
      {
        col: 'What',
        sub: 'Business attributes profile',
        text: 'Compliant (TCPA/DNC/state law), confidential (seller PII, recordings, financials), accurate (confidence ≥ 0.75 before green-light), available (queues populated every session), traceable (every call and status change logged), trustworthy (caller work verifiable), non-repudiable (signed contracts hold up).',
      },
      {
        col: 'Why',
        sub: 'Control objectives',
        text: 'Never dial a DNC, litigator, or blocked-state lead. Contain PII inside Hermes — never to Discord, logs, or git. Restrict lead and financial data to authenticated, role-appropriate users. Preserve pipeline continuity. Bind e-signatures to unguessable single-purpose tokens. Keep vendor quota use inside caps.',
      },
      {
        col: 'How',
        sub: 'Security strategies',
        text: 'Layered router gates (regulatory tier → litigator → DNC → equity → confidence). Least-privilege two-role RBAC. PII containment by architecture — "PII flows through Hermes only," with log redaction in the userscript. Defense-in-depth quota protection across three layers. Human-in-the-loop approval tiers for agent write actions.',
      },
      {
        col: 'Who',
        sub: 'Trust framework',
        text: 'Two internal trust levels: admin (full) and caller (dial-and-log only). Agents sit below humans — writes need approval. Vendors trusted per ToS. Sellers untrusted until token-verified on the signing page. Offshore callers semi-trusted: hours and calls are independently verified by integrity analytics.',
      },
      {
        col: 'Where',
        sub: 'Security domain framework',
        text: 'Five domains: trusted local core (Hermes + SQLite + lead-vault); operator browser (authenticated PropStream session); caller endpoints (offshore machines); public edge (cloudflared signing pages); third-party clouds (PropStream, Anthropic, OpenAI, Gmail, Twilio, Discord). Every boundary crossing is a control point.',
      },
      {
        col: 'When',
        sub: 'Lifetimes & deadlines',
        text: 'Lead value has a half-life (freshness 1.0 under 30 days → 0.35 past 180). Quota windows reset monthly. Blocklist expires quarterly. Credential rotation is documented but has no enforced cadence.',
        warn: 'Session tokens and signing tokens never expire.',
      },
    ],
  },
  {
    id: 'logical',
    n: 3,
    name: 'Logical',
    view: "Designer's View",
    question: 'What information, services, and privileges implement it?',
    summary: {
      What: '5-entity model, 40+ tables',
      Why: 'Router gate policies',
      How: 'Auth, authz, audit, e-sign services',
      Who: 'Privilege profiles per role',
      Where: 'API + PII domain boundaries',
      When: 'Poll / snapshot / sweep cycles',
    },
    cells: [
      {
        col: 'What',
        sub: 'Information assets',
        text: 'Five-entity model: Property / Owner / Lead / Contact / Deal (75-column export schema). ~40 SQLite tables including owners, owner_phones (DNC and bad-number flags), leads, call_attempts, call_recordings with Whisper transcripts, contracts (signatures, tokens, PDFs), users/sessions, payroll/revenue, lead_status_history.',
      },
      {
        col: 'Why',
        sub: 'Risk management policies',
        text: 'Router gates: proceed / review / dead on confidence (≥0.75, 0.50–0.74, <0.50), equity, DNC, litigator, state tier. Cell-only queue policy — landlines never enter the dial queue. PII never to Discord or logs. Quota alerting at 70/85/95%. Maximum six contact attempts, then cooldown.',
      },
      {
        col: 'How',
        sub: 'Security services',
        text: 'Authentication (login → session token). Authorization (_require_auth / _require_role per endpoint). E-sign token service at /sign/<token>. Audit trail via lead_status_history, agent_runs, call_attempts. Caller-integrity analytics (admin-only). Local transcription and AI grading pipeline. Secrets loading from .env and secrets/.',
      },
      {
        col: 'Who',
        sub: 'Privilege profiles',
        text: 'admin: ["*"] — finances, payroll, integrity reports, user management, lead assignment. caller: view call list, dial mode, own KPI, schedule; log calls, add notes, upload recordings — nothing financial, nothing cross-caller. Agents: read / write / approval tiers. Seller: unauthenticated, scoped to one signing token.',
      },
      {
        col: 'Where',
        sub: 'Domain boundaries',
        text: 'API boundary at 127.0.0.1:8765. Dashboard token in localStorage. Filesystem PII domain at lead-vault/ and hermes/data/. Public path /sign/* is the only unauthenticated data-bearing route. External boundaries at PropStream, Anthropic, OpenAI, Gmail, Discord, and the government scrape portals.',
      },
      {
        col: 'When',
        sub: 'Processing cycle',
        text: '10s command poll, 30s long-poll, 60s heartbeat, 10-minute Discord mirror, 6-hour quota cache. Daily KPI snapshots per caller. 10-day stale-lead re-queue sweep. 14-day harvest cooldown per zip. Weekly payroll cycle.',
      },
    ],
  },
  {
    id: 'physical',
    n: 4,
    name: 'Physical',
    view: "Builder's View",
    question: 'What mechanisms and infrastructure realize the design?',
    summary: {
      What: 'SQLite, lead-vault, recordings',
      Why: 'Controls in place vs. gaps',
      How: 'Bearer tokens, quota caps, local Whisper',
      Who: 'Tauri app, dial UI, sign page',
      Where: 'One macOS host + tunnel',
      When: 'Operator-hours gate, requeue job',
    },
    cells: [
      {
        col: 'What',
        sub: 'Data mechanisms',
        text: 'hermes/data/hermes.db (SQLite WAL) plus companion DBs. lead-vault/ CSV/JSON tree — live call lists with names, cell numbers, addresses, DNC, MAO. Call audio and transcripts under hermes/data/recordings/. Contract PDFs. Secrets in .env and secrets/.',
        warn: 'Everything is plaintext at rest.',
      },
      {
        col: 'Why',
        sub: 'Practices vs. gaps',
        text: 'In place: thorough .gitignore PII exclusions, server-side role checks on every endpoint, userscript log redaction, DNC/litigator hard gates.',
        warn: 'Gaps: unsalted SHA-256 passwords, seeded admin/admin, CORS *, token accepted in URL query, no encryption at rest, no backups, no login rate limiting, hand-rolled multipart parser.',
      },
      {
        col: 'How',
        sub: 'Security mechanisms',
        text: 'Bearer-token auth over plain local HTTP. Per-endpoint role guards. Cloudflared provides the only TLS, for signing pages. DNC/litigator enforcement at queue build. Three-layer quota caps (userscript, runner, vendor hard cap). Whisper runs locally — call audio never leaves the machine.',
      },
      {
        col: 'Who',
        sub: 'Human-machine interface',
        text: 'SWARM Tauri desktop app with login screen; caller dial-mode UI; admin-only Finances, Payroll, and Agents panels; Jarvis overlay assistant; public e-sign page for sellers; Discord/Slack for ops chatter, PII-redacted by policy.',
      },
      {
        col: 'Where',
        sub: 'Platform & network infrastructure',
        text: 'Single macOS host: Hermes on 127.0.0.1:8765, Vite dev on :5173, Playwright CDP on :9222, Tauri desktop binary. Public exposure only via ephemeral cloudflared tunnel. Twilio carries dialing.',
        warn: 'Offshore caller machines are unmanaged endpoints — how they reach the dashboard is the biggest open question.',
      },
      {
        col: 'When',
        sub: 'Timing & sequencing',
        text: 'OPERATOR_HOURS 8–23 gate in userscript and runner. requeue_stale_leads(10d, max 6) in the store. 14-day harvest cooldown. Fixed upload sequence: recording → ffmpeg → Whisper → Claude call-splitting → lead auto-link → grade → call_attempts.',
      },
    ],
  },
  {
    id: 'component',
    n: 5,
    name: 'Component',
    view: "Tradesman's View",
    question: 'What specific products, standards, and identifiers?',
    summary: {
      What: 'Python, React, Tauri, Playwright',
      Why: 'Thresholds & quota constants',
      How: 'REST, SMTP, CDP, webhooks',
      Who: 'users/sessions, API keys',
      Where: 'Ports & endpoints',
      When: 'Interval constants, NY timezone',
    },
    cells: [
      {
        col: 'What',
        sub: 'Components & products',
        text: 'Python 3.14 stdlib ThreadingHTTPServer; SQLite + FTS5; React 18 + TypeScript + Vite + Zustand; Tauri (Rust); Playwright + Chromium; TamperMonkey userscript; ffmpeg; Whisper "medium" (local); claude-sonnet-4-6; optional gpt-5-mini supervisor; cloudflared.',
      },
      {
        col: 'Why',
        sub: 'Risk parameters & standards',
        text: 'TIER_THRESHOLDS (HOT→ICE), confidence gates 0.75/0.50, discount factor 0.65–0.75, assignment fee $25k, minimum spread $20k, ARV band $80k–$500k, regulatory blocklist constants in lead_engine/config.py, quota caps 42k/40k/40k/45k, alerts at 70/85/95%.',
      },
      {
        col: 'How',
        sub: 'Protocols & tools',
        text: 'REST/JSON over HTTP; Authorization: Bearer sessions; hand-rolled multipart upload; SMTP with a Gmail app password (stored in user_settings); Chrome DevTools Protocol to PropStream; Discord webhooks; hex signing tokens in URLs; GM_setValue bridge polling.',
      },
      {
        col: 'Who',
        sub: 'Identities & ACLs',
        text: 'users and sessions tables; the permission list in dashboard/src/auth/permissions.ts; the seeded admin identity; per-caller user_id keys on calls, payroll, and revenue; machine identities via Anthropic, OpenAI, and PropStream credentials plus the Gmail app password and Discord webhook URLs.',
      },
      {
        col: 'Where',
        sub: 'Node addresses',
        text: '127.0.0.1:8765, localhost:5173, CDP :9222, *.trycloudflare.com, app.propstream.com, api.anthropic.com, api.openai.com, smtp.gmail.com, courts.mo.gov/cnet, Socrata/ArcGIS/Carto portals, Zillow. Port 3000 is reserved for another project — check listening ports first.',
      },
      {
        col: 'When',
        sub: 'Timing standards',
        text: 'Intervals: 10s poll, 30s long-poll, 60s heartbeat, 600s Discord mirror, 6h quota cache. Timezone standard America/New_York. Freshness decay constants (1.0 under 30 days → 0.35 past 180). Agents are on-demand only — no cron or scheduled agents, by explicit operating rule.',
      },
    ],
  },
  {
    id: 'operational',
    n: 6,
    name: 'Operational',
    view: 'Service Management View',
    question: 'How is it run, monitored, and kept alive?',
    summary: {
      What: 'Backups & continuity (absent)',
      Why: 'Quota, integrity, compliance watch',
      How: 'Daily pipeline ops, go/no-go',
      Who: 'VA lifecycle, payroll checks',
      Where: 'SPOF host, tunnel windows',
      When: 'Ops calendar & rotation',
    },
    cells: [
      {
        col: 'What',
        sub: 'Continuity & assurance',
        text: 'Required: nightly encrypted backup of the databases, lead-vault, and contracts to off-machine storage; a WAL checkpoint routine; a documented restore drill. Track the operational-readiness blockers (runner save/export/skip-trace is NO-GO) as availability risks.',
        warn: 'Currently absent — the highest-priority build-out.',
      },
      {
        col: 'Why',
        sub: 'Risk management operations',
        text: 'Watch quota alerts at 70/85/95%. Run caller integrity reports each payroll cycle. Verify DNC/litigator currency on every fresh skip-trace batch. Audit for blocked-state leads leaking into queues. Add login rate limiting — nothing watches the auth endpoint today.',
        warn: 'Quarterly blocklist refresh due this month, July 2026.',
      },
      {
        col: 'How',
        sub: 'Process delivery management',
        text: 'Daily: build queue → dial session → upload recording → transcription and grading → KPI snapshot. Review agent_runs after any agent action. Use the operational-readiness doc as the formal go/no-go gate before production harvest batches. Rotate secrets per secrets/README.md when a caller leaves or a tunnel URL leaks.',
      },
      {
        col: 'Who',
        sub: 'Personnel management',
        text: 'VA onboarding per SOP; provision caller accounts with the caller role only. Deprovision the day a setter exits: delete the session and user, rotate anything they saw. Weekly payroll runs off hours cross-checked against the integrity report. Adil is the sole secret-holder and sole admin — itself a continuity risk worth documenting.',
      },
      {
        col: 'Where',
        sub: 'Site & environment management',
        text: 'One macOS host is a single point of failure for the whole business — mitigate with backups first, a second machine later. Open cloudflared tunnels only for active signing windows and kill them after. Port hygiene before dev servers. Set minimum endpoint standards for offshore caller machines.',
      },
      {
        col: 'When',
        sub: 'Schedule management',
        text: 'Enforce the operator-hours window on all cost-bearing automation. Daily KPI snapshot; weekly payroll; 10-day re-queue sweep; 14-day harvest cooldown; quarterly compliance refresh on the calendar with an owner and a deadline; credential rotation on role change or at most quarterly.',
      },
    ],
  },
]

export const SABSA_GAPS: SabsaGap[] = [
  {
    title: 'No backups, no restore path',
    cell: 'Operational · What',
    detail: 'The entire pipeline — 604 dial-ready leads, contracts, revenue records — lives on one disk. One encrypted nightly backup job removes the single largest business risk.',
    severity: 'critical',
  },
  {
    title: 'Unsalted SHA-256 passwords and a seeded admin/admin account',
    cell: 'Physical · Why',
    detail: 'Replace with bcrypt or argon2, force-change the seeded credential, and add login rate limiting.',
    severity: 'critical',
  },
  {
    title: 'PII in plaintext at rest',
    cell: 'Physical · What',
    detail: 'Verify FileVault full-disk encryption is on — the cheap 90% fix. Consider SQLCipher for hermes.db if VAs ever get machine-level access.',
    severity: 'high',
  },
  {
    title: 'CORS wildcard and tokens in URL query strings',
    cell: 'Component · How',
    detail: 'Pin allowed origins to the Tauri app and localhost; drop ?token= support so tokens stop landing in logs and referrers.',
    severity: 'high',
  },
  {
    title: 'Session and signing tokens never expire',
    cell: 'Conceptual · When',
    detail: 'Add TTLs: sessions on a ~7-day sliding window, signing tokens single-use or 14 days.',
    severity: 'medium',
  },
  {
    title: 'Unmanaged offshore caller endpoints',
    cell: 'Physical · Where',
    detail: 'Decide how callers reach the dashboard (Tailscale, hosted deploy, or persistent tunnel) before scaling past two setters — the largest open architecture decision.',
    severity: 'high',
  },
  {
    title: 'Quarterly regulatory blocklist refresh is due',
    cell: 'Operational · Why',
    detail: 'Compliance control with a hard date: July 2026, this month.',
    severity: 'medium',
  },
]
