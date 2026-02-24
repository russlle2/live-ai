# Universal Compatibility Blueprint

## Goal

Run one live coaching engine across desktop overlays, phone controllers, Bluetooth devices, Zoom, Google Meet, Google Workspace, and server-side workflows.

## Compatibility matrix

- `desktop` client (`apps/web`): host role, full session controls, overlay rendering.
- `mobile` client (`apps/mobile`): controller role, quick controls + quality feedback + optional Web Bluetooth pairing.
- `bluetooth_remote` devices: represented as control sources through the mobile bridge.
- `zoom`, `google_meet`, `google_workspace`, `server_webhook`: unified through `apps/server/src/integrations/universal_dispatch.ts`.

## Security and lock-down

- WS start requires API key when configured (`OVERLAY_API_KEY`).
- Session identity lock: existing session IDs cannot be rebound to different tenant/rep pairs.
- RBAC: `host`, `controller`, `viewer` roles with allowlisted control actions.
- WS control rate limiting to protect against command floods.
- OAuth connector tokens are tenant-scoped and encrypted at rest.
- Integration egress is host-allowlisted and payload-signable via HMAC.
- Sanitized patch boundary remains enforced by shared protocol sanitizer.

## Post-context correction behavior

- Server tracks prior guidance interpretation (stage/moment/line hash).
- If a new turn changes interpretation, it emits `correction` with explicit reason.
- Manual `request_reframe` from desktop or mobile emits correction reason `user_reframe_request`.

## Integration extension contract

1. Implement adapter in `apps/server/src/integrations/*_stub.ts` replacement file.
2. Preserve idempotency writes via `recordIdempotentWrite`.
3. Register adapter in `universal_dispatch.ts`.
4. Keep payloads transcript-safe (no raw transcript fields).

## Production notes for universal customer support

- Web Bluetooth is browser/device dependent; use a native mobile bridge for guaranteed iOS/Android BLE support.
- Zoom/Google integrations should run as authenticated connectors with tenant-scoped credentials.
- For enterprise universal mode, run server behind gateway, enforce TLS, and use per-tenant API keys/rotation.
- OAuth apps (Zoom/Google) should use tenant-aware callbacks and least-privilege scopes.
