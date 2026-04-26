# Changelog

Architectural decisions and significant changes, in reverse chronological order.

Each entry should answer: *what changed*, *why it changed*, and *what it affects downstream*.

---

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

**Affects:** `#house-seller-motivation` (formula), `#queue` (priority sorting), `#strategy-router` (persona-aware adjustment).

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
