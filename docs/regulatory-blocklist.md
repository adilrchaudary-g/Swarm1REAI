# Regulatory Blocklist

States to skip or deprioritize when running the Market Selector.

**Last updated:** April 2026
**Next refresh due:** July 2026
**Refresh cadence:** Quarterly (regulatory landscape changes fast — six new state laws landed in 2025 alone)

---

## How to use this doc

The Market Selector reads this list before ranking zip codes. Block-tier states are excluded entirely. High-friction states get a -30 point penalty applied to their zip scores. Green-tier states are unaffected.

The list is enforced in two places:
1. **Market Selector (Swarm)** — primary enforcement. Zips in blocked states never make the ranked list.
2. **TamperMonkey userscript** — secondary defense. If a command somehow targets a blocked state, the userscript rejects it as `INVALID_COMMAND` with reason "regulatory blocklist."

## BLOCK tier — skip entirely

These states require a real estate license to wholesale, cap unlicensed transactions, or have active enforcement against unlicensed wholesalers. The math doesn't work even on a juicy deal — workarounds (double closings, licensed partners, extra disclosures) destroy the speed advantage wholesaling depends on.

| State | Reason |
|---|---|
| South Carolina | HB 4754 effectively makes wholesaling without a license illegal unless you take ownership |
| Illinois | Real Estate License Act limits unlicensed wholesalers to 1 transaction per 12-month period; further activity is a Class A misdemeanor |
| Oklahoma | SB 1075 requires assignment-intent disclosure, advises homeowners to seek legal counsel, gives a 2-business-day cancellation window. Predatory Wholesaler Act restricts unlicensed public marketing |
| Kentucky | HB 62 redefined brokerage to include marketing an equitable interest — license effectively required |
| Pennsylvania | Bill 52 (Jan 2025) requires registration and profit disclosure. Profit disclosure is deal-killing in practice |
| Virginia | License required if wholesaling more than once per year as a pattern of business |

## HIGH-FRICTION tier — deprioritize (-30 points)

Wholesaling is allowed but adds paperwork, registration fees, or disclosure rules that slow operations and create legal exposure. Only enter when fundamentals are unusually strong.

| State | Friction |
|---|---|
| Connecticut | HB 7287 / Public Act 25-168 — registration with Department of Consumer Protection, 3-business-day seller cancellation window (effective July 2026) |
| Oregon | Registration with Oregon Real Estate Agency, registration fee, criminal background check |
| Maryland | Effective late 2025 — written disclosure of assignment intent required |
| Arizona | Enhanced disclosure + marketing restrictions tightened in 2025 |
| California | Disclosure required; repeated transactions may trigger licensing |
| Iowa | Disclosure rules added 2024 |
| Tennessee | Disclosure rules added 2024 |
| Indiana | Disclosure rules added 2024 |
| Wisconsin | Disclosure rules added 2025 |
| North Dakota | Disclosure rules added 2025 |

## GREEN tier — prioritize

Texas, Florida, Georgia, Alabama, Missouri, Arkansas, Mississippi, Louisiana, Ohio (has disclosure but workable), Nevada, New Mexico, Utah, Colorado, Kansas, Nebraska, Washington (private buyer lists only), and others not listed in the above tiers.

**Texas and Florida** in particular have huge inventory in the $200k–$400k band and the largest flipper pools in the country — they should be overweighted in the initial target set.

## Refresh procedure

Every 90 days:

1. Search current law for "wholesaling regulation [state] 2026" or current year, focusing on news from the last quarter.
2. Check NAR (National Association of Realtors) policy bulletins.
3. Check REIA (Real Estate Investors Association) state chapters for advocacy alerts.
4. Update this file with date stamp and changelog entry.
5. Mid-quarter, if a state moves block ↔ high-friction ↔ green, flag any active leads in that state for operator review rather than auto-dropping.

## Sources verified for this version

Per April 2026 web search:
- South Carolina HB 4754
- Illinois Real Estate License Act amendments
- Oklahoma SB 1075 + Predatory Wholesaler Act
- Kentucky HB 62
- Pennsylvania Bill 52
- Connecticut HB 7287 / Public Act 25-168 (effective July 2026)
- Oregon Real Estate Agency registration rules

If you're updating this in the future, replace these source citations with your own verified sources from the refresh date.

## Changelog

- **2026-04-26:** Initial version. SC, IL, OK, KY, PA, VA blocked. CT, OR, MD, AZ, CA, IA, TN, IN, WI, ND high-friction.
