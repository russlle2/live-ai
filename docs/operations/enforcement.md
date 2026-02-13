# Enforcement & Governance

This repo is structured so you can **sell** the product with a straight face:
the unsafe surfaces are small, reviewed, and testable.

## Safety-critical surfaces (treat as governed)
1. `packages/shared/src/sanitize/sanitizePatch_v1.ts`
2. `packages/shared/src/protocol/*_v1.ts`
3. `apps/server/src/arbitration/*`

These files define what the overlay is allowed to do, and how messages flow.

### Recommended GitHub settings
- Protect `main`
- Require PR reviews
- Require CI to pass
- Add CODEOWNERS (already scaffolded in `.github/CODEOWNERS`)
- Require review from `@security-reviewers` for sanitizer/protocol changes

## Protocol discipline

### `/ws` client message union (must remain stable)
`start | flush | stop | ping`

If you need to add a new message, version the protocol explicitly:
- add `ws_messages_v2.ts`
- keep `v1` running until clients migrate

### Overlay message union (must remain stable)
`script | settings | patch`

Do not add new types. If you feel you must, you probably want to extend patch paths instead.

## Patch discipline
- Only `replace` ops are allowed.
- Only allowlisted paths are allowed.
- Payload is capped at 8192 bytes.
- Deep objects, large arrays, and control characters are clamped.

**Rule of thumb:** patches should update UI state, never execute behavior.

## No transcript logging
The server stores only:
- transcript hash
- transcript length
- derived scores

It does *not* store transcript text. Maintain this as a hard policy for pilots.

## Rollback and degrade
Production deployments should implement:
- Health checks for retrieval + LLM services
- Automatic downgrade to P0 template-only on any instability
- Alerting on patch rejection rate and trust score drops
