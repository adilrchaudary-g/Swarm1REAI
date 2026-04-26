# Wholesaling Agent System — Design Spec v1

This is the deep-dive on the four highest-leverage modules of your system, with regulatory filtering baked into the Market Selector as you asked. Think of this as the design doc you'd write before building a game — each agent is a system with inputs, rules, and outputs, and they pass data to each other in a defined shape.

---

## 0. The Regulatory Pre-Filter (runs before everything else)

Your instinct to skip hostile states is exactly right — the math on a restricted state is bad. Even if you find a juicy deal there, closing it legally requires workarounds (double closings, licensed partners, extra disclosures) that either kill the margin or add legal risk you don't need. Easier to just not hunt there.

Based on current law as of early 2026, states fall into three tiers. This table is the **first gate** any zip code hits before it's even considered for ranking.

### BLOCK tier — skip entirely

These states either require a real estate license to wholesale, cap you at one deal per year, or have enforcement actively targeting unlicensed wholesalers. Even if a zip in one of these states looked perfect on every other metric, the system filters it out.

- **South Carolina** — HB 4754 effectively makes wholesaling without a license illegal unless you take ownership. You'd need to double-close (briefly take title) on every deal, which destroys the speed advantage wholesaling is built on.
- **Illinois** — Real Estate License Act limits unlicensed wholesalers to exactly one transaction per 12-month period. Operating past that is a Class A misdemeanor.
- **Oklahoma** — SB 1075 requires wholesalers to disclose intent to assign, advises homeowners to seek legal advice, and gives homeowners a two-business-day cancellation window. Plus the earlier Predatory Wholesaler Act restricts unlicensed public marketing.
- **Kentucky** — HB 62 redefined brokerage to include marketing an equitable interest, so you essentially must have a real estate license to publicly market a wholesale deal.
- **Pennsylvania** — Bill 52 requires wholesalers to register and disclose profit as of January 2025. Profit disclosure is deal-killing in practice — sellers who see your spread almost always pull out.
- **Virginia** — requires a real estate license if you wholesale more than once per year as a pattern of business.

### HIGH-FRICTION tier — deprioritize, only enter if a zip scores exceptionally high on everything else

These states allow wholesaling but add paperwork, registration fees, or disclosure rules that slow you down and create legal exposure if you miss a step. Your Market Selector should apply a **-30 point penalty** to zips in these states, which means they only win when the fundamentals are unusually strong.

- **Connecticut** — HB 7287 / Public Act 25-168 requires wholesalers to register with the Department of Consumer Protection, with a three-business-day seller cancellation window, effective July 2026.
- **Oregon** — wholesalers must register with the Oregon Real Estate Agency, pay a registration fee, and pass a criminal background check.
- **Maryland** — effective late 2025, Wholesale Buyers must provide a specific written disclosure to the seller stating they may assign the contract.
- **Arizona** — enhanced disclosure requirements plus marketing restrictions tightened in 2025.
- **California** — disclosure required; repeated transactions may trigger licensing requirements.
- **Iowa, Tennessee, Indiana, Wisconsin, North Dakota** — all have disclosure or registration rules added between 2023 and 2025.

### GREEN tier — prioritize

Texas, Florida, Georgia, Alabama, Missouri, Arkansas, Mississippi, Louisiana, Ohio (has disclosure but workable), Nevada, New Mexico, Utah, Colorado, Kansas, Nebraska, Washington (if you stick to private buyer lists), plus several others. Texas and Florida in particular have huge inventory in your price band and the biggest flipper pools in the country — they should probably be overweighted in your initial target set.

### Update cadence

**The regulatory table must refresh quarterly.** Six new state laws landed in 2025 alone, and after South Carolina passed its prohibition, other states started making their own laws to limit or restrict wholesaling. Build this into the system: every 90 days, the Market Selector re-pulls current law before running its ranking. If a state moves from green to high-friction mid-quarter, any active leads there should get flagged for review rather than auto-dropped.

---

## 1. Market Selector — Zip Code Ranking Algorithm

This is the "which map should I farm" agent. In a game, some maps have better loot tables than others — same deal here. Your job is to rank every zip code in the US on a single score, then pick the top 20–50 to actively hunt. The rest you ignore until the ranking shifts.

### Inputs (what the agent pulls)

Six categories of data feed into the score. Getting these is a mix of paid APIs (ATTOM, PropStream, BatchData), public data (county assessor sites, FRED, BLS), and scrapes.

**1. Price band fit.** Pull median SFR sale price for the last 12 months in that zip. You want zips where the median falls between $180k and $420k — that centers your $200–400k sweet spot with a little tolerance on both ends. A zip with a $600k median is full of deals you can't afford to compete on; a zip with a $90k median has thin assignment fees.

**2. Cash buyer velocity.** Count the number of cash sales (non-financed transactions) in the last 90 days in the zip. This is your proxy for "are flippers actually active here?" Target: at least 15 cash sales per quarter in the SFR price band. Anything less and your dispo cycle gets ugly even with a buyer list.

**3. Flipper density.** Count unique buyers who bought 2+ properties in the last 12 months and sold at least one. These are the flippers you want in your buyer pool. A zip with 20+ active flippers is a healthy ecosystem. A zip with 2 is brittle — if those two lose interest, you have no one to assign to.

**4. Distress signal density.** Sum of: pre-foreclosure notices filed (NOD/lis pendens) in the last 90 days, tax delinquency filings, probate filings referencing properties in the zip, code violation notices, and listings withdrawn/expired from MLS in the last 180 days. Higher = more motivated sellers per thousand households.

**5. Wholesaler saturation.** This is the one most beginner wholesalers miss. Count direct mail permits filed with USPS, active wholesaler LLCs registered with properties in the zip, and bandit sign density if you can get it. A zip with zero wholesalers sounds great but usually means there's a reason no one's there (weak buyer pool, hostile regulation, bad comps). A zip with 50 active wholesalers is a bloodbath — every motivated seller has had 40 postcards already. The sweet spot is moderate saturation: 5–15 competitors.

**6. Spread viability.** For each recent flip in the zip, compute (sale price) − (purchase price) − (estimated repairs from permits). If the median spread is under $40k, there's no room for your $20k fee. You want zips where median flip spreads are $50k+.

### The scoring formula

Each input gets normalized to a 0–100 scale (how this zip compares to all other zips nationally on that metric), then weighted and summed:

```
zip_score = (
    0.15 × price_band_fit_score
  + 0.20 × cash_velocity_score
  + 0.15 × flipper_density_score
  + 0.25 × distress_signal_score
  + 0.15 × (100 − wholesaler_saturation_score)    // inverted
  + 0.10 × spread_viability_score
) − regulatory_penalty
```

Where `regulatory_penalty` is 0 for green states, 30 for high-friction states, and the zip is removed entirely for block states.

Distress density gets the biggest weight (0.25) because it's the rawest fuel for the rest of the system — if there aren't motivated sellers, nothing else matters. Cash velocity gets 0.20 because a motivated seller with no buyer to assign to is a dead lead. Saturation is inverted (high saturation lowers the score) and gets 0.15 — enough to punish bloodbaths but not enough to rule out a zip that's otherwise stellar.

### The weights aren't sacred

These are my starting guesses. The right way to tune them is to run the system for 90 days, see which zips actually produced deals, and regress backward: which input would have best predicted the winners? That's the real weights. Start with mine, then let data overwrite them.

### Output

Every Monday, the Market Selector emits a ranked list of the top 50 zips nationally with their scores and a one-line rationale. Your Off-Market List Builder reads from that list. Zips outside the top 50 get archived, not deleted — they might re-enter next quarter when conditions shift.

---

## 2. Seller Persona Agent — Signal-Based Classification

This is the "enemy type classifier" of your system. The same message — "I want to buy your house cash, no fees" — lands completely differently on a tired landlord than a probate heir, because they're in different life situations with different pain points. If the system treats all sellers as one archetype, your response rate is maybe 1%. If it classifies correctly and matches copy to persona, response rate can 3–5x.

### The six core personas

These cover ~90% of motivated SFR sellers. Each has a distinct behavioral fingerprint in public data.

**Tired Landlord.** Owner's mailing address differs from property address (classic absentee signal). Property shows as non-owner-occupied on tax records. Has held 3+ years. Often has multiple properties under the same ownership entity. In your price band, frequently shows eviction filings, code violations, or declining maintenance in Street View year-over-year. They're exhausted, not desperate. The pain point is *hassle*, not money — they'd take 85% of retail to just be done.

**Probate Heir.** Recent probate filing (last 6–18 months) referencing the property address. Owner of record is deceased or estate. Often out-of-state mailing address for the heir. Property may be vacant (USPS vacancy flag, utility shutoffs if you can get that data). Pain point is *distance and emotional weight* — they inherited a house in a city they don't live in and every month it sits is property tax they're paying. Speed and simplicity beat price.

**Pre-Foreclosure.** Notice of Default or lis pendens filed in the last 30–90 days. Owner-occupied or recently so. Often has a mortgage from 2019–2022 at rates that don't matter anymore, but job loss, divorce, or medical events got in the way. Pain point is *time and shame* — the clock is ticking toward auction and they're often hiding it from family. The absolute worst thing you can do here is be pushy or public. Discretion wins.

**Tired Homeowner / Life Event.** Owner-occupied, held 10+ years, no distress filings, but signals of life transition: recent divorce filing, relocation (new employer address in LinkedIn data), downsizing indicators (kids aged out based on school enrollment patterns), or health indicators (Medicare enrollment age). Not urgent, but ready. Pain point is *overwhelm* — they don't want to deal with prepping a house for market.

**Vacant / Distant Absentee.** Owner mailing address 100+ miles from property. USPS vacancy flag. Utilities disconnected if detectable. No recent permits or sales activity. Often overlaps with probate but not always — sometimes it's an accidental landlord whose tenant left and they never re-rented. Pain point is *neglect guilt* — the property is decaying and they know it.

**Code Violation / Problem Property.** Active code violations, fire damage, hoarder conditions visible in any listing photos, condemned notices. Often overlaps with other personas but the property condition is the dominant feature. Pain point is *fines and liability* — every month costs them money and they can't sell traditionally because no retail buyer will touch it.

### Signal → persona mapping

The classifier looks at a fixed set of data points and outputs a persona probability distribution. It's not binary — a property can be 60% probate heir + 30% vacant + 10% tired landlord, and the outreach strategy accounts for that blend.

The key signals, ordered by predictive power:

1. **Ownership form** (individual, trust, estate, LLC) — separates living-owner personas from probate
2. **Owner mailing address vs property address distance** — separates absentee from owner-occupied
3. **Years owned** — long holds skew to tired/life-event, short holds skew to flip-gone-wrong
4. **Public filings against the property** — foreclosure, tax, code, probate
5. **Property condition signals** — Street View, satellite, last listing photos if any
6. **Demographic overlay** — age of owner (from voter records if legal, or property tax senior exemptions), household composition

### Why outreach copy has to differ

This is where a lot of wholesalers lose deals they already won on price. Some examples of what shifts by persona:

For a **Tired Landlord**, the opening line should acknowledge the hassle of being a landlord and position you as an exit, not a buyer. "I know managing rentals from [their city] has gotten old — I work with landlords who want out without the drama of listing" reads totally different from "Cash offer on 123 Main St."

For a **Probate Heir**, you never mention the death directly in a first-touch message — that's invasive. You reference the property as "inherited" and emphasize "no repairs, no cleanout, no family drama." The emotional load is already high; your job is to be the calm option.

For **Pre-Foreclosure**, you never, ever send postcards or any marketing that a spouse or neighbor could see. Everything is private-channel: direct mail in plain envelopes addressed only to them, or cold calls at times they're likely alone. The copy leads with dignity and options, not urgency. "I work with homeowners who are behind on payments and want to avoid foreclosure on their record" — not "STOP FORECLOSURE NOW."

For **Tired Homeowners**, you lean on convenience: "I buy houses as-is — no repairs, no cleaning, no showings, close on your timeline." They're not in crisis, so urgency copy backfires.

The Seller Persona Agent's output isn't just a label — it's a **treatment plan** that tells the Outreach Agent which template to use, which channel, what time of day, and what tone.

---

## 3. Underwriting Agent — MAO Formula and Confidence Scoring

This is the damage calculator of your system. Every lead that clears the router hits this agent, which answers two questions: *what's the maximum I can pay and still make my minimum fee*, and *how much do I trust that number*.

### The full MAO formula

The classic 70% rule is the starting point, but it needs more structure for national virtual work:

```
MAO = (ARV × discount_factor) − repairs − assignment_fee − holding_costs
```

Where:

- **ARV** is After-Repair Value — what the property sells for once renovated, not its current value.
- **discount_factor** is usually 0.70 in hot markets, 0.65 in slower markets, 0.75 only in very competitive flipper environments. This represents the flipper's required margin.
- **repairs** is the estimated rehab cost.
- **assignment_fee** is your fee — your floor is $20k, target $25–50k.
- **holding_costs** is a catch-all for closing costs, short-term carrying costs, and buffer. Typically 5–8% of ARV on an SFR flip.

Worked example on a $300k ARV property needing $40k repairs in a standard market with your $25k target fee:

```
MAO = ($300,000 × 0.70) − $40,000 − $25,000 − ($300,000 × 0.06)
    = $210,000 − $40,000 − $25,000 − $18,000
    = $127,000
```

So if the seller will take $127k or less, the deal works. If they insist on $150k, it's dead — or you need to find another $23k somewhere, which usually means repairs were overestimated or ARV was underestimated. Which brings us to the harder problem.

### ARV estimation — the comp selection logic

ARV is the biggest source of error in virtual wholesaling and the biggest source of dead deals at closing (when the buyer's inspector finds reality). The agent's job is to find comparable sales and price the subject property off them, the same way a real estate appraiser would.

Good comps satisfy all of:

- **Sold within the last 90 days** (stretch to 180 if inventory is thin)
- **Within 0.5 miles** (stretch to 1.0 miles in rural)
- **Same property type** (SFR detached matches SFR detached — never condo, never townhome)
- **Within ±20% square footage**
- **Same bed/bath configuration** (±1 bedroom is tolerable)
- **Same year built bucket** (pre-1950, 1950–1980, 1980–2000, 2000+)
- **Fully renovated or recently remodeled** — since ARV assumes the subject gets rehabbed too

The agent pulls 10–15 candidate comps, filters to the 3–5 that best match, and takes the median price per square foot × subject square footage. Not the average — median is more robust to one weird outlier sale.

### Repair estimation — the hardest part virtually

You can't drive the property, so repair estimation is a stack of signals with error bars:

1. **Listing photos if available** — last MLS listing (even if expired or withdrawn) often shows interior condition
2. **Street View historical imagery** — roof condition, exterior siding, deferred maintenance
3. **Satellite imagery** — roof issues, yard neglect, evidence of additions
4. **Public permit history** — if the last kitchen permit was 1987, assume the kitchen needs full redo
5. **Year built + typical lifecycle costs** — a 1965 house with no renovation permits in 20 years almost certainly needs HVAC, roof, and at least one of plumbing/electrical
6. **Square footage × per-foot renovation cost for the zip** — light cosmetic ($15/sqft), moderate ($35/sqft), heavy ($65/sqft), full gut ($100+/sqft). The zip-level cost comes from regional construction cost indexes.

The agent assigns a **renovation tier** (cosmetic / moderate / heavy / gut) based on these signals and outputs a repair estimate with a range, not a point. On a 1,500 sqft house that looks moderate: $45k–$60k.

### Confidence scoring — the critical layer

Every underwriting output comes with a confidence score from 0.0 to 1.0, built from three sub-scores:

**ARV confidence:** High when you have 5+ clean comps with tight price-per-foot spread (coefficient of variation under 0.15). Low when comps are sparse, old, or wildly divergent.

**Repair confidence:** High when you have recent interior photos and the property is clearly cosmetic. Low when you have no interior access at all, or when signals conflict (exterior looks maintained but permit history suggests neglect).

**Data freshness:** High when all underlying data is under 30 days old. Degrades linearly to zero by 180 days.

```
total_confidence = min(arv_conf, repair_conf, freshness_conf)
```

Using `min` instead of average is deliberate — the weakest link sets your confidence, because a perfect ARV with garbage repair numbers is still a garbage underwrite.

### What the confidence score triggers

- **Confidence ≥ 0.75** — green light. System proceeds to outreach with the calculated MAO.
- **Confidence 0.50–0.74** — yellow. System proceeds but widens the negotiation buffer by 10% (offer 10% less initially to absorb uncertainty) and flags the lead for your personal review before any contract.
- **Confidence < 0.50** — red. System does not auto-outreach. Either queues for manual review or kicks back to the Market Selector as "not enough data to underwrite reliably." This is the agent knowing what it doesn't know — which is the feature that keeps you from closing bad deals at scale.

---

## 4. Data Schema — What Every Lead Carries

If you ever build this as actual software, the schema is what every database table looks like and what shape the data takes as it moves between agents. Think of it like the stats sheet for every unit in a game — every lead is an entity with a fixed set of attributes, and every agent reads/writes a specific subset.

Five core entities. I'm using JSON-like notation because it's readable even if you haven't coded yet — each `field_name: type` is one piece of data attached to the entity.

### Property

Represents the physical house. One property can have many leads over time (different owners, different years).

```
property:
  property_id: string              # your internal unique ID
  address_full: string             # "123 Main St, Austin, TX 78701"
  address_street: string
  address_city: string
  address_state: string
  address_zip: string
  latitude: float
  longitude: float
  property_type: enum              # sfr_detached, sfr_attached, condo, multi
  year_built: int
  square_feet: int
  bedrooms: int
  bathrooms: float                 # 2.5 is a real thing
  lot_size_sqft: int
  last_sale_date: date
  last_sale_price: int
  current_tax_assessment: int
  parcel_number: string            # from county records
```

### Owner

The human (or entity) who owns the property. Separated from Property because ownership changes and you want history.

```
owner:
  owner_id: string
  property_id: string              # foreign key back to property
  owner_name: string
  owner_type: enum                 # individual, trust, llc, estate, bank
  mailing_address: string          # may differ from property address
  mailing_address_distance_mi: float  # derived
  years_owned: int                 # derived from deed history
  estimated_age: int               # if legally available
  phone_numbers: list[string]      # from skip trace
  email_addresses: list[string]    # from skip trace
```

### Lead

The combination of a property + owner + motivation context at a point in time. This is the object that flows through your pipeline.

```
lead:
  lead_id: string
  property_id: string
  owner_id: string
  created_at: timestamp
  source: enum                     # distress_monitor, list_builder, inbound, referral
  status: enum                     # see lifecycle below
  
  # Persona classification
  persona_primary: enum            # tired_landlord, probate, pre_foreclosure, etc.
  persona_scores: map[string, float]   # {"probate": 0.6, "vacant": 0.3, ...}
  
  # Distress signals present
  distress_signals: list[enum]     # [nod_filed, tax_delinquent, code_violation, ...]
  distress_filed_dates: map[string, date]
  
  # Underwriting outputs
  arv_estimate: int
  arv_confidence: float
  repair_estimate_low: int
  repair_estimate_high: int
  repair_confidence: float
  mao: int                         # maximum allowable offer
  target_assignment_fee: int
  underwriting_confidence: float
  
  # Routing
  router_decision: enum            # proceed, review, dead
  router_reason: string            # human-readable why
  
  # Motivation scoring
  motivation_score: int            # 0–100 composite
  motivation_tier: enum            # hot, warm, cold
```

### Contact

Every time any agent (or you) touches the seller. Append-only — never overwrite or delete.

```
contact:
  contact_id: string
  lead_id: string
  timestamp: timestamp
  channel: enum                    # sms, call, email, mail, in_person
  direction: enum                  # outbound, inbound
  template_used: string            # which persona-matched template
  response_received: bool
  response_sentiment: enum         # positive, neutral, negative, wrong_number, dnc
  transcript: text                 # full content
  next_action: string              # scheduled next step
  next_action_date: date
```

### Deal

Only created once a lead becomes a signed contract. This is the object that moves to close.

```
deal:
  deal_id: string
  lead_id: string
  contract_signed_date: date
  contract_price: int              # what seller agreed to
  assignment_fee: int              # your actual fee
  closing_date: date               # scheduled
  assigned_buyer_id: string        # from your buyer pool
  title_company: string
  title_company_contact: string
  status: enum                     # under_contract, assigned, closed, terminated
  earnest_money: int
  terms: text                      # any special contingencies
```

### Lifecycle — the status machine

A lead moves through defined states. This is where you'd draw a flowchart if you were designing a game's quest state machine.

```
new → enriched → underwritten → qualified → contacted → 
  (responded | no_response) → negotiating → 
  (under_contract | dead) → assigned → closed
```

Each transition is triggered by a specific agent action. `new` → `enriched` happens when the Enrichment Agent finishes pulling skip trace and public records. `underwritten` → `qualified` happens when the Router says all four gates passed. And so on. Every transition gets logged with timestamp and which agent caused it — so six months later you can ask "how long does the average lead take from first contact to under contract?" and actually get a number.

---

## Where to go next

This spec is enough to start building. If you were actually going to implement it, the right order is roughly:

1. **Data schema first** — pick a database (Airtable is fine to start, Postgres later). Get the entities and fields above into tables. This takes a weekend and everything else depends on it.
2. **Market Selector second** — this is the highest-leverage agent and it can run once a week, so it doesn't need to be realtime. A Python script that pulls data from a couple of APIs, scores zips, and dumps the ranked list to a Google Sheet is a perfectly respectable v1.
3. **Underwriting Agent third** — this is where you'll spend the most time getting the logic right. Start with a manual version (you do it yourself on 20 leads, write down your reasoning) before you automate it.
4. **Persona classifier fourth** — can be rules-based to start (if ownership_form == "estate" then persona = "probate"). Upgrade to a trained model once you have a few hundred labeled leads.
5. **Outreach layer last** — it's tempting to build this first because it feels like "the product," but it's the layer that breaks most if the upstream layers are wrong. Dialer-driven-by-bad-data is worse than no dialer at all.

A note on the coding side, since you mentioned you're new to it: the scariest-looking parts of this spec are actually the most beginner-friendly in code. Reading data from an API and putting it in a table is genuinely one of the first things you learn in any programming tutorial. The hard part isn't the syntax — it's the *logic of what you want the system to do*, and this document is mostly that. If you ever want to start actually coding pieces of this, the natural entry point is Python + the pandas library, and you can have a working Market Selector v0.1 (pulls data for 5 zips, scores them, prints the ranking) in a couple of evenings.
