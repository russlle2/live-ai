# Overnight Report v3

Run: **run_20260213_063625**
Started: 2026-02-13T11:36:25.902Z
Finished: 2026-02-13T11:36:25.941Z

## Volume
- Sessions: **10**
- Turns: **30**
- Suppressed: **4**
- Moment=unknown: **8**

## Coverage
### Moment distribution (top 15)
- security: 8
- unknown: 8
- integration: 7
- competitor: 4
- price: 2
- deployment: 1

### Micro-goal distribution (top 15)
- define_requirements: 7
- de_risk_security: 7
- clarify: 7
- advance_next_step: 5
- differentiate: 3
- qualify_deployment: 1

### Confidence band
- low: 25
- medium: 5

## Product-pack usage
- usedProductPack=true: 0
- usedProductPack=false: 30

### Facts used per suggestion
- 0: 30
- 1: 0
- 2: 0
- 3+: 0

## Top terms correlated with unknown/suppressed
- we're: 10
- about: 7
- deciding: 7
- week: 7
- retention: 6
- quick: 4
- question: 4
- sync: 3
- salesforce: 3
- sso: 3
- store: 3
- call: 3
- audio: 3
- pii: 3
- redaction: 3
- windows: 3
- concerned: 3
- soc: 3
- data: 3
- handle: 3
- short: 3
- version: 3
- dit: 3
- oui: 3
- quel: 3
- est: 3
- calendrier: 3
- ploiement: 3
- integrate: 2
- deep: 2

## Suggested next patches (human review)
1) **Stakeholder sign-off**: Add moment/intent patterns for "signs off", "approve", "CFO", "procurement", "legal review".
2) **Style constraints**: Detect and honor modifiers like "short version", "non-technical", "answer today".
3) **Off-topic prompts**: Keep a consistent fallback: clarify → reframe back to evaluation criteria → propose next step.
4) **Suppression**: If confidence is low, default to a safe clarify question instead of outputting nothing.

## How to run again
```bash
bash tools/overnight/run_v3.sh --minutes 1 --sessions 10 --turns 3 --concurrency 1
```

