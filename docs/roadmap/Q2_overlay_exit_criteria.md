# Q2 Overlay Exit Criteria (operationalized)

These are the “prove it works safely” gates before you try to sell into serious pilots.

## Hard gates (must pass)

### Overlay safety
- `sanitizePatch_v1` enforced end-to-end
- Patch allowlist locked and reviewed
- `MAX_PATCH_BYTES=8192` enforced
- Patch rejection taxonomy emitted and dashboarded
- Patch coalescer prevents patch spam

### Protocol discipline
- `/ws` client message union types remain: `start | flush | stop | ping`
- overlay message union remains: `script | settings | patch`
- Add protocol lock tests in CI (do not ship without)

### Privacy & data handling
- **No raw transcript logging** (only hash+len+quality)
- Debug bundle is privacy-safe (no transcript content)
- Tenant IDs required at boundaries

### Reliability + degrade
- Deterministic downgrade to template-only when:
  - dependencies unhealthy (LLM rate limit/timeout)
  - retrieval unavailable
- “AI depth” indicator visible to the user (P0–P3)

## KPIs (targets)
- patch_rejected / patch_received < 0.5%
- mute_on_within_30s / shown < 8%
- undo / shown < 5%

## Evidence to produce
- Recorded demo sessions (screen captures)
- CI logs showing protocol lock tests
- Dashboard screenshots (trust + patch reject rate)
