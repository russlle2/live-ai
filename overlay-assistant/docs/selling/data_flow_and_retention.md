# Data Flow & Data Retention Statement

## Purpose

This document describes what data Overlay Assistant processes, how it flows through the system, what is stored, and what is explicitly **never** stored.

---

## Data Flow Summary

```
Mic / Typed Input
      │
      ▼
┌──────────────┐     ┌──────────────────────┐
│  Web Client  │────▶│  WebSocket Server     │
│  (browser)   │     │  /ws                  │
│              │◀────│                       │
└──────────────┘     └──────────┬───────────┘
                                │
                     ┌──────────▼───────────┐
                     │  Arbitration Engine   │
                     │  (regex + templates)  │
                     │  SHA-256 hash only    │
                     └──────────┬───────────┘
                                │
              ┌─────────────────┼─────────────────┐
              ▼                 ▼                  ▼
      ┌──────────────┐  ┌──────────────┐  ┌──────────────┐
      │  Guidance    │  │  obs_events   │  │  crm_write   │
      │  (to client) │  │  (metadata)   │  │  _events     │
      └──────────────┘  └──────────────┘  └──────────────┘
```

## What We Process (in memory only)

| Data | Where | Retention |
|------|-------|-----------|
| Raw transcript text | Server memory | **Ephemeral** — processed inline, never written to DB or logs |
| Speaker label (rep/lead/unknown) | Server memory | Ephemeral |

## What We Store

| Data | Table | Retention | Contains PII? |
|------|-------|-----------|---------------|
| Transcript SHA-256 hash | `obs_events.data` | Configurable | No |
| Transcript length (chars) | `obs_events.data` | Configurable | No |
| UI events (shown/applied/dismissed/mute/undo) | `obs_events` | Configurable | No |
| Patch metadata (bytes, latency) | `obs_events` | Configurable | No |
| Session start/end timestamps | `sessions` | Configurable | No |
| CRM write audit trail | `crm_write_events` | Configurable | Tenant-scoped, no transcript |
| OAuth credentials (encrypted) | `oauth_credentials` | Until revoked | Encrypted AES-256-GCM |
| Trust daily rollups | `trust_daily` | Configurable | No |

## What We NEVER Store

- Raw transcript text (spoken words)
- Audio recordings
- Meeting video
- Screen captures
- Any PII from the conversation content
- Unencrypted OAuth tokens

## Data Boundaries

- **Tenant isolation**: Every DB query is scoped by `tenant_id`. There is no cross-tenant data access path.
- **Log safety**: `emitLog` caps payload at 4096 bytes, strips control characters, and applies depth limits. The `ui-event` endpoint rejects payloads containing `transcript`, `utterance`, `raw_text`, or `full_text` fields.
- **Debug bundles** (future): Will contain only metadata and SHA-256 hashes — never transcript content.

## Retention Policy

Data retention is configurable per deployment:

| Tier | Default Retention | Configurable? |
|------|-------------------|---------------|
| `obs_events` (telemetry) | 90 days | Yes |
| `sessions` | 90 days | Yes |
| `crm_write_events` | 1 year | Yes |
| `trust_daily` | 1 year | Yes |
| `oauth_credentials` | Until revoked | Manual |

Customers can request full data deletion. All tables support `DELETE WHERE tenant_id = $1`.

## Compliance Alignment

| Standard | How We Align |
|----------|-------------|
| SOC 2 Type II | No raw data logging; encrypted credentials; audit trail for all integrations |
| GDPR | No PII stored from conversations; tenant isolation; deletable on request |
| HIPAA | No PHI in stored data; transcript never persisted; encryption at rest |
