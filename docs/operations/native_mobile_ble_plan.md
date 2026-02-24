# Native Mobile BLE Bridge Plan

## Objective

Deliver stable Bluetooth remote control support across iOS and Android while preserving the existing WebSocket control protocol.

## Architecture

1. Native shell (Capacitor or React Native) hosts the current mobile UI.
2. BLE module reads hardware button events and maps them to control actions.
3. Action mapper emits WS control messages:
   - toggle_mute
   - request_reframe
   - set_guidance_mode
   - set_ai_depth
   - mark_helpful / mark_unhelpful
4. Session identity and role are bound at connection start.

## Reliability requirements

- Local queue for button events while temporarily offline.
- At-least-once event delivery with idempotency key in payload.
- Battery-aware polling mode for long calls.

## Security requirements

- Device pairing trust store per tenant profile.
- Signed BLE-origin command payloads to server bridge endpoint.
- Role-limited action mapping for remote devices.

## Implementation phases

- Phase 1: Native BLE read + WS command bridge.
- Phase 2: Background reconnect + offline queue.
- Phase 3: Device management UI and policy enforcement.
- Phase 4: Certification and compatibility matrix by handset/OS.
