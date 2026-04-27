# PropStream UI Ground Truth

Reference document for the PropStream web app, captured for Codex to use when writing selectors and click handlers in the TamperMonkey userscript.

**Source:** Claude in Chrome session, April 26, 2026, ~15-minute walkthrough by the operator's authenticated browser.

**Verification status:** First-pass capture. Treat as authoritative for *structure* but verify edge cases when implementing. See "Known gaps and unknowns" at the bottom.

---

## App architecture (read this first)

PropStream is a React SPA served from `app.propstream.com`. Three things matter for selector strategy:

**1. Class names are CSS-Modules-hashed and probably unstable across deployments.** Format: `src-{path}-style__{hash}__{semantic}`, e.g. `src-app-Search-Header-style__Yf_Zr__search`. The semantic suffix (`__search`, `__item`, `__skipTraceBtn`) is the stable part. The hash (`Yf_Zr`, `Dq3VN`) probably rotates when PropStream redeploys.

**Selector strategy:** never use full class names. Always use partial-match attribute selectors keyed off the semantic suffix:

```
✓  [class*="skipTraceBtn"]
✗  .src-app-Property-Detail-style__IKEDt__skipTraceBtn
```

**2. No stable IDs anywhere.** Most elements have no `id`. The few that do have UUID-based IDs like `newuifilterRef{UUID}` that change per session/render. Don't use ID selectors.

**3. No data attributes, no aria labels on interactive elements.** Aria labels exist only on the embedded Google Map. Application buttons and inputs have neither.

**What this means in practice:** the userscript's selector layer should rely on a combination of (a) partial-class matches on semantic suffixes, (b) text-content matching, and (c) DOM structural relationships (e.g. "the input following the label that contains 'Estimated Value'"). All three should be combined with retry-with-backoff because React re-renders move elements around.

**Other architecture facts:**
- No iframes in the app shell
- No shadow DOM
- State changes happen via React re-render (not attribute toggling) — use `MutationObserver` for reliable state detection on modals and toasts
- Routes: `/search`, `/search/{propertyId}` (detail overlay), `/property/group/0` (My Properties / saved lists), `/accountnew/landing` (Account / quota)

---

## 1. Search flow

### 1.1 Layout

The default search page has a 50px left sidebar (icon-only nav), a sticky top bar with the search input + filters + 8 distress-count chips, and a Google Maps embed below filling the rest of the viewport. Results appear as a slide-in right panel after a search.

### 1.2 Top bar — DOM structure

```
div[class*="Search-Header-style"][class*="__top"]
  div[class*="__row"]
    div[class*="__col"]
      div[class*="__searchInput"]
        div[class*="__search"]
          div.react-autosuggest__container[role="combobox"]
            div[class*="autosuggestWrapper"]
              input  [type="text", placeholder="Enter County, City, Zip Code(s) or APN #"]
```

### 1.3 Search input

| Element | Selector |
|---|---|
| Search input | `input[placeholder*="Zip Code"]` |
| Clear-X button | sibling button after input |
| Search button | next button following the input wrapper |
| Autocomplete dropdown | `div.react-autosuggest__suggestions-container` |
| Autocomplete option | `li.react-autosuggest__suggestion` |

The search submits on Enter or by clicking a suggestion. Autocomplete options appear as the user types — wait for the dropdown to populate before clicking.

### 1.4 Filters panel

Clicking the **Filters** button (find by text content "Filters" inside `[class*="dropdownToggleBtn"]`) opens a full-screen overlay with a left category nav and a right content panel.

**The 8 left-nav categories:**

| Text | Description |
|---|---|
| Lead Lists | Distress filter grid (use this for our distress signals) |
| Property Details | Beds, baths, types, sqft |
| PropStream Intelligence | Property condition, foreclosure factor |
| MLS | MLS status, listing date |
| Pre-Foreclosure & Bank Owned | Recording date, default amount, auction date |
| Owner Information & Occupancy | Owner type, location, last sale |
| Lien, Bankruptcy, & Divorce | Lien/bankruptcy/divorce flags |
| Value & Equity | LTV, estimated value, assessed value |

### 1.5 Lead Lists — distress filter grid

This is where most of our distress signals live. Located under Filters → Lead Lists. Renders as a 4-column clickable card grid:

| Row 1 | Row 2 | Row 3 | Row 4 | Row 5 |
|---|---|---|---|---|
| Auctions | Bank Owned | Bankruptcy | Cash Buyers | |
| Divorce | Failed Listings | Flippers | Free & Clear | |
| High Equity | Liens | On Market | Pre-Foreclosures | |
| Pre-Probate | Senior Owners | Tax Delinquency | Tired Landlords | |
| Upside Down | Vacant | Vacant Land | Zombie Properties | |

| Element | Selector |
|---|---|
| Any lead list card | `[class*="clsLeadList"]` |
| Specific card | filter cards by `textContent.trim() === "Pre-Foreclosures"` (or whichever) |

**Mapping our distress_signals enum to PropStream's Lead Lists:**

| Our enum | PropStream Lead List card |
|---|---|
| `nod_filed`, `lis_pendens` | Pre-Foreclosures |
| `tax_delinquent` | Tax Delinquency |
| `code_violation` | (no direct equivalent — use Vacant + cross-reference) |
| `probate_filed` | Pre-Probate |
| `mls_expired`, `mls_withdrawn` | Failed Listings |
| `usps_vacant` | Vacant |
| `utility_shutoff` | (no direct equivalent — derived signal, not a Lead List filter) |

The Pre-Foreclosure & Bank Owned category in the left nav has finer-grained controls (Recording Date, Default Amount, Auction Date) for narrowing pre-foreclosure timing — useful when motivation scoring needs the auction-in-30-days signal.

### 1.6 Property type filter

Filters → Property Details → Residential tab.

**Important:** there is no literal "SFR Detached" label. The closest match is **"Single Family"** which maps to detached SFR in PropStream's database.

| Element | Selector |
|---|---|
| Residential tab | button/div with `textContent === "Residential"` |
| Single Family button | `button` with `textContent.trim() === "Single Family"` (after clicking Residential tab) |
| "Show All" expansion | link/button with text "Show All" inside the property type panel |

After "Show All" is clicked the full residential type list appears. Other types we should not check: Mobile home, Condo/Townhouse, etc. — only Single Family for our use case.

### 1.7 Price range filter

Filters → Value & Equity → Estimated Value (min/max).

The min/max inputs are custom text inputs with auto-generated UUID IDs. **Use positional selectors:**

```
1. Find the label with textContent === "Estimated Value"
2. Get the next two inputs matching [class*="clsSearchInput"]
3. First is min, second is max
```

Last Sale Price is a separate filter under "Owner Information & Occupancy" with the same pattern.

### 1.8 Pre-Foreclosure detail filters

For finer pre-foreclosure timing (which feeds motivation scoring's distress_urgency sub-score), Filters → Pre-Foreclosure & Bank Owned has:

- Pre-Foreclosure 3-button toggle: `[Any]` (default) | `[Include]` | `[Exclude]`
- Recording Date: calendar range picker
- Auction Date: calendar range picker
- Pre-Foreclosure Release Date: calendar range picker
- Opening Bid Amount: min/max
- Default Amount: min/max

Use Auction Date range to slice "auction in <30 days" vs "auction in 30–60 days" for motivation scoring.

### 1.9 Search results — the right panel

Top-level structure:

```
div[class*="Search-Results-style"][class*="__wrapper"]
  div[class*="__resultsHeader"]
    div[class*="__left"]
      div[class*="__caption"]
        [number text node]
        span[class*="__captiontxt"]  "PROPERTIES"
    div[class*="__right"]
      div[class*="__actionWrapper"]
        button[class*="__dropdownToggleBtn"]  "Actions ▼"
  div[class*="__view"]
    div[class*="__content"]
      div[class*="__item"]  ×N
```

| What | Selector |
|---|---|
| Result count | `[class*="caption"]` parent of `[class*="captiontxt"]` — strip "PROPERTIES" |
| Property card | `[class*="__item"]` (under `[class*="__content"]`) |
| Bookmark icon on card | `button[class*="imageIconButton"]` (saves to default group) |

### 1.10 Property card structure

Each card has:
- Image div with property photo
- Header content: checkbox, price/status, lead list tags
- Body content: address, beds/baths/sqft/lot, equity stats
- Footer: EST. EQUITY, EST. LOAN BAL., LAST SALE

**For data extraction:** parse text content from the card subtree. Don't rely on per-field class names — use positional/structural reads.

### 1.11 Pagination

```
div[class*="Paginator-style"][class*="__pagination"]
  [prev group]: «« button, « button
  [page input]: span "PAGE", input, span "OF N"
  [next group]: » button, »» button
```

| What | Selector |
|---|---|
| Page input | `input[class*="Paginator"][class*="__input"]` |
| Total pages | parse `OF \d+` from parent text |
| Next button | last button in the paginator before the input's right neighbors |

---

## 2. Property detail page

The detail view is a **right-side flyout panel** that overlays the search results. URL changes to `/search/{propertyId}` but the search results remain in the DOM behind it.

### 2.1 Header bar

```
div[class*="Property-Detail-style"][class*="__buttons"]
  button [close X]
  button "ToolsNEW"
  button "Status / Tags"
  button "Print"
  button "Analysis"
  a [bookmark/save anchor]
  button "Save" / "Saved"
```

### 2.2 Property metadata grid

Upper section of the detail panel shows a label-value grid:

- Property Type
- Status (On Market / Off Market)
- Distressed (Yes / No)
- Short Sale (Yes / No)
- HOA/COA
- Owner Type (Individual / Trust / LLC / Estate) — **maps directly to our `owner_type` field**
- Owner Status (Owner Occupied / etc.)
- Occupancy
- Length of Ownership — **maps to our `years_owned` field**
- Purchase Method
- County

Plus Value section (current estimated value, last year's, line chart) and Mortgage & Debt section (open mortgages, estimated balance, involuntary liens, last sale public record + MLS).

### 2.3 Ownership Information section

Section heading: `[class*="__heading"]` with text "Ownership Information".

Columns: Owner 1 Name, Relationship Type, Mailing Address, Do Not Mail, Mailing Care of Name.

**⚠️ PII appears here.** Owner name and mailing address are visible. The userscript reads these into memory and posts to Hermes; never log or mirror to Discord.

### 2.4 Save / Saved button

Located top-right of the header bar.

| State | Text | Visual |
|---|---|---|
| Unsaved | "Save" | filled (orange/teal accent) |
| Saved | "Saved" | outlined/muted |

Same DOM class in both states: `button[class*="cuWaY__button"]`. Differentiate by reading text content.

### 2.5 Skip Trace button — read this carefully

Located in the Contact Information section, just above Ownership Information.

```
div[class*="__contactsSection"]
  div[class*="__contactsPanel"]
    div[class*="__contactsHeader"]  "Contact Information"
    div[class*="__subTitle"]  "Access the contact information for this property at no cost."
    button[class*="__skipTraceBtn"]
```

**The dual-label gotcha:** the button class is always `[class*="skipTraceBtn"]` but the text changes:

| Property state | Button text |
|---|---|
| Not yet saved | "Save Property" |
| Saved (in any list) | "Skip Trace" |

This means the skip trace flow requires the property to be saved first. The userscript's SKIP_TRACE command should:
1. Check property's saved state
2. If unsaved, perform a SAVE first (which costs save quota)
3. Then click the now-relabeled button to initiate skip trace
4. Skip trace incurs both save quota and skip-trace quota for unsaved properties

This is non-obvious and worth flagging in the protocol doc.

### 2.6 Monitor toggle — confirmed not exposed in the operator UI

A second Claude in Chrome session searched specifically for this. Locations checked:

1. **Row-expand chevron** in `/property/group/0` — expands into a single "Marketing Lists" tab (Name / Date columns + trash icon). No monitor control.
2. **Right-click on a property row** — triggers AG-Grid's browser-native context menu (Copy, Copy with Headers, Paste, Export). No app-level options.
3. **Actions dropdown** in My Properties toolbar — six items: Push to BatchDialer, Add to Favorites List, Add to Marketing List, Manage Contracts, View Map, Generate Mailing Labels. No monitor option.
4. **Property detail panel** (opened from My Properties via `/property/group/0/{id}`) — toolbar has Tools, Status/Tags, Print, Analysis, Saved, close. No monitor toggle in header or Property Details tab.
5. **Column customizer** (gear icon top-right of table) — all column groups inventoried: Property & Owner Info, Property Characteristics, Tax Assessment, Last & Prior Sale, Open Loan, Calculations, MLS, Lien/Bankruptcy/Divorce, Pre-Foreclosure, Marketing. No "Monitor", "Watch", or "Lead Automator" column available.

**Conclusion:** the Lead Automator monitoring feature shown on the account page (50,000 monitored properties cap) has no exposed toggle in the operator-facing UI on this Pro tier account.

**Implications for the userscript:**
- The MONITOR command in the protocol cannot be implemented against the current UI.
- Three options going forward, in order of preference:
  - **Option A (recommended): drop MONITOR from the protocol entirely for v1.** The 50,000 monitored-properties capacity becomes a future feature, not a launch feature. Lead Automator may activate automatically when properties are saved — worth checking the monitored-remaining counter on `/accountnew/landing` after saving 5 properties to see if it ticks down without explicit action.
  - **Option B:** keep MONITOR in the protocol as a no-op stub that always returns success. Lets the rest of the system pretend monitoring works. Risks confusion later.
  - **Option C:** investigate whether PropStream has a hidden monitoring API or whether monitoring activates as a side effect of save. Requires DevTools network inspection during a save operation.

Recommend Option A. Update `codex-handoff-v3.md` to remove MONITOR from the supported command list before Codex hits milestone 8.

---

## 3. Save flow

### 3.1 Add to Group modal

Clicking Save on the detail panel opens a modal:

```
div[class*="AddToMarketingListModal"][class*="__modalOverlay"]
  div[class*="__modalWrapper"]
    div[class*="__modalBox"]
      div[class*="__modal_header"]
        h3[class*="__modal_title"]  "Add to Group"
      div[class*="__modal_body"]
        div[class*="ListManagementField"][class*="__wrapper"]
          input  [the search-and-select for list name]
          ul
            li[class*="ListManagementField"][class*="__item"]  ×N
        label
          input[type="checkbox"]  "Skip Trace This Property"
      [footer]
        button "Cancel"
        button "Save"  [disabled until list is selected]
```

**Workflow for SAVE command:**
1. Click Save button in detail header
2. Wait for modal to render (`MutationObserver` on the modal overlay class)
3. Click the list-management wrapper to open the dropdown
4. Click the target list `li` by text content match (e.g. "My Properties")
5. **Do not check "Skip Trace This Property"** — separate operation
6. Click the modal footer's Save button
7. Wait for modal to close + toast to appear

### 3.2 Confirmation toast

Toast appears at bottom-center after save: `"1 properties saved to '<list name>'"` with green checkmark. Short-lived element — use `MutationObserver` and match by text containing `"properties saved to"`.

The detail header's Save button changes to "Saved" (same DOM class, different text) at the same moment.

---

## 4. Export flow

### 4.1 My Properties view

URL: `/property/group/0`

Has a left sidebar tree (Favorites / Marketing Lists), a top filter tab strip (Total, On Market, Just Sold, Vacant, High Equity, etc.), an action button bar (Import List, Export, Actions ▼, New Campaign, Skip Trace), and a property table.

### 4.2 Export — single-step, CSV-only

**Important protocol simplification:** Export does **not** show a format picker modal. The flow is:

1. Select properties via row checkboxes (or select all)
2. Click Export button (`button[class*="LEeIC"]` or by text "Export")
3. CSV download fires immediately
4. Confirmation modal appears: `"N Property Exported / You have X properties left to export this billing period / Your Export quantity will reset to 50,000 on 05/21/2026"`
5. Click Close

**This means our EXPORT command's payload field `format: "csv" | "xlsx"` is moot — it's always CSV.** Update `protocol.js` to either remove the format field or document that it's currently ignored.

### 4.3 Export confirmation modal

Useful for verifying the export succeeded and reading remote quota:

```
h2  "N Property Exported"
p   "You have <remaining> properties left to export for this billing period.
     Your Export quantity will reset to 50,000 on 05/21/2026."
button  "Close"
```

The remaining-export count in this modal is a free quota signal — read it and feed it to the userscript's local counter for reconciliation.

---

## 5. Skip trace flow

### 5.1 Two initiation points

**From property detail panel:**
```
button[class*="skipTraceBtn"]  (text == "Skip Trace" if saved)
```

**From My Properties view toolbar:**
```
button  "Skip Trace"  (active only when ≥1 row checked)
```

### 5.2 Skip Trace order modal

```
[Modal overlay]
  h1  "Skip Trace"
  
  [Left section]
    label  "Name Your List"
    input[class*="SkipTraceModal"][class*="__input"]
    label  input[type="checkbox"] "Re-Skip Trace"
    p  [terms text about card authorization]
  
  [Right section — Order Details]
    h3  "Order Details"
    "Selected Contacts" | N
    "Eligible Contacts" | N
    "Price Per Match" | $0.10
    "Subtotal" | $X
    "Free Skip Trace Credits" | -$X
    "Total" | $0.00 (if covered by free credits)
  
  [Footer]
    button "Cancel"
    button "Place Order"  [disabled until list name entered]
```

| Element | Selector |
|---|---|
| List name input | `input[class*="SkipTraceModal"][class*="__input"]` |
| Place Order button | `button[class*="SkipTraceModal"][class*="gLd91"]` (or last button in modal footer) |

**Workflow for SKIP_TRACE command:**
1. Navigate to property and ensure it's saved
2. Click Skip Trace button
3. Wait for modal
4. Type a list name (use a deterministic naming pattern, e.g. `swarm-skiptrace-{date}-{batch_id}`)
5. Verify Order Details shows non-zero "Eligible Contacts" — if 0, abort with informative error
6. Verify "Total" is $0.00 (we should always be on free credits within quota)
7. Click Place Order
8. Wait for modal to close + results to populate in Contact Information section

### 5.3 Skip trace results — populate Phone/Email columns of export

No pre-skip-traced property was available during the UI walkthrough, so the live results modal/section structure is undocumented. **However, the export schema reveals where the data ends up:** skip-traced contact data populates `Phone 1–5` (with `Type` and `DNC` flags) and `Email 1–4` columns of any export.

This means the **fastest reliable bulk skip trace pattern is:**
1. Save targets to a list
2. Initiate skip trace from My Properties toolbar
3. Wait for completion
4. Export the list to CSV
5. Parse the export — full structured contact data with DNC flags

See `export-schema.md` for the full column structure. This shortcuts modal-scraping entirely for batch operations.

The detail-panel flow (per-property) still needs DOM inspection at milestone 5, but for batches of 5+ properties, prefer the export route.

---

## 6. Quota / account page

URL: `/accountnew/landing`

### 6.1 Plan section

Shows "Pro" tier, "Monthly", "50,000/mo Saves & Exports".

### 6.2 Usage section — quota counters

Three counters in a vertical list:

| Label | Example value | Sub-label |
|---|---|---|
| `SAVES REMAINING` | `49,994` | `6 \| 0% USED` |
| `EXPORTS REMAINING` | `49,999` | `1 \| 0% USED` |
| `FREE SKIP TRACES REMAINING` | `49,996` | `4 \| 0.01% USED` |

Each counter sits in `[class*="clsUsageContentTxt"]`. Read all four with `querySelectorAll('[class*="clsUsageContentTxt"]')` and parse the numbers.

Header includes reset countdown: `"RESETS IN N DAYS | 05/22/2026"`. Useful for the userscript to know when to flush its local counters.

### 6.3 Lead Automator section

```
PLAN TYPE | Included with Plan
MONITORED PROPERTIES | 50,000

MONITORED PROPERTIES REMAINING | 50,000 | 0 | 0.00% USED
```

This confirms monitored is a separate quota with 50,000 cap. The UI entry point for *adding* a property to monitoring is unconfirmed (see §2.6).

---

## Stable selectors quick-reference

| Element | Selector |
|---|---|
| Search input | `input[placeholder*="Zip Code"]` |
| Filters toggle | `[class*="dropdownToggleBtn"]` containing text "Filters" |
| Lead List card | `[class*="clsLeadList"]` |
| Single Family button | `button` with `textContent.trim() === "Single Family"` |
| Estimated Value inputs | siblings after label "Estimated Value", matching `input[class*="clsSearchInput"]` |
| Result count | `[class*="captiontxt"]`'s parent `[class*="caption"]` |
| Pagination input | `input[class*="Paginator"][type="text"]` |
| Property card | `[class*="__item"]` under `[class*="__content"]` |
| Detail header | `[class*="__buttons"]` under property detail |
| Save/Saved button | `button[class*="cuWaY__button"]` (text discriminates state) |
| Add-to-Group modal | `[class*="AddToMarketingListModal"][class*="modalBox"]` |
| List picker option | `li[class*="ListManagementField"][class*="item"]` |
| Skip Trace button | `button[class*="skipTraceBtn"]` (text discriminates: "Save Property" vs "Skip Trace") |
| Contact Info section | `[class*="contactsSection"]` |
| Ownership Info heading | `[class*="__heading"]` with text "Ownership Information" |
| My Properties Export | `button[class*="LEeIC"]` or `button` with text "Export" in My Properties |
| Skip Trace modal input | `input[class*="SkipTraceModal"][class*="__input"]` |
| Skip Trace Place Order | `button[class*="SkipTraceModal"][class*="gLd91"]` |
| Quota counters | `[class*="clsUsageList"] [class*="clsUsageContentTxt"]` |

---

## Known gaps and unknowns

Two questions from the original walkthrough have now been resolved by a follow-up session:

1. **Skip trace results modal (per-property flow) — RESOLVED-VIA-WORKAROUND.** The operator's account had no pre-skip-traced properties available, so the live in-page rendering of populated contact data could not be documented. However, the `export-schema.md` route covers batch use cases entirely. For single-property real-time skip trace, Codex must inspect the populated Contact Information section live during milestone 5 — but only after at least one real skip trace has been performed in normal operation, not via test trigger.

2. **Monitor toggle UI location — RESOLVED-NEGATIVE.** Confirmed not exposed in the operator-facing UI on Pro tier. See §2.6 above. MONITOR command should be dropped from v1 protocol.

Open questions that remain:

3. **Class hash stability across deployments** — assumed unstable based on CSS-Modules patterns, but not directly observed. Build the userscript to handle re-deploys gracefully (i.e. selector failures should escalate to operator with `DOM_SELECTOR_MISSING`, not crash silently).
4. **UUID-based filter IDs** — observed in filter inputs (`newuifilterRef{UUID}`). Stability within a session unverified. Don't rely on these IDs — use positional/structural selectors.
5. **Code violation distress filter** — no direct PropStream Lead List card matches. May need to derive from cross-referencing other signals (e.g. Vacant + tax issues + age of property). Acceptable to skip code_violation as a primary filter and treat it as a secondary tag from other data sources.
6. **Utility shutoff signal** — no PropStream UI representation. Treat as derived signal sourced elsewhere (USPS data, third-party data) rather than from PropStream.
7. **Export format options** — confirmed: CSV only, no picker. Update protocol.js accordingly.
8. **AG-Grid table** — the My Properties table is built with AG-Grid (confirmed by the native context menu in the second walkthrough). This means row data is virtualized — properties scrolled out of view may not be in the DOM. Codex should account for this when extracting full lists: scroll to load, or use AG-Grid's API if accessible.

## Maintenance

When PropStream redesigns, the changes that break the userscript will surface as `DOM_SELECTOR_MISSING` errors. The repair workflow is:
1. Operator opens PropStream and navigates to the broken page.
2. Inspects DOM via DevTools to find the new selector.
3. Updates the relevant selector in `userscript/SELECTORS.md`.
4. Updates this document if the underlying structure (not just hash) changed.
5. Reinstalls userscript and re-tests via `userscript/TEST_CHECKLIST.md`.

Quarterly review recommended even without obvious breakage — selector drift accumulates silently.
