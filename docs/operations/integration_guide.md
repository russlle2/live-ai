# Integration guide

This repo includes **stubs** for integrations. Replace them with real connectors.

## STT / meeting capture (how to make it real)
You need a Meeting Adapter that yields `transcript_final` blocks.

Common options:
- Zoom Apps / Zoom SDK
- Google Meet / Chrome extension capture
- Microsoft Teams app

In production, you will:
1. collect audio (or take provided transcript)
2. run STT (cloud or local)
3. emit `transcript_final` blocks to the backend
4. backend emits overlay messages via WS

For v1 pilots, you can start by accepting transcript-only (no audio), if the meeting platform provides it.

## CRM integration
See:
- `apps/server/src/integrations/*`

Key rules:
- every write must have an `idempotencyKey`
- every write must be logged to `crm_write_events` (request+response metadata only)
- failures must be categorized (retryable vs fatal)

## Tenant isolation
Always require `tenantId` on:
- /ws start
- UI events
- integration writes
- trust dashboard queries

Enterprise: enable Postgres RLS and set `app.tenant_id` per request.
