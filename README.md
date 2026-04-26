# Wholesaling Swarm

A multi-agent system for autonomous virtual wholesaling of single-family residential real estate. Coordinated through a Discord-based operating layer (Hermes/Alfred), powered by PropStream Pro as the data engine, and bridged to PropStream via a TamperMonkey userscript.

> **Project status:** Architecture finalized. Hermes orchestrator running. PropStream bridge (this repo's primary deliverable) in development by Codex.

---

## What this is

Most wholesaling operations are one person on a phone with a spreadsheet. This is a swarm of specialized AI agents that handle market selection, distress monitoring, persona classification, motivation scoring, underwriting, and routing — surfacing only the highest-quality leads to a human at the end. The human's job becomes "talk to the seller and close," not "find the seller."

The core insight: each step of the wholesaling pipeline is a different problem with different signals, different data sources, and different failure modes. Treating them as separate agents that pass data between each other (instead of one monolithic system) means each piece can be tested, improved, and replaced independently.

## Architecture at a glance

Three layers, organized as Discord channels under different categories:

**Shared backbone** (lane-agnostic): `#ai-hq`, `#opportunity-intake`, `#lead-enrichment`, `#strategy-router`, `#follow-up-orchestrator`, `#kpi-intelligence`, `#queue`, `#done-feed`

**Houses lane** (SFR-specific): `#house-list-builder`, `#house-distress-monitoring`, `#house-seller-motivation`, `#seller-response-triage`, `#house-fast-underwriting`, `#house-outreach`, `#house-buyer-match-dispo`, `#house-propstream-commands`, `#house-propstream-results`

**Land lane** (vacant land, parallel structure): out of scope for v1.

Hermes (orchestrator bot, instance name "Alfred") routes messages between channels, dispatches commands to agents, and exposes an HTTP endpoint for external integrations like the PropStream userscript bridge.

```
                    ┌─────────────────────┐
                    │  Houses-lane agents │
                    │  (Discord channels) │
                    └──────────┬──────────┘
                               │
                               ▼
                    ┌─────────────────────┐
                    │       Hermes        │
                    │  (HTTP + Discord)   │
                    └──────────┬──────────┘
                               │
          ┌────────────────────┼────────────────────┐
          │ HTTP (primary)     │ Discord (mirror)   │
          ▼                    ▼                    ▼
  ┌───────────────┐   ┌──────────────────┐  ┌──────────────────┐
  │  Userscript   │   │ #house-propstream│  │ #house-propstream│
  │  (browser)    │   │    -commands     │  │    -results      │
  └───────┬───────┘   └──────────────────┘  └──────────────────┘
          │
          ▼
  ┌───────────────┐
  │   PropStream  │
  │   web app     │
  └───────────────┘
```

## Repo layout

```
wholesaling-swarm/
├── README.md                       (this file)
├── .gitignore
├── docs/
│   ├── system-design-v1.md         The four-module deep dive: market
│   │                               selector, persona classifier,
│   │                               underwriting, data schema.
│   ├── motivation-scoring-v1.md    Motivation score formula, signals,
│   │                               decay, thresholds.
│   ├── codex-handoff-v2.md         Spec for the PropStream TamperMonkey
│   │                               bridge. Hand this to Codex.
│   ├── regulatory-blocklist.md     States to skip / penalize. Refresh
│   │                               quarterly.
│   └── changelog.md                Decision log over time.
├── userscript/                     Codex's deliverables go here.
│   └── (empty — populated by Codex)
├── hermes/                         Hermes orchestrator code (if local).
│   └── (empty — populated when Hermes is open-sourced internally)
├── scripts/
│   └── test-webhook.sh             Verify a Discord webhook works
│                                   before wiring it into the userscript.
└── secrets/                        Gitignored. Never committed.
    └── README.md                   Tells you what goes here.
```

## Getting started

### If you're the operator

1. Read `docs/system-design-v1.md` and `docs/motivation-scoring-v1.md` to make sure the architecture still matches your mental model. If it doesn't, update them — the docs are the contract everyone else works from.
2. Confirm `docs/regulatory-blocklist.md` is current. Re-check quarterly.
3. Hand `docs/codex-handoff-v2.md` to Codex along with read access to this repo. Codex will fill in `userscript/`.
4. Set up your secrets locally — see `secrets/README.md`.

### If you're Codex (or any future contributor on the userscript)

1. Read `docs/codex-handoff-v2.md` end to end.
2. Resolve the open decisions in Section 14 with the operator before writing code.
3. Build deliverables into `userscript/` per Section 13.
4. Update `docs/changelog.md` with significant decisions you make along the way.

### If you're a future agent or human picking this up cold

Read in this order: this README → `docs/system-design-v1.md` → `docs/motivation-scoring-v1.md` → `docs/codex-handoff-v2.md` → `docs/changelog.md`. That's roughly an hour of reading and you'll have full context.

## Operating principles

These show up implicitly across the docs but are worth stating explicitly:

**Confidence over confidence.** The system reports how much it trusts its own outputs. An underwrite with 0.4 confidence is treated differently from one with 0.9, even if the headline numbers are the same. Build agents that know what they don't know.

**Lane discipline.** Houses agents touch houses. Land agents touch land. Shared backbone routes between them. Cross-lane logic requires explicit operator approval. This is what keeps the system from turning into spaghetti as it grows.

**Quota safety in depth.** Soft caps in the Swarm + soft caps in the userscript + PropStream's hard cap. Three layers, because a bug in any one of them shouldn't blow the monthly budget.

**PII flows through Hermes only.** Skip-trace data, owner contact info, and anything else legally sensitive goes Swarm → Hermes → operator. It never lands in Discord channels, console logs, or persistent userscript storage.

**Regulation is a moving target.** Wholesaling laws change quarterly across the U.S. The blocklist refreshes on a schedule, not on vibes.

## License

Private project. Not open source. Do not redistribute.
