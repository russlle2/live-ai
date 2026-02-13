# Q3 Integration Credibility Kit

Goal: make procurement believe you can integrate safely.

## What you must ship
- Tenant-scoped OAuth credential storage (encrypted)
- Idempotent write events (`crm_write_events`)
- Deterministic retry/backoff for integrations
- Observability events for each write attempt (no raw text)

## Reference implementation in this repo
See `apps/server/src/integrations/` for:
- `integration_interface.ts`
- `salesforce_stub.ts`
- `hubspot_stub.ts`
- idempotency helpers

## What to hand an enterprise buyer
- Integration architecture diagram
- Data flow / data retention statement
- Security controls summary
- Demo: “Create CRM note” with idempotent key + audit trail
