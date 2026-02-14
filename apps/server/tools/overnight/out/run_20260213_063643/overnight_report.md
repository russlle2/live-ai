# Overnight Report v3

Run: **run_20260213_063643**
Started: 2026-02-13T11:36:43.228Z
Finished: 2026-02-13T11:36:44.442Z

## Volume
- Sessions: **600**
- Turns: **7200**
- Suppressed: **961**
- Moment=unknown: **2621**

## Coverage
### Moment distribution (top 15)
- unknown: 2621
- integration: 1367
- security: 1039
- competitor: 727
- value: 406
- price: 321
- deployment: 303
- stakeholder: 218
- timeline: 198

### Micro-goal distribution (top 15)
- clarify: 2248
- advance_next_step: 1612
- define_requirements: 1282
- differentiate: 635
- de_risk_security: 608
- qualify_deployment: 303
- isolate_constraint: 266
- map_stakeholders: 218
- reframe_value: 28

### Confidence band
- low: 6266
- medium: 934

## Product-pack usage
- usedProductPack=true: 0
- usedProductPack=false: 7200

### Facts used per suggestion
- 0: 7200
- 1: 0
- 2: 0
- 3+: 0

## Top terms correlated with unknown/suppressed
- we're: 1690
- version: 1464
- i'm: 1420
- short: 1288
- week: 1188
- what's: 1098
- non-technical: 1011
- deciding: 990
- also: 964
- quick: 871
- question: 871
- answer: 797
- need: 626
- competitor: 595
- straight: 577
- about: 561
- review: 540
- tell: 493
- quel: 457
- est: 457
- call: 452
- security: 451
- product: 420
- technical: 409
- next: 400
- needs: 390
- keep: 385
- one: 385
- sentence: 385
- salesforce: 375

## Suggested next patches (human review)
1) **Stakeholder sign-off**: Add moment/intent patterns for "signs off", "approve", "CFO", "procurement", "legal review".
2) **Style constraints**: Detect and honor modifiers like "short version", "non-technical", "answer today".
3) **Off-topic prompts**: Keep a consistent fallback: clarify → reframe back to evaluation criteria → propose next step.
4) **Suppression**: If confidence is low, default to a safe clarify question instead of outputting nothing.

## How to run again
```bash
bash tools/overnight/run_v3.sh --minutes 60 --sessions 600 --turns 12 --concurrency 2
```

