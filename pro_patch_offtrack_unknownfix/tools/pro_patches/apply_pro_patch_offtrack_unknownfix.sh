#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# Overlay Assistant – Pro Patch Pack (Off-track bridge + Unknown reducer + Fix)
# Date: 2026-02-14
#
# What it does:
# 1) Fixes a server-crashing regex in apps/server/src/arbitration/pro/tone_pro_v1.ts
# 2) Adds a shared off-track bridge utility (packages/shared/src/coach/offtrack_bridge_v1.ts)
# 3) Hooks the off-track bridge into coach_engine_pro_v1.ts (best-effort patch)
# 4) Improves moment detection for stakeholder sign-off + timeline keywords (best-effort patch)
# 5) Makes tools/overnight/run_v3.sh work even if `tsx` isn't globally installed
#
# Run from repo root:
#   bash tools/pro_patches/apply_pro_patch_offtrack_unknownfix.sh
# ==============================================================================

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

echo "== Pro patch: repo root = $ROOT =="

# ---------- helpers ----------
python_patch () {
  python3 - <<'PY'
import sys, re
from pathlib import Path

def die(msg: str):
    print(msg, file=sys.stderr)
    raise SystemExit(1)

def read(p: Path) -> str:
    if not p.exists():
        die(f"[patch] missing: {p}")
    return p.read_text(encoding="utf-8")

def write(p: Path, s: str):
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(s, encoding="utf-8")

def patch_tone_regex():
    p = Path("apps/server/src/arbitration/pro/tone_pro_v1.ts")
    if not p.exists():
        print("[patch] tone_pro_v1.ts not found; skipping tone regex fix.")
        return
    t = read(p)
    t2 = t.replace(r"/\b(today|this week|right now|now\b/i", r"/\b(today|this week|right now|now)\b/i")
    # Fallback: catch any unterminated group variant
    t2 = re.sub(r"/\\b\(today\|this week\|right now\|now\\b/i", r"/\b(today|this week|right now|now)\b/i", t2)

    if t2 == t:
        # Try a looser replacement (handles spacing)
        t2b = re.sub(r"/\\b\(\s*today\s*\|\s*this week\s*\|\s*right now\s*\|\s*now\s*\\b/i",
                     r"/\b(today|this week|right now|now)\b/i", t)
        if t2b != t:
            t2 = t2b

    if t2 == t:
        print("[patch] tone regex fix: pattern not found (maybe already fixed).")
        return

    write(p, t2)
    print("[patch] ✅ fixed invalid regex in tone_pro_v1.ts")

def add_shared_offtrack_bridge():
    p = Path("packages/shared/src/coach/offtrack_bridge_v1.ts")
    if p.exists():
        print("[patch] shared offtrack bridge already exists; skipping create.")
        return

    code = """\
/**
 * offtrack_bridge_v1
 * Rare behavior: if a buyer goes off-track (weather/sports/etc), we:
 * - acknowledge briefly (trust)
 * - tie back to the sale (redirect)
 *
 * This is intentionally conservative: triggers only on clear off-topic cues,
 * or when the buyer asks for a metaphor/analogy that includes an off-topic domain.
 */
export type OfftrackBridgeTopic =
  | "weather"
  | "sports"
  | "travel"
  | "food"
  | "pets"
  | "movies"
  | "music"
  | "smalltalk";

export type OfftrackBridgeResult = {
  triggered: boolean;
  topic?: OfftrackBridgeTopic;
  line: string;
  reason?: "drift" | "metaphor";
};

function normalize(s: string) {
  return (s || "").replace(/\\s+/g, " ").trim();
}

function hardTrim(s: string, maxChars: number) {
  const t = normalize(s);
  if (t.length <= maxChars) return t;
  return t.slice(0, Math.max(0, maxChars - 1)) + "…";
}

const OFFTRACK_TOPICS: { topic: OfftrackBridgeTopic; rx: RegExp; }[] = [
  { topic: "weather", rx: /\\b(weather|forecast|rain|sunny|humidity|hurricane|snow|temperature|storm)\\b/i },
  { topic: "sports",  rx: /\\b(nfl|nba|mlb|nhl|soccer|football|basketball|playoffs|team|score|season)\\b/i },
  { topic: "travel",  rx: /\\b(travel|flight|hotel|vacation|trip|airport|beach|road\\s*trip)\\b/i },
  { topic: "food",    rx: /\\b(food|restaurant|coffee|cafe|pizza|tacos|bbq|recipe|cooking)\\b/i },
  { topic: "pets",    rx: /\\b(dog|dogs|cat|cats|puppy|kitten|pet|pets)\\b/i },
  { topic: "movies",  rx: /\\b(movie|movies|tv|show|series|netflix|hbo|disney)\\b/i },
  { topic: "music",   rx: /\\b(music|song|songs|album|artist|concert)\\b/i },
];

const SALES_ANCHOR_RX =
  /\\b(price|pricing|cost|roi|value|budget|integration|api|webhook|sso|oauth|scim|crm|salesforce|hubspot|security|soc\\s?2|compliance|deploy|deployment|timeline|decision|procurement|legal|contract|demo|pilot)\\b/i;

const METAPHOR_RX =
  /\\b(analogy|metaphor|compare\\s+(it|this)\\s+to|like\\s+a|tell\\s+me\\s+how|explain\\s+it\\s+like|good\\s+medium)\\b/i;

function detectTopic(customerText: string): OfftrackBridgeTopic | null {
  for (const t of OFFTRACK_TOPICS) {
    if (t.rx.test(customerText)) return t.topic;
  }
  // fallback: very light "smalltalk"
  if (/\\b(how\\s+are\\s+you|how\\s+was\\s+your\\s+weekend|weekend|haha|lol)\\b/i.test(customerText)) return "smalltalk";
  return null;
}

function bridgeSentence(topic: OfftrackBridgeTopic): string {
  switch (topic) {
    case "weather":
      return "Weather’s a great analogy: it changes fast, so you win with reliable signals and a plan for edge cases.";
    case "sports":
      return "In sports terms, the fundamentals + a clear scoreboard matter more than a flashy play.";
    case "travel":
      return "Travel’s like implementation: the route matters, but the handoffs and reliability matter more.";
    case "food":
      return "Food analogy: ingredients are the integrations; the recipe is the workflow you need end‑to‑end.";
    case "pets":
      return "Totally—pets are all about consistency, which is also what buyers want from systems.";
    case "movies":
      return "Quick take: the best stories are simple—clear stakes, clear outcomes. Same idea in buying decisions.";
    case "music":
      return "Music works when the rhythm is steady—buyers want that same consistency in execution.";
    case "smalltalk":
    default:
      return "Totally—quick tangent for a second.";
  }
}

/**
 * Apply an off-track bridge to a suggested line (rare behavior).
 * - If the buyer is drifting: acknowledge topic, then pivot.
 * - If the buyer asks for a metaphor: give 1 sentence of “talk shop”, then pivot.
 */
export function applyOfftrackBridgeV1(args: {
  customerText: string;
  suggestedLine: string;
  maxChars?: number;
}): OfftrackBridgeResult {
  const maxChars = args.maxChars ?? 360;

  const customerText = normalize(args.customerText);
  const suggestedLine = normalize(args.suggestedLine);
  if (!customerText || !suggestedLine) return { triggered: false, line: suggestedLine };

  const topic = detectTopic(customerText);
  if (!topic) return { triggered: false, line: suggestedLine };

  const hasSalesAnchor = SALES_ANCHOR_RX.test(customerText);
  const asksMetaphor = METAPHOR_RX.test(customerText);

  // Trigger rules (conservative):
  // 1) Metaphor request + off-topic domain (even if still sales-anchored)
  // 2) Off-topic domain + no sales anchor (drift)
  const reason: OfftrackBridgeResult["reason"] | null =
    asksMetaphor ? "metaphor" : (!hasSalesAnchor ? "drift" : null);

  if (!reason) return { triggered: false, line: suggestedLine };

  const prefix =
    reason === "metaphor"
      ? `Fun analogy. ${bridgeSentence(topic)}`
      : `Happy to chat ${topic === "smalltalk" ? "" : "about " + topic}—quickly. ${bridgeSentence(topic)}`;

  const out = hardTrim(`${prefix} Bringing it back: ${suggestedLine}`, maxChars);
  return { triggered: true, topic, line: out, reason };
}
"""
    write(p, code)
    print("[patch] ✅ added packages/shared/src/coach/offtrack_bridge_v1.ts")

    # Ensure index.ts exports it
    idx = Path("packages/shared/src/index.ts")
    if idx.exists():
        t = idx.read_text(encoding="utf-8")
        if "offtrack_bridge_v1" not in t:
            t = t.rstrip() + "\nexport * from \"./coach/offtrack_bridge_v1\";\n"
            idx.write_text(t, encoding="utf-8")
            print("[patch] ✅ exported offtrack_bridge_v1 from packages/shared/src/index.ts")
        else:
            print("[patch] shared index.ts already exports offtrack bridge.")
    else:
        print("[patch] packages/shared/src/index.ts missing; skipping export patch.")

def patch_coach_engine_to_use_bridge():
    p = Path("apps/server/src/arbitration/coach_engine_pro_v1.ts")
    if not p.exists():
        print("[patch] coach_engine_pro_v1.ts not found; skipping engine hook.")
        return

    t = read(p)
    changed = False

    # 1) Add import
    if "applyOfftrackBridgeV1" not in t:
        # Insert after last import line
        lines = t.splitlines()
        last_import = 0
        for i, line in enumerate(lines):
            if line.startswith("import "):
                last_import = i
        ins = last_import + 1
        lines.insert(ins, 'import { applyOfftrackBridgeV1 } from "@overlay-assistant/shared";')
        t = "\n".join(lines) + "\n"
        changed = True

    # 2) Hook near "patch" creation (best-effort)
    if "offtrack_bridge_applied" not in t:
        hook = """
  // Off-track bridge (rare): acknowledge + tie back if buyer drifts or asks metaphor.
  try {
    if ((patch as any)?.text && typeof (patch as any).text === "string") {
      const bridged = applyOfftrackBridgeV1({ customerText: text, suggestedLine: (patch as any).text });
      if (bridged.triggered) {
        (patch as any).text = bridged.line;
        if ((patch as any)?.guidance?.items && Array.isArray((patch as any).guidance.items)) {
          (patch as any).guidance.items = (patch as any).guidance.items.map((it: any) =>
            it && typeof it.text === "string"
              ? ({ ...it, text: applyOfftrackBridgeV1({ customerText: text, suggestedLine: it.text }).line })
              : it
          );
        }
      }
    }
  } catch {
    // ignore
  }
"""
        # Insert right before a common return
        m = re.search(r"\n\s*return\s*\{\s*suppressed\s*:\s*false", t)
        if m:
            t = t[:m.start()] + "\n" + hook + t[m.start():]
            changed = True
        else:
            # fallback: insert before last "return"
            m2 = list(re.finditer(r"\n\s*return\s*\{", t))
            if m2:
                last = m2[-1]
                t = t[:last.start()] + "\n" + hook + t[last.start():]
                changed = True
            else:
                print("[patch] coach engine hook: couldn't find return site. Added import only.")

    if changed:
        write(p, t)
        print("[patch] ✅ patched coach_engine_pro_v1.ts to apply off-track bridge (best-effort)")
    else:
        print("[patch] coach_engine_pro_v1.ts already patched for off-track bridge.")

def patch_moment_detector_unknown_reducer(file_path: str):
    p = Path(file_path)
    if not p.exists():
        return False

    t = read(p)
    if "stake:signoff" in t and "time:window" in t:
        print(f"[patch] moment unknown reducer already present in {file_path}")
        return True

    # Attempt 1: patch MOMENT_RX if it exists (tone-style detector)
    if "MOMENT_RX" in t and ("stakeholder" in t or "timeline" in t):
        def inject(bucket: str, rule: str) -> str:
            # Find bucket array open
            pat = re.compile(rf"({bucket}\s*:\s*\[)", re.MULTILINE)
            m = pat.search(t)
            if not m:
                return t
            insert_at = m.end()
            return t[:insert_at] + "\n    " + rule.replace("\n", "\n    ") + "\n" + t[insert_at:]

        rule_stake = '{ id: "stake:signoff", re: /\\b(signs?\\s*off|approv(?:e|al)|decision\\s*maker|buying\\s*committee|procurement|legal|cfo|ceo|cto|vp|who\\s+decides|who\\s+approves)\\b/i, w: 0.72 },'
        rule_time  = '{ id: "time:window", re: /\\b(today|tomorrow|this\\s*week|next\\s*week|deadline|timeline|by\\s+(?:eod|end\\s+of)|quarter|q[1-4]|30[-\\s]?60\\s*days?)\\b/i, w: 0.62 },'
        t2 = t
        if "stakeholder" in t2:
            t2 = inject("stakeholder", rule_stake)
        if "timeline" in t2:
            t2 = inject("timeline", rule_time)

        if t2 != t:
            write(p, t2)
            print(f"[patch] ✅ improved moment detection (stakeholder + timeline) in {file_path} via MOMENT_RX injection")
            return True

    # NOTE: If MOMENT_RX isn't present, we skip (safer than guessing return types).

    print(f"[patch] ⚠️ couldn't patch moment detector at {file_path} (format unexpected).")
    return False


def patch_overlaypreview_copy_debug():
    p = Path("apps/web/src/components/OverlayPreview.tsx")
    if not p.exists():
        print("[patch] OverlayPreview.tsx not found; skipping debug-copy UI patch.")
        return
    t = read(p)
    if "Copy debug" in t or "copyDebug" in t or "navigator.clipboard" in t:
        print("[patch] OverlayPreview already has a debug-copy affordance; skipping.")
        return

    lines = t.splitlines()
    out = []
    inserted = False
    for line in lines:
        out.append(line)
        if (not inserted) and ("props.onMuteToggle" in line) and ("<button" in line):
            out.append('        <button')
            out.append('          onClick={() => {')
            out.append('            const payload = { ts: new Date().toISOString(), state };')
            out.append('            const s = JSON.stringify(payload, null, 2);')
            out.append('            navigator.clipboard?.writeText(s).catch(() => undefined);')
            out.append('          }}')
            out.append('          title="Copies a privacy-safe debug bundle (overlay state) to clipboard"')
            out.append('        >')
            out.append('          Copy debug')
            out.append('        </button>')
            inserted = True

    if not inserted:
        print("[patch] OverlayPreview debug-copy patch: anchor not found; skipping.")
        return

    write(p, "\n".join(out) + "\n")
    print("[patch] ✅ added 'Copy debug' button to OverlayPreview.tsx")

def patch_run_v3_sh():
    p = Path("tools/overnight/run_v3.sh")
    if not p.exists():
        print("[patch] tools/overnight/run_v3.sh not found; skipping tsx fallback patch.")
        return

    t = read(p)
    if "pnpm -s exec tsx" in t:
        print("[patch] run_v3.sh already has pnpm exec tsx fallback.")
        return

    # Insert a TSX runner selection near top
    lines = t.splitlines()
    out = []
    inserted = False
    for line in lines:
        out.append(line)
        if not inserted and line.startswith("set -euo pipefail"):
            out.append("")
            out.append("# Prefer local tsx via pnpm if tsx isn't globally available")
            out.append('if command -v tsx >/dev/null 2>&1; then')
            out.append('  TSX_RUN="tsx"')
            out.append('else')
            out.append('  TSX_RUN="pnpm -s exec tsx"')
            out.append('fi')
            inserted = True

    t2 = "\n".join(out) + "\n"
    # Replace plain "tsx " invocations with "$TSX_RUN "
    t2 = re.sub(r"(^|\n)\s*tsx\s+", r"\1$TSX_RUN ", t2)

    write(p, t2)
    print("[patch] ✅ patched tools/overnight/run_v3.sh to work without global tsx")

def main():
    patch_tone_regex()
    add_shared_offtrack_bridge()
    patch_coach_engine_to_use_bridge()

    patched_any = False
    for fp in [
        "apps/server/src/arbitration/moment_detector_v1.ts",
        "apps/server/src/arbitration/pro/moment_detector_pro_v1.ts",
    ]:
        patched_any = patch_moment_detector_unknown_reducer(fp) or patched_any

    if not patched_any:
        print("[patch] ⚠️ moment detector patch skipped (files not found or patch failed).")

    patch_run_v3_sh()
    print("\n[patch] ✅ DONE. Next: pnpm install (if needed), then rebuild and restart dev server.\n")

if __name__ == "__main__":
    main()
PY
}

python_patch

echo "== Patch applied. Recommended next commands =="
cat <<'NEXT'
1) Install deps (if you haven't since last pull):
   pnpm install

2) Build sanity check:
   pnpm -C packages/shared run build
   pnpm -C apps/server run build
   pnpm -C apps/web run build

3) Start dev:
   pnpm dev

Quick verify:
   curl -s http://localhost:8080/health
NEXT
