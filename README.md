# Wholesaling Swarm

A multi-agent system for autonomous virtual wholesaling of single-family residential real estate. Coordinated through a Discord-based operating layer (Hermes/Alfred), powered by PropStream Pro as the data engine, and bridged to PropStream via a TamperMonkey userscript.

> **Project status:** Alfred/Hermes runs separately from this repo. The active bridge contract is v4, the PropStream UI reference is now documented in-repo, and the userscript is in hardened-prototype status pending live selector validation and end-to-end operator testing.

---

## What this is

Most wholesaling operations are one person on a phone with a spreadsheet. This is a swarm of specialized AI agents that handle market selection, distress monitoring, persona classification, motivation scoring, underwriting, and routing — surfacing only the highest-quality leads to a human at the end. The human's job becomes "talk to the seller and close," not "find the seller."

The core insight: each step of the wholesaling pipeline is a different problem with different signals, different data sources, and different failure modes. Treating them as separate agents that pass data between each other (instead of one monolithic system) means each piece can be tested, improved, and replaced independently.

## Architecture at a glance

The Discord server is now organized by pipeline stage, not by houses-vs-land top-level lanes:

**00-command-center**: `#alfred`, `#ops-log`, `#announcements`

**01-market-intel**: `#market-selector`, `#distress-monitoring`, `#list-builder`

**02-lead-engine**: `#opportunity-intake`, `#lead-enrichment`, `#seller-motivation`, `#seller-persona`, `#seller-response-triage`, `#strategy-router`, `#follow-up-orchestrator`, `#queue`

**03-underwriting**: `#fast-underwriting`, `#kpi-intelligence`, `#done-feed`

**04-propstream-bridge**: `#propstream-commands`, `#propstream-results`, `#propstream-quota`

**05-build**: `#hermes-dev`, `#swarm-dev`, `#automation`, `#bugs`

Hermes is the orchestrator/backend. Alfred is the running Discord bot instance the operator talks to. The PropStream bridge still emits `lane: "houses"` in its envelope contract for future-proofing, even though houses is the only active lane today.

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
                    └──────────┬──────────┘
                               │
          ┌────────────────────┼────────────────────┐
          │ HTTP (primary)     │ Discord (mirror)   │
          ▼                    ▼                    ▼
  ┌───────────────┐   ┌──────────────────┐  ┌──────────────────┐
  │  Userscript   │   │   #propstream-   │  │   #propstream-   │
  │  (browser)    │   │     commands     │  │      results     │
  └───────┬───────┘   └──────────────────┘  └──────────────────┘
          │
          ▼
  ┌───────────────┐
  │   PropStream  │
  │   web app     │
  └───────────────┘
                                               ┌──────────────────┐
                                               │   #propstream-   │
                                               │      quota       │
                                               └──────────────────┘
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
│   ├── codex-handoff-v4.md         Current spec for the PropStream
│   │                               TamperMonkey bridge.
│   ├── codex-handoff-v3.md         Previous bridge handoff, kept
│   │                               for reference/history only.
│   ├── codex-handoff-v2.md         Previous bridge handoff, kept
│   │                               for reference/history only.
│   ├── propstream-ui-reference/
│   │   ├── README.md               PropStream UI ground truth for
│   │   │                           selectors and flow assumptions.
│   │   └── export-schema.md        Export column schema and canonical
│   │                               field mapping.
│   ├── regulatory-blocklist.md     States to skip / penalize. Refresh
│   │                               quarterly.
│   └── changelog.md                Decision log over time.
├── userscript/                     TamperMonkey bridge implementation,
│                                   protocol docs, selector map, and
│                                   test checklist.
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
3. Use `docs/codex-handoff-v4.md`, `docs/propstream-ui-reference/README.md`, `docs/propstream-ui-reference/export-schema.md`, and the files in `userscript/` as the active bridge package.
4. Set up your secrets locally — see `secrets/README.md`.

### If you're Codex (or any future contributor on the userscript)

1. Read `docs/codex-handoff-v4.md` end to end.
2. Read `docs/propstream-ui-reference/README.md` and `docs/propstream-ui-reference/export-schema.md` before touching selectors or export parsing.
3. Resolve the open decisions in Section 4.4 with the operator before writing code.
4. Build deliverables into `userscript/` per Section 13.
5. Update `docs/changelog.md` with significant decisions you make along the way.

### If you're a future agent or human picking this up cold

Read in this order: this README → `docs/system-design-v1.md` → `docs/motivation-scoring-v1.md` → `docs/codex-handoff-v4.md` → `docs/propstream-ui-reference/README.md` → `docs/propstream-ui-reference/export-schema.md` → `docs/changelog.md`. That's roughly an hour of reading and you'll have full context.

## Operating principles

These show up implicitly across the docs but are worth stating explicitly:

**Confidence over confidence.** The system reports how much it trusts its own outputs. An underwrite with 0.4 confidence is treated differently from one with 0.9, even if the headline numbers are the same. Build agents that know what they don't know.

**Lane future-proofing.** The server is stage-organized now, but the bridge still preserves an explicit `houses` lane in its envelope contract. That keeps future multi-lane expansion possible without reworking the bridge contract later.

**Quota safety in depth.** Soft caps in the Swarm + soft caps in the userscript + PropStream's hard cap. Three layers, because a bug in any one of them shouldn't blow the monthly budget.

**PII flows through Hermes only.** Skip-trace data, owner contact info, and anything else legally sensitive goes Swarm → Hermes → operator. It never lands in Discord channels, console logs, or persistent userscript storage.

**Regulation is a moving target.** Wholesaling laws change quarterly across the U.S. The blocklist refreshes on a schedule, not on vibes.

## License

Private project. Not open source. Do not redistribute.
