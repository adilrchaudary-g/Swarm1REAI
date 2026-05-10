# Changelog

Architectural decisions and significant changes, in reverse chronological order.

Each entry should answer: *what changed*, *why it changed*, and *what it affects downstream*.

---

## 2026-05-01 — Claude passover doc added for readiness-template execution

**What:** Added `docs/claude-operational-readiness-passover.md`, a task-specific handoff doc telling Claude how to convert the repo's current truth into a filled operational readiness working document from the template.

**Why:** The readiness template by itself is a structure. The operator also needs an execution brief that makes the constraints, active scope, source-of-truth files, current live findings, and fill rules explicit so another model does not widen scope or invent operational status that has not been proven.

**Affects:** Claude handoff quality, readiness-document consistency, and future operator reviews of what is and is not production-ready.

---

## 2026-05-01 — Operational readiness template added

**What:** Added `docs/operational-readiness-template.md` as a fill-in working template for mapping the exact gates, blockers, quality rules, and signoff conditions required before the system is treated as operational for live PropStream list-building and skip trace runs.

**Why:** The current gap is not architectural theory. It is operational clarity. A single template makes it easier to separate what is already proven, what is still failing, what the ideal list must look like, and what must be true before a real high-volume batch is allowed.

**Affects:** Live test planning, run readiness reviews, list quality definition, save/export/skip-trace validation, and operator launch criteria.

---

## 2026-05-01 — Playwright runner promoted as preferred filesystem-first PropStream path

**What:** Promoted `propstream-runner/` as the preferred replacement for TamperMonkey when the goal is direct PropStream harvesting into a local lead vault rather than Discord-first organization. Added a repo-level `lead-vault/` scaffold, wired the runner's archive root to that folder by default, and documented the split between runtime artifacts and harvested lead storage.

**Why:** TamperMonkey is workable for in-page control, but it is a poor center of gravity for a local lead system. Userscript storage is browser-scoped, filesystem handling is indirect, and the Discord/Hermes mirroring model is unnecessary for direct list-building. The Playwright runner already supports authenticated browser automation plus on-disk archival, so making it the primary path is lower-risk and better aligned with a folder-first workflow.

**Affects:** `propstream-runner/`, `lead-vault/`, root README guidance, harvested lead storage defaults, and future PropStream acquisition work.

---

## 2026-05-01 — Portfolio Director added as wholesale-only overview agent

**What:** Added a `Portfolio Director` agent to the active architecture as a command-center overview layer for wholesale deals flowing through market intel, lead engine, and underwriting. Updated the root README, `docs/system-design-v1.md`, and `docs/codex-handoff-v4.md` to reflect the new role and channel.

**Why:** The current system had strong specialized agents but no explicit top-level observer for the wholesaling pipeline as a whole. The operator wants an overview agent that can spot bottlenecks, summarize queue health, and direct attention without reopening multi-division strategy, outbound outreach ownership, or buyer-side workflow scope.

**Affects:** `#portfolio-director`, command-center architecture, top-level wholesale prioritization, and any future Hermes routines that emit pipeline-health summaries for operator review.

---

## 2026-05-01 — System design doc tightened around listed-property fatigue and virtual-underwrite limits

**What:** Added a small set of transcript-aligned clarifications to `docs/system-design-v1.md`: listed-property fatigue signals now sit explicitly inside the existing distress bucket, image-history change detection is called out inside persona/condition analysis, and virtual underwriting is framed more clearly as triage with confidence limits rather than final authority.

**Why:** These ideas already fit the current architecture and sharpen how the existing agents should reason, but they do not justify new modules or a new pipeline shape. The useful move is to make the existing design more explicit without widening scope.

**Affects:** `#market-selector`, `#seller-persona`, `#fast-underwriting`, and any future implementation that consumes listed-market text/history or visual condition signals.

## 2026-04-27 — Codex handoff v4 adopted locally

**What:** Promoted `docs/codex-handoff-v4.md` to the active bridge handoff, added the in-repo PropStream UI ground-truth reference and export schema, removed `MONITOR` from the live userscript protocol surface, and aligned docs around export-schema-driven batch skip-trace as the preferred v4 path.

**Why:** The operator gathered a real PropStream UI walkthrough and export sample after v3. Those artifacts resolve earlier uncertainty around monitoring, export format, skip-trace data shape, and AG-Grid behavior, so the repo should stop treating the older v3 assumptions as current truth.

**Affects:** Root README, bridge docs, active handoff references, userscript protocol/selector guidance, and any future Alfred integration that expects `MONITOR` or format-picking export behavior.

## 2026-04-27 — Codex handoff v3 adopted locally, with houses lane preserved

**What:** Adopted Alfred/Hermes v3 naming and stage-based server structure in the local repo while explicitly preserving `lane: "houses"` and `OUT_OF_LANE_SCOPE` behavior in the bridge for future additional lanes.

**Why:** The operator has moved the Discord/Hermes operating model to stage-based categories and new PropStream bridge channels, but still wants the bridge to remain lane-scoped so a second lane can be added later without breaking protocol or runtime assumptions.

**Affects:** Root README, bridge docs, userscript config/alerts, and any future Hermes integration work that relies on channel naming or lane validation.

## 2026-04-26 — Initial userscript scaffold added

**What:** Added the first implementation pass of the PropStream TamperMonkey bridge under `userscript/`, including the installable script, protocol reference, selector-maintenance guide, and operator test checklist.

**Why:** The repo previously held only the spec and placeholder folder. Shipping the scaffold makes the bridge concrete enough to wire into Hermes, configure secrets locally, and begin real PropStream validation without waiting on a second architecture cycle.

**Affects:** `userscript/`, operator setup flow, Hermes integration testing, and future selector-hardening work against the live PropStream DOM.

## 2026-04-26 — Initial repo scaffold

**What:** Created the wholesaling-swarm repo with full doc set, .gitignore, secrets layout, and helper scripts.

**Why:** All design work to date lived in chat threads and standalone artifacts. Consolidating into a versioned repo so future contributors (Codex, future agents, future hires) have a single source of truth, and so changes can be tracked over time.

**Affects:** All future work happens here. Chat threads are no longer the source of truth.

---

## 2026-04-26 — Codex handoff v2 (supersedes v1)

**What:** Updated TamperMonkey bridge handoff doc to reflect the actual Hermes architecture.

**Changes from v1:**
- Architecture split into shared backbone vs. lane-specific channels (bridge serves Houses lane only)
- Primary transport is Hermes HTTP endpoint (operator confirmed Hermes has a backend)
- Discord webhooks become audit/observability mirror only, not command transport
- Two new dedicated channels: `#house-propstream-commands` (inbound mirror) and `#house-propstream-results` (outbound mirror)
- Added `lane` field to message envelopes — mandatory, must be `"houses"`
- New error code `OUT_OF_LANE_SCOPE` for cross-lane command rejection
- Skip-trace data goes only to Hermes via HTTPS; never mirrored to Discord at any verbosity

**Why:** v1 assumed Hermes was Discord-bot-only and treated all wholesaling agents as a flat list. Operator's actual setup has Hermes with HTTP backend and a clean shared-backbone-vs-lanes structure. Bridge architecture should match.

**Affects:** Codex builds against v2. v1 is archived in git history but not referenced.

---

## 2026-04-26 — Outreach templates and dispo matching descoped from current cycle

**What:** Removed the outreach template module and dispo matching workflow from the active design.

**Why:** Operator explicit choice. Buyer pool is already solved (dispo matching less critical short-term). Outreach copy can be designed in a later cycle once the upstream pipeline is producing real qualified leads.

**Affects:** `#house-outreach` and `#house-buyer-match-dispo` channels exist but are placeholders. No specs delivered to those channels in v1 framework rollout.

---

## 2026-04-26 — Motivation scoring formalized

**What:** Motivation scoring extracted from chat into a standalone doc with full formula, decay, and persona-aware threshold adjustments.

**Why:** Motivation is the queue priority signal — it's how the system answers "of 5,000 leads, which 50 should I touch today?" Worth a dedicated doc rather than living buried in the chat.

**Affects:** `#seller-motivation` (formula), `#queue` (priority sorting), `#strategy-router` (persona-aware adjustment).

---

## 2026-04-26 — Regulatory blocklist v1

**What:** Compiled current state-by-state wholesaling regulation status. 6 states blocked (SC, IL, OK, KY, PA, VA), 10 states high-friction (CT, OR, MD, AZ, CA, IA, TN, IN, WI, ND), rest green.

**Why:** National virtual wholesaling means the Market Selector picks zips from anywhere. Without a regulatory pre-filter, the system would happily target zips in states where wholesaling is illegal or impractical. Defense in depth: filter at Market Selector AND userscript level.

**Affects:** Market Selector (primary), userscript bridge (secondary), refresh schedule (quarterly).

---

## 2026-04-26 — Operator profile locked

**What:** Operator profile finalized as: national virtual, SFR detached only, $200–400k sweet spot ($150–500k acceptable), $20k assignment floor ($25–50k typical), buyer pool already solved.

**Why:** Each constraint tightens the system filters. Without explicit profile, every agent would have to support every possible variant.

**Affects:** Every agent in the system. Market Selector (price band fit), Underwriting (MAO formula), Router (four gates), Persona Classifier (SFR-relevant signals only).

---

## Template for future entries

```
## YYYY-MM-DD — short title

**What:** One sentence describing the change.

**Why:** One paragraph on the reasoning. Include what alternatives were considered and rejected if relevant.

**Affects:** Which agents, channels, or docs need to know about this.
```
