# User guide (demo)

## Start a session
1. Open the web UI (default `http://localhost:5173`)
2. Fill in Tenant / Rep / Session
3. Click **Start Session**

The backend will:
- insert/refresh a `sessions` row
- send `ready`
- optionally start the STT mock stream (`STT_MOCK=1`)

## Generate guidance
- Wait for the STT mock transcript, or
- Type a transcript line and click **Send transcript_final**

If the server produces guidance, you will see a card in the overlay preview.

## Actions
- **Apply**: marks the suggestion as used (telemetry)
- **Dismiss**: removes it
- **Mute**: suppresses suggestions in UI (telemetry)

## Trust dashboard
Click **Trust Dashboard** to see aggregated metrics and a trust score.

This is a starting point. Production trust dashboards should include:
- per-rep drill downs
- time-windowed metrics
- alerts and automated degrade/rollback triggers
