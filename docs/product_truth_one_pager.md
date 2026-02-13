# Product Truth (one page)

## What it is
**Overlay Assistant** is a real-time “call copilot” that turns live transcript blocks into **bounded, safe guidance** shown in an overlay.

It is designed to be **enterprise-credible** by default:
- deterministic first (templates + rules),
- guarded LLM usage (optional, cost-capped),
- audit-friendly telemetry **without storing transcripts**,
- and an overlay that cannot be “taken over” by unsafe payloads because all UI mutations are gated by `sanitizePatch_v1`.

## The promise
Help a rep say the right thing at the right moment **without** hallucinating, leaking customer data, or taking unpredictable actions.

## Who it’s for
B2B sellers and CS teams who run discovery calls, demos, renewals, and support escalations.

## Customer outcomes
- More consistent discovery
- Better objection handling (pricing/security/procurement)
- Higher conversion (next steps, mutual action plans)
- Faster onboarding (junior reps get senior playbooks)

## Key differentiator
Competitors can copy “AI suggestions.”
They struggle to copy **safety + governance + trust mechanics**:
- patch safety and payload caps,
- deterministic arbitration with safe downgrades,
- explainability without transcript logging,
- and trust metrics that automatically trigger rollback/degrade modes.

## How it works (high level)
1. Receive `transcript_final` blocks.
2. Score intents/objections deterministically.
3. Produce candidate guidance (templates).
4. (Optional) enrich with retrieval and LLM rewrite under cost/health gates.
5. Emit an overlay patch that is sanitized and size-capped.
6. Track outcomes (shown/applied/dismissed/mute/undo) to compute a trust score.

## What you sell
- A SaaS or self-hosted service that integrates with a meeting platform + CRM.
- A governed “playbook” layer (templates/rules) and safe overlay UX.

## Non-goals
- Storing or training on raw transcripts by default.
- Taking autonomous actions without the rep in control.
