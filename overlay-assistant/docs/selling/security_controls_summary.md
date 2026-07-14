# ARCHIVED — predecessor SaaS controls draft

This file is historical design context and is not a certification or current control attestation.

# Security Controls Summary

## Purpose

This document summarizes the security controls built into Overlay Assistant, suitable for sharing with enterprise security reviewers and procurement teams.

---

## 1. Data Protection

| Control | Implementation | Status |
|---------|---------------|--------|
| **No raw transcript storage** | Transcripts processed in-memory only; only SHA-256 hash + length logged | Enforced |
| **Payload size cap** | `MAX_PATCH_BYTES = 8192` — all patches rejected above this | Enforced |
| **Patch allowlist** | Only `text` and `settings` fields permitted; all other keys dropped | Enforced |
| **Log content capping** | `emitLog` enforces 4096-byte max, depth limit of 6, strips control chars | Enforced |
| **Transcript leakage guard** | `/api/ui-event` rejects payloads containing `transcript`, `utterance`, `raw_text`, `full_text` | Enforced |
| **Credential encryption** | OAuth tokens encrypted with AES-256-GCM at rest | Implemented |

## 2. Tenant Isolation

| Control | Implementation | Status |
|---------|---------------|--------|
| **Tenant ID required at boundaries** | WebSocket `start` message requires `tenantId`; all API endpoints validate it | Enforced |
| **Scoped DB queries** | Every query filtered by `tenant_id` — no cross-tenant access path | Enforced |
| **Scoped credentials** | OAuth credentials keyed by `(tenant_id, integration)` with unique constraint | Enforced |
| **Deletable on request** | All tables support `DELETE WHERE tenant_id = $1` for full tenant wipe | Available |

## 3. Protocol Safety

| Control | Implementation | Status |
|---------|---------------|--------|
| **Protocol lock tests** | CI tests assert WebSocket message union = `start \| flush \| stop \| ping` and overlay union = `script \| settings \| patch` | In CI |
| **Fail-closed sanitizer** | `sanitizePatch_v1` rejects anything not on the allowlist — never passes through unknown fields | Enforced |
| **Patch rejection taxonomy** | Rejections classified as `payload_too_large`, `not_an_object`, `no_allowed_fields` and logged | Enforced |
| **Patch coalescer** | Prevents patch spam — rapid patches debounced (500ms trailing edge) | Enforced |

## 4. Integration Security

| Control | Implementation | Status |
|---------|---------------|--------|
| **Idempotent writes** | Every CRM write keyed by `(tenant_id, integration, idempotency_key)` with upsert | Enforced |
| **Deterministic retry** | Exponential backoff (500ms base, 3 max retries) with jitter — no thundering herd | Enforced |
| **Audit trail** | All integration writes recorded in `crm_write_events` table | Enforced |
| **Observability per attempt** | Each retry attempt emits a structured log event (no raw content) | Enforced |

## 5. Reliability & Degradation

| Control | Implementation | Status |
|---------|---------------|--------|
| **Template-only fallback** | If external dependencies fail, arbitration falls back to regex + template (fully local) | Enforced |
| **AI depth indicator** | `aiDepth` field (P0–P3) communicated to the UI — user always knows the AI involvement level | Enforced |
| **Fire-and-forget telemetry** | Observability writes are buffered and non-blocking — never crash the hot path | Enforced |
| **Server-side heartbeat** | WebSocket ping every 25s; stale connections cleaned up | Enforced |

## 6. Deployment Security

| Control | Implementation | Status |
|---------|---------------|--------|
| **Docker multi-stage build** | Minimal runtime image (`node:22-slim`), no dev dependencies in production | Available |
| **Environment-based config** | Secrets via env vars (`OPENAI_API_KEY`, `CREDENTIAL_ENCRYPTION_KEY`, `DATABASE_URL`) — no hardcoded secrets | Enforced |
| **CORS origin control** | Historical draft; the current personal app requires one exact `WEB_ORIGIN` and rejects `*` | Superseded |

## 7. What's Planned (Not Yet Implemented)

| Item | Target Quarter |
|------|---------------|
| SSO/SAML auth adapter | Q4 |
| Fuzz / property-based testing for sanitizer | Q4 |
| Automated no-transcript-leakage test (log scanning) | Q4 |
| Meeting platform adapters (Zoom/Meet/Teams) | Q4 |
| KMS integration for credential encryption | Q4 |
| SOC 2 Type II formal audit | Post-Q4 |
