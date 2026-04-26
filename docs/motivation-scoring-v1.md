# Motivation Scoring v1

How the Swarm decides which leads in the pipeline are worth touching today.

---

## Why this exists separately from persona

Persona tells you *what kind* of seller someone is. Motivation tells you *whether they're ready to act right now*. Two probate heirs can have identical personas but wildly different motivation scores — one inherited the house four months ago and just got a code violation; the other inherited it three years ago and rented it out and has settled in. Same persona, totally different treatment.

Without a motivation score, your outreach capacity gets wasted uniformly across your pipeline. With it, the top of your call queue is always the leads most likely to convert today.

Game design analogy: persona is the monster type (dragon, slime, skeleton). Motivation is the aggro meter — how likely that specific monster is to attack right now. Both matter; neither replaces the other.

## The five signal categories

### 1. Distress urgency — time pressure from the clock (weight: 0.35)

Biggest driver because deadlines force decisions.

| Signal | Score |
|---|---|
| Pre-foreclosure auction in <30 days | 100 |
| Pre-foreclosure auction in 30–60 days | 80 |
| Pre-foreclosure 60–90 days | 65 |
| Tax delinquent 3+ quarters (close to tax sale) | 85 |
| Probate filed 3–6 months ago (sweet spot) | 75 |
| Probate filed 12+ months ago | 35 |
| Active code violations with fines accumulating | 65 |
| No active distress | 20 |

Probate has a peak in the middle, not at the recent end. In the first 0–3 months, heirs are too overwhelmed by grief and paperwork. Around 4–6 months, the estate work is underway and the "what do we do with this house" conversation is happening. After 12+ months, the survivors have either sold or settled in to keeping it.

### 2. Financial pressure — the money bleeding out (weight: 0.25)

Counterintuitive: high equity + distress is a *higher* motivation signal than low equity + distress. Low-equity sellers often can't sell without bringing cash to closing — they're stuck and paralyzed. High-equity distressed sellers have room to accept a discount and still walk away with money.

| Signal | Score |
|---|---|
| Distressed + 40%+ equity | 90 |
| Distressed + 15–40% equity | 70 |
| Distressed + under 15% equity | 55 |
| No distress + any equity | 30 |

### 3. Life event accelerators — what just changed (weight: 0.15)

Life events are shocks that break inertia.

| Signal | Score |
|---|---|
| Divorce filed in last 6 months | 75 |
| Job relocation (out-of-state) in last 6 months | 80 |
| Death of co-owner in last 12 months | 70 |
| Multiple properties listed/sold simultaneously | 85 |
| None detected | 20 |

### 4. Engagement — did they actually respond (weight: 0.15)

Any response is a massive signal. Most sellers ghost everyone forever. A seller who replied "not interested right now but maybe later" is a 10x stronger lead than one with identical persona and distress who has never responded to anyone.

| Signal | Score |
|---|---|
| Responded positively (asked for offer, scheduled call) | 95 |
| Neutral response ("send info") | 70 |
| Opened email 3+ times, no reply | 55 |
| Answered phone, didn't engage | 45 |
| Zero engagement across all touches | 10 |

### 5. Condition deterioration — the property falling apart (weight: 0.10)

Lowest weight because it moves slowly, but real. Vacant properties with shut-off utilities mean the owner has given up on keeping it usable.

| Signal | Score |
|---|---|
| Utilities confirmed off + vacant | 85 |
| USPS vacancy flag, 6+ months | 75 |
| Street View shows year-over-year decline | 60 |
| Multiple code violations stacking | 70 |
| None | 20 |

## The formula

```
raw_motivation = (
    0.35 × distress_urgency
  + 0.25 × financial_pressure
  + 0.15 × life_event
  + 0.15 × engagement
  + 0.10 × condition_deterioration
)

motivation_score = raw_motivation × decay_factor
```

## Decay — the part most systems get wrong

Motivation isn't permanent. A lead scored 82 three months ago probably isn't at 82 anymore — either it converted to someone else or the urgency passed. If you treat old scores as current scores, your hot list is full of ghosts.

| Newest signal age | Decay factor |
|---|---|
| <30 days | 1.00 |
| 30–60 days | 0.90 |
| 60–120 days | 0.75 |
| 120–180 days | 0.55 |
| 180+ days | 0.35 |

**The clock resets whenever any new signal arrives** for that lead. A new tax filing, code violation, or engagement bumps the freshness clock back to zero. The system is constantly listening for new signals on old leads, not just new leads.

This is exactly like stat decay in a life-sim game — the Sim's hunger builds over time, a meal resets it, and the whole game loop is watching which meters are close to triggering.

## Thresholds and what they trigger

| Band | Score range | Behavior | % of pipeline |
|---|---|---|---|
| HOT | 80–100 | Top of outreach queue. Personal-touch cadence. Operator calls within 24h. | 2–5% |
| WARM | 60–79 | Automated multi-channel sequence. Weekly touches for 6–8 weeks. | ~15% |
| LUKEWARM | 40–59 | Monthly touch. Quarterly data refresh. | ~30% |
| COLD | 20–39 | Archive. Re-scored on new signals. No active outreach. | ~40% |
| ICE | 0–19 | Skip trace refresh only, quarterly. No spend. | rest |

## Persona-aware threshold adjustment

Same motivation score means different things by persona. A pre-foreclosure at 65 is actually urgent — the deadline is baked into the signal. A tired landlord at 65 is mildly interested with no clock.

Router applies persona-aware adjustments:

| Persona | Threshold adjustment |
|---|---|
| Pre-foreclosure | -10 (warm becomes hot) |
| Probate heir | -10 (warm becomes hot) |
| Tired landlord | 0 (standard bands) |
| Tired homeowner / life event | 0 |
| Vacant / distant absentee | -5 |
| Code violation / problem property | 0 |

## Why it earns its keep

The whole point of motivation scoring is answering: "of the 5,000 leads in my pipeline right now, which 50 should I touch today?" Without a score, that decision is random — best leads rot at the same rate as dead leads. With it, your daily call list self-assembles: top 50 by motivation, already filtered by router, already tagged with persona-matched scripts.

That's the difference between working a pipeline and drowning in one.
