# Enterprise Policy Templates

These templates provide a baseline for universally compatible customer deployments.

## 1) Session control policy

- Host role: full controls, can set guidance mode and depth.
- Controller role: real-time controls from mobile or Bluetooth bridge.
- Viewer role: feedback-only, no mode/depth mutation.
- Rate limit controls: max 12 commands per 3 seconds per socket.

## 2) Data and logging policy

- No raw transcript persistence in telemetry streams.
- Only hashed transcript references and metadata in logs.
- Idempotent connector writes with audit trail in crm_write_events.

## 3) Integration egress policy

- Outbound integration targets must be host-allowlisted.
- All connector payloads should be signed with HMAC when supported.
- Per-integration bearer tokens scoped per tenant in production.

## 4) Universal compatibility policy

- Desktop host interface required for full control/observability.
- Mobile controller interface required for live coaching mobility.
- Bluetooth remote input permitted via mobile bridge only.
- Meeting platform integrations routed via universal dispatcher.

## 5) Deployment policy

- TLS required for all production traffic.
- API key required for WS start and API mutation paths.
- Per-tenant keys, rotation schedule, and blast-radius controls.
