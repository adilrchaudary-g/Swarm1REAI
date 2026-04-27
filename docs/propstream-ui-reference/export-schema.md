# PropStream Export Schema

The exact column structure PropStream uses when exporting a saved list to CSV/XLSX. **This is the format Codex's EXPORT command will parse.**

**Source:** Real export from operator's account, April 27, 2026. One-row export from "All Saved Properties" list. The actual row contents are not reproduced here (PII); only the schema.

---

## Why this matters

Until now, the userscript's SKIP_TRACE flow was specced as: click skip trace button per property → wait for modal → parse the results modal DOM. That works but it's slow (one round-trip per property, modal DOM is undocumented, error-prone).

**The export schema reveals a faster path.** Skip-traced contact data populates `Phone 1–5` and `Email 1–4` columns of the export. So the bulk SKIP_TRACE pattern becomes:

1. Save target properties to a list
2. Run skip trace via the My Properties toolbar (single batch operation, single quota charge per property)
3. Export the list to CSV
4. Parse the export — phones, emails, and DNC flags all come back in one structured pass

This shortcuts the modal-scraping problem entirely. Codex should prefer this path for batch skip traces of 5+ properties.

For single-property skip traces (e.g. on-demand from the detail panel), the modal-scraping path still applies — but even there, an immediate EXPORT after the trace would be more reliable than scraping the live UI.

---

## All 75 columns in export order

### Property identity (7 columns)
| Column | Type | Notes |
|---|---|---|
| `Address` | string | Street address, no city |
| `Unit #` | string \| null | Apartment / suite number |
| `City` | string | |
| `State` | string | 2-letter code |
| `Zip` | int | 5-digit |
| `County` | string | |
| `APN` | string | Assessor's parcel number, format varies by county |

### Contact — phones (15 columns: 5 phones × 3 fields each)
| Column | Type | Notes |
|---|---|---|
| `Phone 1` | string \| null | Format: `+1XXXXXXXXXX` or `(XXX) XXX-XXXX` (verify both seen) |
| `Phone 1 Type` | enum \| null | `Mobile` \| `Landline` \| `VOIP` |
| `Phone 1 DNC` | enum \| null | `Yes` \| `No` |
| ...repeat for Phone 2 through Phone 5 | | |

**Critical:** `Phone N DNC` is the federal Do Not Call registry flag. **The userscript MUST surface this to Hermes for every contact.** TCPA violations on DNC numbers carry per-call statutory damages.

### Contact — emails (4 columns)
| Column | Type | Notes |
|---|---|---|
| `Email 1` | string \| null | |
| `Email 2` | string \| null | |
| `Email 3` | string \| null | |
| `Email 4` | string \| null | |

No type or DNC equivalent for emails.

### Owner identity (5 columns)
| Column | Type | Notes |
|---|---|---|
| `Owner Occupied` | enum | `Yes` \| `No` |
| `Owner 1 First Name` | string | |
| `Owner 1 Last Name` | string | |
| `Owner 2 First Name` | string \| null | Joint owner if any |
| `Owner 2 Last Name` | string \| null | |

**Note:** PropStream splits names but our canonical `owner_name` field is a single string. Compose at extraction time: `f"{first} {last}".strip()`. For joint ownership, format as `"{O1F} {O1L} & {O2F} {O2L}"`.

### Owner flags (1 column)
| Column | Type | Notes |
|---|---|---|
| `Litigator` | enum | `Yes` \| `No` — flags litigation history. Treat as a hard filter; skip litigator-flagged owners. |

### Mailing address (7 columns)
| Column | Type | Notes |
|---|---|---|
| `Mailing Care of Name` | string \| null | |
| `Mailing Address` | string | |
| `Mailing Unit #` | string \| null | |
| `Mailing City` | string | |
| `Mailing State` | string | |
| `Mailing Zip` | int | |
| `Mailing County` | string \| null | |
| `Do Not Mail` | enum | `Yes` \| `No` — postal opt-out flag, separate from phone DNC |

Compose into a single `mailing_address` string. Compute `mailing_address_distance_mi` by geocoding both addresses and calculating distance.

### Property metadata (10 columns)
| Column | Type | Notes |
|---|---|---|
| `Property Status` | string \| null | |
| `Notes` | string \| null | User-added freeform notes within PropStream |
| `Property Type` | string | e.g. "Single Family Residential" |
| `Bedrooms` | int | |
| `Total Bathrooms` | float | half-baths counted as 0.5 |
| `Building Sqft` | int | |
| `Lot Size Sqft` | int | |
| `Effective Year Built` | int | |
| `Total Assessed Value` | int | maps to `current_tax_assessment` |
| `Last Sale Recording Date` | date | maps to `last_sale_date` |
| `Last Sale Amount` | int | maps to `last_sale_price` |

### Financial signals (5 columns) — feed motivation scorer
| Column | Type | Notes |
|---|---|---|
| `Total Open Loans` | int | |
| `Est. Remaining balance of Open Loans` | int | |
| `Est. Value` | int | This is PropStream's ARV-equivalent estimate |
| `Est. Loan-to-Value` | float | percentage as number (24.122 = 24.122%) |
| `Est. Equity` | int | |

**Critical for motivation scoring:** the financial pressure sub-score (weight 0.25) uses equity position. `Est. Equity / Est. Value` gives equity percentage. High-equity distressed sellers score 90; low-equity score 55.

### Condition signals (5 columns) — feed motivation scorer
| Column | Type | Notes |
|---|---|---|
| `Total Condition` | enum | `Excellent` \| `Good` \| `Fair` \| `Poor` \| `Unknown` |
| `Interior Condition` | enum | same |
| `Exterior Condition` | enum | same |
| `Bathroom Condition` | enum | same |
| `Kitchen Condition` | enum | same |

Condition Poor or Fair across multiple sub-areas → contributes to `condition_deterioration` motivation sub-score (weight 0.10).

### Distress / market signals (5 columns)
| Column | Type | Notes |
|---|---|---|
| `Foreclosure Factor` | enum | `Very Low` \| `Low` \| `Medium Low` \| `Medium` \| `Medium High` \| `High` \| `Very High` (verify exact buckets) — PropStream's composite foreclosure-risk score |
| `MLS Status` | enum | `ACTIVE` \| `PENDING` \| `SOLD` \| `EXPIRED` \| `WITHDRAWN` \| etc. |
| `MLS Date` | datetime | |
| `MLS Amount` | int | listing price |
| `Lien Amount` | int \| null | active lien total |

`MLS Status = EXPIRED` or `WITHDRAWN` → maps to our `mls_expired` / `mls_withdrawn` distress signals.

### Outreach activity tracking (7 columns) — read-only metadata
| Column | Type | Notes |
|---|---|---|
| `Marketing Lists` | int | count of lists this property is in |
| `Marketing Campaigns` | int | |
| `Voicemail Drops` | int | |
| `Dialer` | int | |
| `Postcards` | int | |
| `E-Mails` | int | |
| `Skip Traces` | int | **This is the key one** — `0` means not yet skip-traced, `≥1` means skip-traced. Use to detect skip trace state without scraping the UI. |

These count outreach activities the operator (or the swarm) has logged within PropStream. They are not the swarm's source of truth for outreach state — Hermes is — but they're useful as a sanity check.

### List metadata (2 columns)
| Column | Type | Notes |
|---|---|---|
| `Date Added to List` | datetime | |
| `Method of Add` | enum | `Manual` \| `Auto` \| `Import` (verify) |

---

## Mapping to canonical schema

The mapping the userscript's export parser should apply:

```
PropStream column                          → canonical field
─────────────────────────────────────────────────────────────────────
Address + ", " + City + ", " + State       → address_full
                + " " + Zip                  
Address                                     → address_street
City                                        → address_city
State                                       → address_state
Zip                                         → address_zip
APN                                         → parcel_number
Property Type                               → property_type (normalize)
Bedrooms                                    → bedrooms
Total Bathrooms                             → bathrooms
Building Sqft                               → square_feet
Lot Size Sqft                               → lot_size_sqft
Effective Year Built                        → year_built
Total Assessed Value                        → current_tax_assessment
Last Sale Recording Date                    → last_sale_date
Last Sale Amount                            → last_sale_price

Owner 1 First/Last + Owner 2 First/Last     → owner_name (composed)
Owner Occupied                              → derive owner_status
Mailing Address fields                      → mailing_address (composed)
                                            → mailing_address_distance_mi (geocode)

Phone 1..5 + Type + DNC                     → phone_numbers list
                                              [{number, type, dnc}, ...]
Email 1..4                                  → email_addresses list

Est. Value                                  → propstream_arv_estimate
Est. Equity                                 → propstream_equity
Est. Loan-to-Value                          → propstream_ltv
Foreclosure Factor                          → propstream_foreclosure_factor

MLS Status                                  → mls_status (and derive 
                                              distress_signals: 
                                              mls_expired/mls_withdrawn)

Skip Traces                                 → skip_trace_count 
                                              (0 = needs skip trace)
```

---

## Implications for the userscript

1. **EXPORT command output type is now well-defined.** The result envelope's `items` array contains parsed rows from this schema, mapped to canonical fields.
2. **Skip trace detection is free and reliable.** Read `Skip Traces` column from any export to check state. No need to inspect the property detail UI.
3. **Phone DNC flags must be preserved end-to-end.** Don't drop them at any layer between export parse and Hermes.
4. **Litigator flag should short-circuit the router.** If `Litigator = Yes`, the lead never reaches outreach regardless of motivation score.
5. **PropStream's `Est. Value` is not our ARV.** It's PropStream's machine estimate. Underwriting Agent (`#fast-underwriting`) still computes our ARV from comps. Use PropStream's value as a sanity-check upper bound, not as the ARV itself.
6. **Condition data is gold for motivation scoring.** PropStream already computes Total/Interior/Exterior/Bathroom/Kitchen condition. We don't need Street View deterioration analysis if these fields are populated — feed them straight to the condition_deterioration sub-score.

---

## Open questions about the schema

These need verification when more sample exports are available:

1. **Phone format consistency** — is it always `+1XXXXXXXXXX` or does it vary?
2. **Date format consistency** — `Last Sale Recording Date` was `2020-03-31` (ISO), `MLS Date` was `2026-04-23 00:00:00.0` (timestamp with milliseconds). Parser must handle both.
3. **`Foreclosure Factor` enum values** — observed "Medium Low"; full set of buckets unknown.
4. **Missing distress columns** — no column for tax delinquency, code violations, probate, or vacant status. These may be in additional columns we haven't seen, or they may only appear when filtered into the saved list. Verify by exporting a list filtered on each distress type.
5. **Joint mortgage handling** — if there are two open loans, is `Est. Remaining balance of Open Loans` the sum, or only the senior loan?
