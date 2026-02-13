# Overnight Prompts (for your API assistant)

Use these prompts to iteratively improve the repo. Keep each run small and ship-ready.

## 1) Patch sanitizer hardening
"""
Review sanitizePatch_v1.ts. Propose stricter allowlist and value clamps that still support guidance cards.
Add fuzz tests that try to bypass it (prototype pollution, huge arrays, deep nesting, invalid ops) and ensure it rejects.
"""

## 2) Trust score tuning
"""
Given the trust score formula in server/db/queries.ts, propose a better scoring model aligned with these SLOs:
- patch_reject_rate_daily < 0.3%
- mute_on_within_30s/shown < 8%
- undo/shown < 5%
Add unit tests covering edge cases.
"""

## 3) Arbitration improvements (still deterministic)
"""
Improve arbitration_v1 to select 1-2 best guidance items based on intents/objections + cooldowns.
Must be deterministic and testable.
Add tests for tie-breaks and cooldown behavior.
"""

## 4) Integration stubs → real connectors
"""
Turn the integration stubs into real connector scaffolding:
- OAuth token storage (encrypted at rest)
- per-tenant credential scoping
- idempotent write patterns with retries/backoff
- structured telemetry for each attempt (no raw transcript fields)
Keep the public interface stable and add contract tests.
"""
