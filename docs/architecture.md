# Architecture (foundation)

## Arbitration locus
This repo sets `ARBITRATION_LOCUS=backend` by default.

**Why backend?**
- centralizes model keys, cost caps, and governance
- simplifies tenant isolation and telemetry
- supports enterprise deployment (SOC2, audit trails, rollbacks)

You can switch to `browser` or `both` later, but treat it as an architectural invariant.

## Invariants you must keep
- No new overlay message types (only: `script | settings | patch`)
- Patches are sanitized and bounded (`MAX_PATCH_BYTES=8192`)
- No raw transcript logging (hash + len only)

## Data model (privacy-safe)
- `sessions`: session metadata
- `obs_events`: structured events (no transcript text)
- `crm_write_events`: idempotent integration writes
- `trust_daily`: optional rollups

## Trust dashboard
The trust dashboard is fed by:
- `patch_received`, `patch_rejected`
- `suggestion_shown`, `suggestion_applied`, `suggestion_dismissed`
- `mute_on`, `undo`
and computed into a `trust_score` (0-100).
