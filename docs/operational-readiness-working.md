# Operational Readiness — Working Document

Filled from repo evidence as of 2026-05-02. This is a living document, not a pitch deck.

---

## 1. Objective

**Primary operational goal:**
Get the PropStream Playwright runner operational enough to build, save, export, and skip trace a high-quality wholesale lead list into the lead vault — for a single test market first, then scale.

**What "operational" means in plain English:**
The runner can take a zip code, search PropStream, apply filters, save matching properties to a named list, export that list as CSV, run skip trace to get owner contact data, and archive the results to disk — all without manual intervention beyond initial auth.

**Current live target:**
- Market / zip / county: `44149` — Strongsville, Cuyahoga County, Ohio
- Asset type: SFR detached (Single Family Residential)
- Lead count goal: Needs operator decision (test runs have used maxResults=10)
- Skip trace goal: Needs operator decision (test runs have used maxSkipTraces=10)
- Outreach owner: Operator (Adil) — the system does not own outbound outreach

---

## 2. Current Status Snapshot

**What is already proven live:**
- PropStream authentication works via persistent Chrome profile seeding (`bootstrap-auth` and `waitForManualSearchReady` flows both validated)
- Credential-based auto-login works on the login page when username/password env vars are set
- ZIP code search executes against live PropStream — zip `44149` returns real results
- Filters apply for `vacant` and `sfr_detached` via the `applyFilters` method (clicks "Vacant" and "Single Family" in the filter panel)
- Real result cards are harvested from live search results — latest run discovered 84 properties
- Each extracted row captures: property_id (route hint like `/search/1805455195`), summary text with address, price, beds/baths/sqft, lot size, equity, loan balance, last sale date
- The page bridge (`__PS_RUNNER__`) injects successfully and provides DOM interaction primitives: snapshot, bulk selection, input range, actions menu, checkbox clicks
- Blocking overlay dismissal works (PropStream update modals, chat widgets, body scroll locks)
- Session-expired detection and captcha detection produce correct error codes
- Archive store creates run directories with manifest, query, pages, and raw-export artifacts
- Manifest tracking works end-to-end with accurate timestamps and counts
- 21+ runs have been executed against the same test market between 02:26 and 03:25 UTC on 2026-05-02

**What is partially working:**
- Search result parsing captures real candidate properties, but the extracted card summary is a raw text blob — structured field parsing (beds, baths, sqft, price as separate fields) is not yet broken out at extraction time
- Row selection via visible checkboxes is implemented (`saveVisibleRangeToList` finds `[id^='property-'] input[type='checkbox']` and clicks them) — the latest run's code path does reach this point, but save-to-list does not complete
- Bulk action flows (Actions menu → Input Range → Show Property Range → select all → Save) are implemented in the page bridge but are falling through to the visible-range fallback, which also fails
- Skip trace attempt counting (skipTraced=10 in manifest) records the intent, but no contact data is returned — the export that should capture skip-traced contacts returns an empty array
- The supervisor recovery system (rule-based or OpenAI) can detect `DOM_SELECTOR_MISSING` and `ACTION_NOT_CONFIRMED` errors and attempt recovery actions, but has not successfully recovered any save/export failures in observed runs

**What is not yet working:**
- Save-to-list: latest manifest shows `saved: 0`. Both the bulk range path and the visible checkbox fallback path fail to produce a confirmed save. The "Add to Group" modal either does not open or is not detected by the `waitForCondition` check for `[role='dialog']` with text matching `/list|marketing/i`
- Export: latest manifest shows `exported: 0`. The raw-exports JSON file is an empty array `[]`. The export flow depends on a successful save, so it cannot produce data until save works
- Skip trace contact capture: `archivedContacts: 0`. The `skipTraceBatch` method calls skip trace then immediately exports, but since export returns empty, no contact records are archived
- Property archiving: `archivedProperties: 0`. Depends on export returning rows, which it does not
- CSV download interception: the `parseDownload` path (Playwright `waitForEvent("download")`) has not been validated with a real PropStream CSV export
- Saved list navigation: `navigateToListByName` goes to `/property/group/0` and tries to click a list by text match — not yet proven against live PropStream My Properties page
- Production-safe batch execution at any volume beyond a single test

**Date of this snapshot:** 2026-05-02

---

## 3. Operational Go / No-Go Rule

**We are allowed to run a real large skip-trace batch only if all of these are true:**
- [x] PropStream auth is stable enough for repeated runs
- [x] Search works on the intended target market
- [x] Filters apply exactly as intended (vacant + sfr_detached confirmed)
- [ ] Result count and result rows match the intended query — partially proven (84 discovered, but no structured validation that all 84 are actually vacant SFR detached)
- [ ] Save-to-list works on live selected rows — **NOT WORKING** (saved=0)
- [ ] Saved list can be reopened reliably — **NOT PROVEN**
- [ ] Export works and returns usable rows — **NOT WORKING** (exported=0, raw-exports=[])
- [ ] Skip trace returns usable contact data — **NOT WORKING** (archivedContacts=0)
- [ ] Archived output lands in the correct lead-vault location — NOT PROVEN (archivePropertyRecords never executes because export returns empty)
- [ ] Final list quality passes human review — NOT PROVEN

**Current verdict: NO-GO for any production skip-trace batch.**

**Hard no-go conditions:**
- Save-to-list returns 0 confirmed saves
- Export returns an empty array instead of parsed CSV rows
- Skip trace has not returned a single archived contact record
- No human has reviewed a complete lead record with contact data from this pipeline

**Root cause identified (2026-05-02):** Result row selectors were too broad — matching Map Analytics widgets ($/SqFt, Market Trend, etc.) instead of property cards in the Search-Results panel. Fixed by scoping selectors to `div[class*="Search-Results-style"] div[class*="__content"] div[class*="__item"]`. Auth verification also added to `openSearch()` to prevent silent session expiry. Requires re-test with live headed browser to validate.

---

## 4. PropStream Execution Map

### 4.1 Search

**Entry page / route:**
`https://app.propstream.com/search` — navigated via `browser.gotoSearchPage()`

**Search input used:**
ZIP code typed into `input[placeholder*="Zip Code"]` via the `react-autosuggest` combobox. The runner uses `setInputValue` with a fallback selector chain including `input[placeholder*="Zip" i]`, `input[placeholder*="ZIP" i]`, `input[placeholder*="County" i]`.

**Known working search behavior:**
- Entering zip `44149` and submitting (via click on `div[class*="iconSearch"]` or text match on "Search") returns results
- Results panel appears with property cards under `div[class*="__content"] div[class*="__item"]`
- Each card contains: property type, price/estimate, address, beds/baths/sqft/lot, equity, loan balance, last sale
- 84 properties discovered in the latest filtered search

**Known failure modes:**
- PropStream occasionally shows blocking overlays (update modals, webinar promos, chat widgets) that prevent interaction — the `dismissBlockingOverlays` method handles most but may miss new overlay types
- After filter application, the search submit button selector (`div[class*="iconSearch"]`) may not match if PropStream changes its icon class — the fallback chain tries text matching on "search", "apply", "update"
- Search results include non-property rows (market trend cards like "Last 30 Days", "Average Days on Market") — the `looksLikePropertyRow` filter removes these by regex, but the filter is heuristic

### 4.2 Filter Layer

**Required filters for the live list:**
- `vacant` — clicks the "Vacant" Lead List card via text content match
- `sfr_detached` — clicks "Single Family" button via text content match (note: PropStream has no literal "SFR Detached" label; "Single Family" is the equivalent)

**Optional filters under consideration:**
- `tax_delinquent` — mapped to "Tax Delinquency" Lead List card (implemented in code but not used in test runs)
- `pre_foreclosure` — mapped to "Pre-Foreclosures" Lead List card (implemented in code)
- `probate` — mapped to "Pre-Probate" Lead List card (implemented in code)
- Price range via Estimated Value min/max (not yet wired in the runner's filter application)
- Pre-foreclosure timing via Auction Date range (documented in UI reference but not implemented)

**Filters that should never be used for this list:**
- Vacant Land (the latest run captured one Vacant Land row — `20651 Albion Rd` — because the filter does not exclude non-SFR vacant properties; the "Vacant" Lead List card includes all vacant property types, not just SFR)
- Commercial property types
- Any filter in a BLOCK-tier state (SC, IL, OK, KY, PA, VA) — enforced upstream by the regulatory pre-filter, not by the runner

### 4.3 Row Selection

**How rows are selected today:**
Two paths, both implemented:
1. **Bulk range path** (primary): page bridge `setBulkSelection` → `openActionsMenu` → `openBulkActionByText("Input Range")` → `setInputRange(start, end)` → `showPropertyRange()` → `setBulkSelection(true)` → `openBulkActionByText("Save")`
2. **Visible checkbox fallback**: finds `[id^='property-'] input[type='checkbox']` elements and clicks each one individually from index `startIndex-1` to `endIndex`

**How many rows can be safely selected in one pass:**
Not yet proven. Test runs have attempted 10 rows. The bulk range path supports arbitrary ranges. PropStream's card view renders visible results only (not AG-Grid virtualized like the My Properties table).

**Known row-selection blockers:**
- The bulk range path is failing silently — `saveSearchRangeToList` catches the error and falls through to `saveVisibleRangeToList`
- The visible checkbox fallback finds and clicks checkboxes (`checkboxCount > 0` logged), and reports `selected > 0`, but the subsequent "Save" button click either doesn't trigger the modal or the modal is not detected
- The `nearestBulkPanel()` page bridge function may not be finding the correct ancestor element that contains both the Actions button and the checkboxes in the search results view (it's designed for the My Properties toolbar, not the search results header)

### 4.4 Save to List

**Expected save control:**
After selecting rows, the runner clicks "Save" which should open the "Add to Group" modal (documented as `div[class*="AddToMarketingListModal"]` with `h3` title "Add to Group").

**Expected modal or confirm step:**
1. Modal appears with a list search input and `li` options for existing lists
2. Runner types the list name into the input
3. Runner clicks the matching `li` option
4. Runner clicks the modal footer's "Save" button
5. Modal closes, toast appears with "properties saved to '<list name>'"

**Current save failure behavior:**
The `waitForCondition` check looks for `[role='dialog']` or `[aria-modal='true']` with text matching `/list|marketing/i`, OR any element matching the `listInputs` selectors (`input[placeholder*="list" i]`, `[role="dialog"] input`). This condition times out after 10 seconds, throwing `"Save list modal did not open"`. The exact failure is one of:
1. The "Save" button click is not actually triggering (the Actions dropdown may close before the Save option is clicked)
2. The modal opens but does not match the expected selectors — PropStream's modal may use `class*="AddToMarketingListModal"` without `role='dialog'` or `aria-modal='true'`
3. The modal opens briefly and auto-closes because no rows are actually selected from PropStream's perspective (the checkbox clicks may not register with React's state)

**This is Blocker #1. It must be debugged with a live headed session.**

### 4.5 Export

**Expected export path:**
1. Navigate to My Properties (`/property/group/0`)
2. Find and click the saved list by name
3. Click "Export" button
4. Playwright intercepts the CSV download via `page.waitForEvent("download")`
5. Parse CSV with `parseCsv` → map columns with `mapExportRows`

**Expected export format:**
CSV only (confirmed — PropStream has no format picker on Pro tier)

**Minimum required fields in export:**
- Address, City, State, Zip (property identity)
- Owner 1 First/Last Name (owner identity)
- Phone 1–5 with Type and DNC flags (skip trace contacts)
- Email 1–4 (skip trace contacts)
- Property Type, Bedrooms, Bathrooms, Sqft, Year Built (property details)
- Est. Value, Est. Equity, Est. Loan-to-Value (financial signals)
- Litigator flag (hard filter gate)

**Current status:** Not yet proven. Export depends on save working first.

### 4.6 Skip Trace

**Expected skip trace path (batch route, preferred for 5+ properties):**
1. Navigate to saved list in My Properties
2. Click "Skip Trace" toolbar button
3. Wait for Skip Trace order modal
4. Enter list name, verify order details
5. Click "Place Order"
6. Wait for completion
7. Export the list to CSV — skip-traced contacts populate Phone/Email columns

**Expected output fields:**
- Phone 1–5 (number, type: Mobile/Landline/VOIP, DNC flag: Yes/No)
- Email 1–4
- Owner names (already in export)

**How we know skip trace truly worked:**
- Export CSV contains non-null values in `Phone 1` or `Email 1` columns
- `archivedContacts > 0` in the run manifest
- Contact JSON files exist under `lead-vault/acquisition/propstream/properties/{state}/{zip}/{property-id}/contacts.json`

**Current status:** The runner increments the `skipTraced` counter (10 in latest manifest) but the actual skip trace flow does not complete — either the skip trace modal never opens on the saved list page (because there is no saved list), or the subsequent export returns empty. `archivedContacts: 0`.

---

## 5. Ideal List Definition

**This list is for:**
National virtual SFR detached wholesaling — identifying motivated sellers of single-family homes who are likely to accept a below-market cash offer, then assigning the contract to a cash buyer for a $20k–$50k fee.

**Who should be on the list:**
- Owners of vacant SFR detached properties in green-tier states
- Properties with estimated value in the $150k–$500k range (sweet spot: $200k–$400k)
- Owners showing distress signals: pre-foreclosure, tax delinquency, probate, failed MLS listings, vacancy
- Owners with enough equity to accept a discounted offer (high equity preferred)

**Who should not be on the list:**
- Properties in BLOCK-tier states (SC, IL, OK, KY, PA, VA)
- Owners flagged as Litigator=Yes in PropStream (TCPA/litigation risk)
- Owners on Do Not Mail list
- Properties that are not SFR detached (condos, townhomes, mobile homes, vacant land, multi-family)
- Needs operator decision: specific equity threshold, LTV threshold, property value floor/ceiling

**Minimum quality standard for outreach:**
- At least one valid phone number or email from skip trace
- Phone DNC flag = No on at least one number
- Litigator = No
- Needs operator decision: minimum motivation score threshold, maximum days since distress signal

**Disqualifying traits:**
- Litigator = Yes (hard gate per v4 protocol — no outreach regardless of motivation)
- All returned phone numbers are DNC = Yes and no emails available
- Property type is not SFR detached
- Needs operator decision: minimum equity dollar amount, maximum property value

---

## 6. Market Selector Inputs

**Documented heuristics we want the market selector to honor:**
- Price band fit: median SFR sale price $180k–$420k in the zip
- Cash buyer velocity: ≥15 cash sales per quarter in the zip
- Distress signal density: sum of NOD/lis pendens + tax delinquency + probate + code violations + expired/withdrawn MLS in the zip

**External cross-check sources we trust:**
- Documented intended: ATTOM, PropStream, BatchData for paid data; county assessor sites, FRED, BLS for public data
- Not yet implemented: no live market selector module exists in this repo

**How we break ties between candidate zips:**
Documented formula: `zip_score = (0.15 × price_band_fit) + (0.20 × cash_velocity) + (0.15 × flipper_density) + (0.25 × distress_signals) + (0.15 × (100 − wholesaler_saturation)) + (0.10 × spread_viability) − regulatory_penalty`

**Current preferred test market and why:**
`44149` Strongsville, Ohio — selected because Ohio is a green-tier state with workable disclosure requirements, and this zip produced 84 results with the current filter set. This appears to be the only market tested so far.

**Implementation status:** The market selector is documented intended logic only. There is no live market-selector module in this repo. All runs have been manual single-zip tests.

---

## 7. Seller Persona Rules

**Primary persona buckets for this list:**
- Tired Landlord (absentee, non-owner-occupied, 3+ years held, multiple properties)
- Probate Heir (recent probate filing, estate ownership, out-of-state mailing)
- Pre-Foreclosure (NOD/lis pendens filed, owner-occupied, recent mortgage)
- Vacant / Distant Absentee (mailing address 100+ miles from property, USPS vacancy, utilities disconnected)
- Tired Homeowner / Life Event (owner-occupied, 10+ years held, life transition signals)
- Code Violation / Problem Property (active violations, fire damage, condemned)

**Signals we care about most:**
- Ownership form (individual vs trust vs estate vs LLC) — available in PropStream export as Owner Occupied and owner name patterns
- Owner mailing address vs property address distance — available via export Mailing Address fields
- Years owned — available via property detail Length of Ownership
- Public filings (foreclosure, tax, probate) — available via Lead List filters

**Signals we do not trust enough yet:**
- Property condition from PropStream (Total/Interior/Exterior/Bathroom/Kitchen Condition columns) — documented in export schema but not yet validated from a real export
- Street View / satellite change-over-time analysis — not implemented, documented as future

**How persona should affect outreach priority:**
Documented intended logic — persona classification outputs a probability distribution that drives outreach template selection, channel choice, timing, and tone. Not yet implemented in any live module.

**Implementation status:** Documented intended logic only. No live persona classifier exists in this repo.

---

## 8. Underwriting Rules

**What the underwriting pass must estimate:**
- ARV (After-Repair Value) from comparable sales
- Repair estimate (cosmetic/moderate/heavy/gut tier)
- MAO = (ARV × discount_factor) − repairs − assignment_fee − holding_costs

**What underwriting is allowed to do at triage stage:**
- Use PropStream's `Est. Value` as a sanity-check upper bound (not as the ARV itself)
- Use `Est. Equity` and `Est. Loan-to-Value` for quick equity screening
- Use property condition fields from export for renovation tier classification

**What underwriting is not allowed to pretend it knows:**
- Exact interior condition from photos alone (hidden mechanicals, foundation, drainage)
- ARV confidence above 0.75 without 5+ clean comps with tight price-per-foot spread
- Repair costs for properties with no interior access data

**Minimum spread / equity / condition rules for inclusion:**
Documented formula: MAO must leave room for $20k floor assignment fee ($25k–$50k target). Median flip spread in the zip must be $50k+. Discount factor: 0.70 standard, 0.65 slow markets, 0.75 competitive markets.

**Implementation status:** Documented intended logic only. No live underwriting module exists in this repo.

---

## 9. Data and Archive Requirements

**Lead vault destination for this workflow:**
`lead-vault/acquisition/propstream/` — the active archive root configured via `PROPSTREAM_ARCHIVE_ROOT` env var or defaulting to `{repoRoot}/lead-vault/acquisition/propstream`

**Required saved artifacts (per run):**
- `runs/{runId}/manifest.json` — run metadata, query, counts, artifact paths — **working**
- `runs/{runId}/query/query.json` — the search query that produced this run — **working**
- `runs/{runId}/pages/page-NNNN.json` — extracted search result rows per page — **working**
- `runs/{runId}/raw-exports/{listName}.json` — parsed CSV export rows mapped to canonical schema — **not working** (empty array)

**Required fields on each lead record (from export mapping):**
- `address_full`, `address_street`, `address_city`, `address_state`, `address_zip` (property identity)
- `parcel_number` (APN)
- `property_type`, `bedrooms`, `bathrooms`, `square_feet`, `lot_size_sqft`, `year_built` (property details)
- `current_tax_assessment`, `last_sale_date`, `last_sale_price` (financials)
- `owner_name` (composed from Owner 1/2 First/Last)
- `propstream_arv_estimate`, `propstream_equity`, `propstream_ltv` (valuation signals)
- `litigator` (hard filter flag)

**Required fields on each contact record:**
- `phone_numbers` — array of `{number, type (Mobile/Landline/VOIP), dnc (Yes/No)}`
- `email_addresses` — array of email strings
- `contacts_returned` — total count

**Archive structure (per property, when working):**
```
lead-vault/acquisition/propstream/properties/{state}/{zip}/{property-id}/
  property.json   — full canonical record
  contacts.json   — phone/email data (PII, never mirrored to Discord)
```

**Index files:**
- `indexes/by-state/{state}.ndjson`
- `indexes/by-zip/{zip}.ndjson`
- `indexes/by-list/{list-slug}.ndjson`

**Current status:** Run manifests, queries, and page archives work. Property and contact archiving has never executed because the export pipeline returns empty data.

---

## 10. QA Checklist Before First Real Batch

**Small-batch QA size:** 5 properties from a single zip

**The QA batch passes only if:**
- [ ] Search results match the intended query (all results are SFR detached + vacant in the target zip)
- [ ] No Vacant Land or non-SFR rows are included (the current filter lets through Vacant Land — e.g., `20651 Albion Rd` in the latest page extract)
- [ ] Selected rows are the intended rows (checkbox selection confirmed via re-read)
- [ ] Save actually creates a usable list visible in My Properties (`/property/group/0`)
- [ ] The saved list name matches the expected `listName` parameter
- [ ] Export contains real rows with non-empty address, owner, and property fields
- [ ] Export CSV column mapping to canonical schema is correct (spot-check 3+ fields)
- [ ] Skip trace returns real phone/email records (at least 1 phone or email per property)
- [ ] Phone DNC flags are present and correctly parsed
- [ ] Litigator flag is present and correctly parsed
- [ ] Archived property JSON files are not empty
- [ ] Archived contact JSON files contain real phone numbers (not placeholder data)
- [ ] `manifest.json` counts match actual artifact contents: `saved == number of properties in My Properties list`, `exported == number of rows in raw-exports JSON`, `archivedContacts == number of contact.json files with data`
- [ ] A human reviews the final 5 leads and confirms: "I would actually reach out to these people"

**Human QA notes:**
TBD — cannot be completed until the save/export/skip-trace pipeline produces real data.

---

## 11. Scale Plan

**Stage 1 — Tiny validation (current):**
- 5–10 properties, single zip, single filter set
- Goal: prove the full pipeline end-to-end (search → save → export → skip trace → archive)
- Must pass the QA checklist above before advancing

**Stage 2 — Small batch:**
- 50 properties across 2–3 zips
- Goal: confirm pipeline handles multiple zips, pagination, and partial failures gracefully
- Review: human spot-checks 10% of exported records

**Stage 3 — Medium batch:**
- 500 properties across 10 zips
- Goal: validate quota tracking accuracy, throttle effectiveness, and archive storage patterns
- Review: automated field-completeness check + human review of 20 records

**Stage 4 — Full batch:**
- 3,000+ properties
- Goal: first real production skip-trace run
- Requirements: all Stage 3 gates passed, quota headroom confirmed, operator standing by for the first 30 minutes

**What must be true before moving from one stage to the next:**
- Previous stage's QA passes with zero critical failures
- No `DOM_SELECTOR_MISSING` errors that required manual intervention
- Quota tracking is within 5% of PropStream's reported numbers
- Export row count matches expected property count
- Contact capture rate is reasonable (TBD — needs operator decision on minimum acceptable %)

---

## 12. Current Blockers

**Blocker 1: Save-to-list does not complete**
- Description: Both the bulk range path (`setBulkSelection` → `openActionsMenu` → `openBulkActionByText("Save")`) and the visible checkbox fallback path find and click checkboxes, but the "Add to Group" modal either never opens or is not detected by the selector check. Latest manifest: `saved: 0`.
- Why it matters: Every downstream step (export, skip trace, contact capture, property archive) depends on a successful save. This is the single point of failure that blocks the entire pipeline.
- Owner: Operator + Claude
- Status: Broken — needs live headed debugging session
- Next step: Run `npm start -- interactive-harvest-zip 44149 test-debug-save 5` with `PROPSTREAM_HEADLESS=false`, watch the browser, and identify exactly which step fails: (a) are checkboxes actually selected from React's perspective? (b) does the Actions → Save click reach the right element? (c) does the modal appear with a different DOM structure than expected? Capture a screenshot at the point of failure.

**Blocker 2: Saved list reopen / export path is not validated**
- Description: `navigateToListByName` goes to `/property/group/0` and tries to click a list by text match. This has never been tested against a real saved list because no list has ever been successfully saved.
- Why it matters: Even if save is fixed, export will fail if the runner can't navigate to the saved list. The My Properties table uses AG-Grid (virtualized rows), which adds selector complexity.
- Owner: Operator + Claude
- Status: Blocked by Blocker 1
- Next step: Once save works, manually verify that the saved list appears in `/property/group/0` and that `getByText(listName, { exact: true })` finds it. The AG-Grid virtualization means list items may not be in the DOM if scrolled out of view.

**Blocker 3: Skip trace has not returned archived contact records**
- Description: The runner increments `skipTraced` counter (10 in latest manifest) but `archivedContacts: 0`. The batch skip trace path (`skipTraceBatch`) clicks "Skip Trace" on the saved list page, then immediately exports — but since there's no saved list, neither the skip trace nor the export completes.
- Why it matters: Contact data (phone numbers, emails, DNC flags) is the entire point of the pipeline. Without it, leads cannot be reached.
- Owner: Operator + Claude
- Status: Blocked by Blockers 1 and 2
- Next step: Once save and export work, run a skip trace on a small list (5 properties) and verify: (a) the Skip Trace modal opens with correct "Eligible Contacts" count, (b) "Place Order" completes without error, (c) subsequent export contains non-null Phone 1 and/or Email 1 values.

**Blocker 4: Vacant Land leaks through the filter**
- Description: The "Vacant" Lead List card in PropStream selects ALL vacant properties, not just vacant SFR. The latest page extract includes `20651 Albion Rd` which is "Vacant Land - Residential-Vacant Land", not SFR detached. If both "Vacant" and "Single Family" filters are applied, PropStream may be ORing them rather than ANDing them.
- Why it matters: Saving and skip-tracing non-SFR properties wastes quota and produces unusable leads.
- Owner: Operator + Claude
- Status: Needs investigation
- Next step: Test filter interaction in a headed session. Verify whether applying both "Vacant" AND "Single Family" filters via the Lead Lists panel produces an intersection (only vacant SFR) or a union (all vacant + all SFR). If union, the filter application order or method needs to change — may need to apply property type filter via the "Property Details" category instead of as a Lead List card, and Vacant as a separate Lead List filter.

---

## 13. Decision Log

**Decision:** Use Playwright-based local runner (`propstream-runner/`) instead of TamperMonkey userscript as the primary PropStream execution path
**Why:** Filesystem-first approach gives direct disk access for archiving, avoids browser extension limitations, enables headed/headless switching, and simplifies CI/testing
**Tradeoff accepted:** Runner needs its own Chrome profile management and cannot piggyback on the operator's daily-driver browser session as easily as a userscript
**Date:** ~2026-04-28 (inferred from repo structure; userscript path retained as fallback)

**Decision:** Use persistent Chrome profile seeding (`seed-profile-from-chrome`) for auth instead of storing credentials in the runner
**Why:** PropStream session cookies and local storage carry authentication state; seeding from the operator's real Chrome profile avoids credential handling in code
**Tradeoff accepted:** Auth requires either manual login in the headed browser or credential env vars (`PROPSTREAM_USERNAME`, `PROPSTREAM_PASSWORD`) for auto-login on the login page
**Date:** ~2026-05-01

**Decision:** Skip trace batch route preferred over per-property modal scraping
**Why:** The export-schema route (save → trace from toolbar → export → parse CSV) is faster, avoids undocumented modal DOM, and captures structured DNC flags
**Tradeoff accepted:** Requires save and export to both work first — which they currently don't
**Date:** 2026-04-27 (documented in codex-handoff-v4 §5.3 and export-schema.md)

---

## 14. Final Launch Signoff

**Operator signoff:**
NOT APPROVED — pipeline does not produce saved lists, exports, or contact data.

**Technical signoff:**
NOT APPROVED — Blockers 1–3 are unresolved. Save-to-list, export, and skip trace contact capture are all non-functional.

**Approved first real production run:**
- Date: TBD
- Market: TBD (likely `44149` Strongsville OH for first validated run)
- Lead count: TBD
- Skip trace count: TBD

**Post-run review date:**
TBD — schedule after the first successful Stage 1 validation run.

---

## Appendix: Evidence References

**Primary manifest referenced:**
`lead-vault/acquisition/propstream/runs/2026-05-02T03-25-38-027Z-strongsville-oh-vacant-sfr-test-10/manifest.json`

**Page extract referenced:**
`lead-vault/acquisition/propstream/runs/2026-05-02T03-25-38-027Z-strongsville-oh-vacant-sfr-test-10/pages/page-0001.json`

**Raw export referenced:**
`lead-vault/acquisition/propstream/runs/2026-05-02T03-25-38-027Z-strongsville-oh-vacant-sfr-test-10/raw-exports/strongsville-oh-vacant-sfr-test-10.json` — empty array `[]`

**Implementation files referenced:**
- `propstream-runner/src/runner.ts` — main runner orchestration, harvest flows
- `propstream-runner/src/acquisition/propstream-client.ts` — all PropStream DOM interaction
- `propstream-runner/src/pageBridge.ts` — injected page-side DOM helpers
- `propstream-runner/src/browser/session.ts` — Playwright browser management, auth, snapshot
- `propstream-runner/src/archive.ts` — on-disk archival and indexing
- `propstream-runner/src/config.ts` — env-var-driven configuration

**Design docs referenced:**
- `docs/system-design-v1.md` — four-module architecture spec
- `docs/codex-handoff-v4.md` — bridge contract and protocol spec
- `docs/propstream-ui-reference/README.md` — PropStream DOM ground truth
- `docs/propstream-ui-reference/export-schema.md` — 75-column CSV export structure
- `docs/regulatory-blocklist.md` — state-level wholesaling restrictions

**Total runs observed in lead-vault:** 21 runs, all targeting `44149` with `vacant` + `sfr_detached` filters, between 2026-05-02T02:26 and 2026-05-02T03:25 UTC.
