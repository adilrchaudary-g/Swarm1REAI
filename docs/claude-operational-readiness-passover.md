# Claude Passover — Operational Readiness Execution

This document is for Claude to execute against the operational readiness template in this repo.

The goal is not to invent a new system. The goal is to convert the repo's current truth into a clean, usable working readiness document.

---

## 1. Mission

Use [operational-readiness-template.md](/Users/adilchaudary/Desktop/wholesaling-swarm/docs/operational-readiness-template.md) to produce a filled working document that reflects:

- the current active architecture
- the current PropStream runner truth
- the current live validation status
- the real blockers between "interesting prototype" and "operational system"

The output should help the operator answer:

- what is already proven
- what is still broken
- what the ideal list must look like
- what must be true before a real large skip-trace run is allowed

---

## 2. Required Output

Create a new document:

- `docs/operational-readiness-working.md`

Do not overwrite the template.

The working doc should be mostly filled in from repo evidence. If something cannot be supported from repo truth, leave it clearly marked as:

- `TBD`
- `Needs operator decision`
- `Not yet proven`

Do not fabricate missing business rules.

---

## 3. Scope Constraints

You must stay inside the current active system scope.

That means:

- `houses` lane only
- national virtual `SFR detached` wholesaling only
- no multi-division strategy layer
- no buyer-side dispo module
- no outbound outreach ownership by the system
- no new architecture proposals unless explicitly labeled as future/non-blocking

Do not reopen:

- rentals
- commercial
- land
- buyer matching
- broader CRM design
- Discord-first workflow assumptions

The local filesystem-first Playwright runner path is the active PropStream path.

---

## 4. Sources Of Truth

Use these as primary sources, in this order:

1. [docs/system-design-v1.md](/Users/adilchaudary/Desktop/wholesaling-swarm/docs/system-design-v1.md)
2. [docs/codex-handoff-v4.md](/Users/adilchaudary/Desktop/wholesaling-swarm/docs/codex-handoff-v4.md)
3. [README.md](/Users/adilchaudary/Desktop/wholesaling-swarm/README.md)
4. [docs/operational-readiness-template.md](/Users/adilchaudary/Desktop/wholesaling-swarm/docs/operational-readiness-template.md)
5. The most recent live-run manifests under:
   [lead-vault/acquisition/propstream/runs](/Users/adilchaudary/Desktop/wholesaling-swarm/lead-vault/acquisition/propstream/runs)
6. PropStream runner implementation under:
   [propstream-runner/src](/Users/adilchaudary/Desktop/wholesaling-swarm/propstream-runner/src)

Use changelog entries only as supporting context, not as the sole basis for technical claims.

---

## 5. Current Live Truth You Should Preserve

At the time of this handoff, the current validated truth is:

### Proven live

- PropStream authentication works well enough for repeated search attempts with recovery.
- ZIP search works against live PropStream.
- Filters apply at least for the current validation case:
  - `vacant`
  - `sfr_detached`
- Real result rows/cards are being harvested from live PropStream.
- The live test market used so far is:
  - `44149` Strongsville, Ohio
- The current runner can identify and select visible live result checkboxes.

### Partially proven

- Search result parsing works well enough to capture real candidate properties.
- Direct row selection is now real, but it has not yet been converted into a completed saved-list workflow.
- Skip-trace attempt counting is not the same thing as verified contact capture.

### Not yet proven

- save-to-list from live selected results
- reopening the saved list
- export returning usable rows from the saved list
- skip trace returning archived contact data
- production-safe high-volume batch execution

### Latest live manifest to reference first

Start with:

- [manifest.json](/Users/adilchaudary/Desktop/wholesaling-swarm/lead-vault/acquisition/propstream/runs/2026-05-02T03-25-38-027Z-strongsville-oh-vacant-sfr-test-10/manifest.json)

Current key counts from that run:

- `discovered: 84`
- `saved: 0`
- `exported: 0`
- `skipTraced: 10`
- `archivedProperties: 0`
- `archivedContacts: 0`

Do not describe this as a successful skip-trace pipeline. It is not.

---

## 6. How To Fill The Template

### Section 1. Objective

Fill this from current repo purpose, not future ambition.

Good framing:

- get the PropStream runner operational enough to build, save, export, and skip trace a high-quality wholesale lead list into the lead vault

Avoid:

- generic "build an AI real estate platform"

### Section 2. Current Status Snapshot

Prefill aggressively from evidence.

This section should be one of the most complete sections in the working document.

### Section 3. Go / No-Go Rule

Treat this as a real launch gate.

The current status should clearly imply:

- large live skip-trace run = `No-Go`

until the save/list/export/contact-capture path is proven.

### Section 4. PropStream Execution Map

Be concrete.

This is where you should document:

- what route/page the runner uses
- what filters are currently live
- what exact step is failing
- where the UI assumptions are still wrong

Do not hand-wave with "UI still needs work."
Name the exact failing behavior.

### Section 5. Ideal List Definition

Use current wholesaling scope.

Do not invent advanced list criteria unless already present in repo logic.

If something is a business choice rather than a technical fact, mark it as:

- `Needs operator decision`

### Sections 6–8

Use documented architecture, but do not pretend the market selector, persona model, and underwriting stack are fully runnable modules today.

The working doc should distinguish:

- documented intended logic
- live implemented logic

That distinction matters.

### Section 9. Data And Archive Requirements

Use the current lead-vault pathing and artifact structure actually present in the repo.

### Section 10. QA Checklist

This should be strict.

The operator should be able to use it before authorizing a real batch.

### Section 11. Scale Plan

Do not jump straight to `3000`.

Recommend gated progression only if clearly labeled as a scale rule, for example:

- tiny validation
- small batch
- medium batch
- full batch

### Section 12. Current Blockers

This is the second-most important section after current status.

At minimum, capture these blockers:

1. save-to-list is not yet opening a usable modal from selected live results
2. saved-list reopen/export path is not validated
3. skip trace has not returned archived contact records

### Section 14. Final Launch Signoff

Leave signoff placeholders intact unless the repo actually supports the statement.

Do not pre-approve launch.

---

## 7. Writing Rules

Use plain operational language.

Prioritize:

- exactness
- current truth
- launch readiness
- explicit unknowns

Avoid:

- aspirational fluff
- broad product strategy
- generic AI language
- pretending documented modules are live if they are not

When uncertain:

- prefer `TBD`
- prefer `Not yet proven`
- prefer `Needs operator decision`

over invention.

---

## 8. Deliverable Quality Bar

The finished working doc should let the operator do three things immediately:

1. see the current real state of the PropStream pipeline
2. understand the exact blockers to a real production run
3. know what decisions or validations are still required before launch

If the document cannot do those three things, it is not done.

---

## 9. Nice-To-Have But Optional

If helpful, add one short section at the end:

- `Appendix: Evidence References`

This can list the specific manifests, docs, and implementation files used to fill the working doc.

Do not turn it into a full audit trail unless needed.
