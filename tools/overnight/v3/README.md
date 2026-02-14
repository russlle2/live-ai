# Overnight Pipeline v3

This is a **drop-in** offline harness that stress-tests the coach engine for:
- **Moment detection** (integration, price, security, timeline, stakeholder sign-off, etc.)
- **Suppression behavior** (when suggestions are withheld)
- **Coverage** (does it produce guidance on weird/off-topic prompts without crashing?)
- **Facts usage** (product pack facts used vs. missing)

It writes an output bundle you can commit as an artifact or use to generate follow-up patches.

## Run (3 steps)

1) From repo root:
```bash
pnpm install
```

2) Run a time-based overnight pass (example: 45 minutes):
```bash
bash tools/overnight/run_v3.sh --minutes 45 --sessions 400 --turns 10 --concurrency 2
```

3) Open the output folder printed at the end:
- `metrics.json`
- `overnight_report.md`
- `top_terms_unknown.json`
- `regex_suggestions.md`
- `facts_todo.md`
- `events.jsonl` (all turns)

## Key knobs

- `--minutes N` : hard wall-clock stop (so it **will** run longer than 10 minutes if you set it)
- `--sessions N` : max sessions to simulate (each has multiple turns)
- `--turns N` : turns per session
- `--concurrency N` : parallel sessions (keep this small on older Macs; 2–4 is usually plenty)
- `--seed N` : deterministic randomness
- `--applyFacts` : auto-patch the most likely product-pack facts JSON (backs up the file first)

## What “unknown” usually means

If a turn ends up with `moment = "unknown"` or the suggestion is suppressed at low confidence,
v3 will surface:
- the **top phrases** that correlate with unknown/suppressed
- suggested **regex / intent** expansions
- a **facts todo** list that’s filtered to avoid noisy stopwords

## Safety / structure

- Does **not** require the web UI or server to be running.
- Imports the coach engine directly if available (`apps/server/src/arbitration/coach_engine_v1.ts`).
- Falls back to the older deterministic arbiter if the coach engine module is not found.
