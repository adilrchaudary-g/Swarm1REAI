# Operational Readiness Template

Use this to map what must be true before the system is considered operational for live PropStream list-building, save, export, skip trace, and human outreach.

Fill this out as a working document, not a pitch deck.

---

## 1. Objective

**Primary operational goal:**  
[fill in]

**What "operational" means in plain English:**  
[fill in]

**Current live target:**  
- Market / zip / county: [fill in]
- Asset type: [fill in]
- Lead count goal: [fill in]
- Skip trace goal: [fill in]
- Outreach owner: [fill in]

---

## 2. Current Status Snapshot

**What is already proven live:**  
- [fill in]
- [fill in]
- [fill in]

**What is partially working:**  
- [fill in]
- [fill in]

**What is not yet working:**  
- [fill in]
- [fill in]
- [fill in]

**Date of this snapshot:**  
[fill in]

---

## 3. Operational Go / No-Go Rule

**We are allowed to run a real large skip-trace batch only if all of these are true:**  
- [ ] PropStream auth is stable enough for repeated runs
- [ ] Search works on the intended target market
- [ ] Filters apply exactly as intended
- [ ] Result count and result rows match the intended query
- [ ] Save-to-list works on live selected rows
- [ ] Saved list can be reopened reliably
- [ ] Export works and returns usable rows
- [ ] Skip trace returns usable contact data
- [ ] Archived output lands in the correct lead-vault location
- [ ] Final list quality passes human review

**Hard no-go conditions:**  
- [fill in]
- [fill in]
- [fill in]

---

## 4. PropStream Execution Map

### 4.1 Search

**Entry page / route:**  
[fill in]

**Search input used:**  
[fill in]

**Known working search behavior:**  
[fill in]

**Known failure modes:**  
- [fill in]
- [fill in]

### 4.2 Filter Layer

**Required filters for the live list:**  
- [fill in]
- [fill in]
- [fill in]

**Optional filters under consideration:**  
- [fill in]
- [fill in]

**Filters that should never be used for this list:**  
- [fill in]
- [fill in]

### 4.3 Row Selection

**How rows are selected today:**  
[fill in]

**How many rows can be safely selected in one pass:**  
[fill in]

**Known row-selection blockers:**  
- [fill in]
- [fill in]

### 4.4 Save to List

**Expected save control:**  
[fill in]

**Expected modal or confirm step:**  
[fill in]

**Current save failure behavior:**  
[fill in]

### 4.5 Export

**Expected export path:**  
[fill in]

**Expected export format:**  
[fill in]

**Minimum required fields in export:**  
- [fill in]
- [fill in]
- [fill in]

### 4.6 Skip Trace

**Expected skip trace path:**  
[fill in]

**Expected output fields:**  
- [fill in]
- [fill in]
- [fill in]

**How we know skip trace truly worked:**  
[fill in]

---

## 5. Ideal List Definition

**This list is for:**  
[fill in]

**Who should be on the list:**  
- [fill in]
- [fill in]
- [fill in]

**Who should not be on the list:**  
- [fill in]
- [fill in]
- [fill in]

**Minimum quality standard for outreach:**  
[fill in]

**Disqualifying traits:**  
- [fill in]
- [fill in]
- [fill in]

---

## 6. Market Selector Inputs

**Documented heuristics we want the market selector to honor:**  
- [fill in]
- [fill in]
- [fill in]

**External cross-check sources we trust:**  
- [fill in]
- [fill in]
- [fill in]

**How we break ties between candidate zips:**  
[fill in]

**Current preferred test market and why:**  
[fill in]

---

## 7. Seller Persona Rules

**Primary persona buckets for this list:**  
- [fill in]
- [fill in]
- [fill in]

**Signals we care about most:**  
- [fill in]
- [fill in]
- [fill in]

**Signals we do not trust enough yet:**  
- [fill in]
- [fill in]

**How persona should affect outreach priority:**  
[fill in]

---

## 8. Underwriting Rules

**What the underwriting pass must estimate:**  
- [fill in]
- [fill in]
- [fill in]

**What underwriting is allowed to do at triage stage:**  
- [fill in]
- [fill in]

**What underwriting is not allowed to pretend it knows:**  
- [fill in]
- [fill in]
- [fill in]

**Minimum spread / equity / condition rules for inclusion:**  
[fill in]

---

## 9. Data and Archive Requirements

**Lead vault destination for this workflow:**  
[fill in]

**Required saved artifacts:**  
- [fill in]
- [fill in]
- [fill in]

**Required fields on each lead record:**  
- [fill in]
- [fill in]
- [fill in]

**Required fields on each contact record:**  
- [fill in]
- [fill in]
- [fill in]

---

## 10. QA Checklist Before First Real Batch

**Small-batch QA size:**  
[fill in]

**The QA batch passes only if:**  
- [ ] Search results match the intended query
- [ ] Selected rows are the intended rows
- [ ] Save actually creates a usable list
- [ ] Export contains real rows
- [ ] Skip trace returns real phone/email records
- [ ] Archived files are not empty
- [ ] A human would actually text this list

**Human QA notes:**  
[fill in]

---

## 11. Scale Plan

**Stage 1 batch size:**  
[fill in]

**Stage 2 batch size:**  
[fill in]

**Full batch size:**  
[fill in]

**What must be true before moving from one stage to the next:**  
- [fill in]
- [fill in]
- [fill in]

---

## 12. Current Blockers

**Blocker 1:**  
- Description: [fill in]
- Why it matters: [fill in]
- Owner: [fill in]
- Status: [fill in]
- Next step: [fill in]

**Blocker 2:**  
- Description: [fill in]
- Why it matters: [fill in]
- Owner: [fill in]
- Status: [fill in]
- Next step: [fill in]

**Blocker 3:**  
- Description: [fill in]
- Why it matters: [fill in]
- Owner: [fill in]
- Status: [fill in]
- Next step: [fill in]

---

## 13. Decision Log

**Decision:**  
[fill in]

**Why:**  
[fill in]

**Tradeoff accepted:**  
[fill in]

**Date:**  
[fill in]

---

## 14. Final Launch Signoff

**Operator signoff:**  
[fill in]

**Technical signoff:**  
[fill in]

**Approved first real production run:**  
- Date: [fill in]
- Market: [fill in]
- Lead count: [fill in]
- Skip trace count: [fill in]

**Post-run review date:**  
[fill in]
