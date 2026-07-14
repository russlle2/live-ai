# ARCHIVED — predecessor SaaS integration draft

This file is historical design context and does not describe the current personal app.

# Integration Architecture

## Overview

Overlay Assistant integrates with external CRM systems (Salesforce, HubSpot) through a pluggable adapter pattern with tenant-scoped credentials, idempotent writes, and deterministic retry/backoff.

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                        OVERLAY ASSISTANT                            │
│                                                                     │
│  ┌──────────┐     ┌──────────────┐     ┌────────────────────────┐  │
│  │  Web UI   │────▶│  Express API │────▶│  Integration Router    │  │
│  │ (React)   │     │   :8080      │     │  /api/integrations/*   │  │
│  └──────────┘     └──────────────┘     └────────┬───────────────┘  │
│                          │                       │                  │
│                          │                       ▼                  │
│                   ┌──────┴──────┐     ┌────────────────────────┐   │
│                   │  WebSocket  │     │    withRetry()          │   │
│                   │  /ws        │     │  - 3 attempts max      │   │
│                   └─────────────┘     │  - exponential backoff │   │
│                                       │  - jitter              │   │
│                                       └────────┬───────────────┘   │
│                                                │                   │
│            ┌───────────────────────────────────┼─────────────┐     │
│            │                                   │             │     │
│            ▼                                   ▼             │     │
│  ┌──────────────────┐              ┌──────────────────┐      │     │
│  │ Salesforce Adapter│              │  HubSpot Adapter │      │     │
│  │ (stub in v1)     │              │  (stub in v1)    │      │     │
│  └────────┬─────────┘              └────────┬─────────┘      │     │
│           │                                  │               │     │
│           ▼                                  ▼               │     │
│  ┌──────────────────────────────────────────────────────┐    │     │
│  │            Idempotency Layer                         │    │     │
│  │  - Dedup by (tenant_id, integration, idempotency_key)│    │     │
│  │  - Upsert on conflict                               │    │     │
│  └──────────────────┬──────────────────────────────────┘    │     │
│                     │                                        │     │
│                     ▼                                        │     │
│  ┌──────────────────────────────────────────────────────┐    │     │
│  │              PostgreSQL                              │    │     │
│  │  ┌──────────────────────┐  ┌──────────────────────┐  │    │     │
│  │  │  crm_write_events    │  │  oauth_credentials    │  │    │     │
│  │  │  (audit trail)       │  │  (AES-256-GCM)       │  │    │     │
│  │  └──────────────────────┘  └──────────────────────┘  │    │     │
│  └──────────────────────────────────────────────────────┘    │     │
│                                                              │     │
│  ┌──────────────────────────────────────────────────────┐    │     │
│  │           Observability (emitLog)                    │    │     │
│  │  - integration_write_attempt (per retry)             │    │     │
│  │  - integration_write_completed                       │    │     │
│  │  - integration_write_exhausted                       │    │     │
│  │  → obs_events table (no raw content)                 │    │     │
│  └──────────────────────────────────────────────────────┘    │     │
│                                                              │     │
└──────────────────────────────────────────────────────────────┘     │
                                                                      
                      ┌────────────────┐    ┌────────────────┐        
                      │  Salesforce    │    │  HubSpot       │        
                      │  REST API      │    │  REST API      │        
                      └────────────────┘    └────────────────┘        
```

## Key Design Decisions

### 1. Pluggable Adapter Pattern
Each CRM integration implements `IntegrationWriteRequest → IntegrationWriteResult`. Adding a new CRM means:
1. Create a new adapter file implementing the interface
2. Register it in the integration router
3. Run the same contract tests

### 2. Idempotent Writes
Every write carries an `idempotencyKey`. The `crm_write_events` table enforces uniqueness on `(tenant_id, integration, idempotency_key)`. Re-sends with the same key are safe upserts.

### 3. Deterministic Retry/Backoff
- Max 3 attempts
- Exponential backoff: 500ms → 1000ms → 2000ms + random jitter (0–200ms)
- Only `retryable_error` triggers retry; `ok` and `fatal_error` return immediately

### 4. Tenant-Scoped Credentials
- OAuth tokens encrypted at rest with AES-256-GCM
- Keyed by `(tenant_id, integration)` — each tenant's credentials are isolated
- Encryption key sourced from `CREDENTIAL_ENCRYPTION_KEY` env var (KMS in production)

### 5. Observability
Every write attempt emits a structured `emitLog` event (no raw content, only metadata):
- `integration_write_attempt` — per retry, includes attempt number + latency
- `integration_write_completed` — successful writes
- `integration_write_exhausted` — all retries failed

## Files

| File | Purpose |
|------|---------|
| `apps/server/src/integrations/integration_interface.ts` | TypeScript interface for all adapters |
| `apps/server/src/integrations/salesforce_stub.ts` | Salesforce adapter (stub) |
| `apps/server/src/integrations/hubspot_stub.ts` | HubSpot adapter (stub) |
| `apps/server/src/integrations/retry.ts` | Retry/backoff wrapper |
| `apps/server/src/integrations/idempotency.ts` | Idempotent write recording |
| `apps/server/src/integrations/credentials.ts` | Encrypted OAuth credential store |
| `apps/server/src/db/migrations/002_oauth_credentials.sql` | Credential table DDL |
