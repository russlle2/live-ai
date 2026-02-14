# Pro Patch Pack – Off-track bridge + Unknown reducer + Server-crash fix (2026-02-14)

This patch pack targets three real issues surfaced by your stress/overnight runs:

1) **Server crash fix**  
   Your server was crashing at startup with `SyntaxError: Invalid regular expression ... Unterminated group` coming from `tone_pro_v1.ts`.
   The patch fixes the regex literal so the server boots.

2) **Unknown moment reducer (high impact)**  
   Your overnight run showed a meaningful number of `moment=unknown` decisions, and the *top unknown terms* strongly indicated
   missed detection of:
   - **Stakeholder sign-off / decision process** ("signs", "deciding", "cfo", "approve", etc.)
   - **Timeline windows** ("week", "today", "tomorrow", "by end of", etc.)

   The patch adds conservative regex rules for those signals.

3) **Off-track bridge (rare behavior)**  
   Adds a shared utility that detects off-topic drift or metaphor requests (weather/sports/travel/etc).  
   If triggered, it prepends 1–2 sentences of “talk shop” to build trust, then pivots back into the original
   sales question (the engine’s suggestion line).

4) **Tooling reliability**  
   Updates `tools/overnight/run_v3.sh` so it runs even if `tsx` is not installed globally (uses `pnpm exec tsx`).

## How to apply

Copy the `tools/pro_patches/` folder into your repo, then run:

```bash
cd "$HOME/Desktop/overlay-assistant"
bash tools/pro_patches/apply_pro_patch_offtrack_unknownfix.sh
```

Then:

```bash
pnpm install
pnpm -C packages/shared run build
pnpm -C apps/server run build
pnpm -C apps/web run build
pnpm dev
```

Verify:

```bash
curl -s http://localhost:8080/health
```

## Notes

- Moment-detector patching is **best-effort**. If your moment detector file format differs,
  the script will warn. In that case, paste `apps/server/src/arbitration/moment_detector_v1.ts`
  and I’ll produce an exact patch.
- Off-track bridge is intentionally conservative (rare). It triggers only on clear off-topic cues or
  explicit analogy/metaphor requests.

## Bonus: Copy-debug button (sellability/ops)

Adds a **Copy debug** button in the Overlay Preview that copies the current overlay state JSON to clipboard. This makes customer support / bug reporting far easier than asking people to use DevTools.
