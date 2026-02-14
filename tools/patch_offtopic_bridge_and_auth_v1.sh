#!/usr/bin/env bash
set -euo pipefail

ROOT="$(pwd)"
if [[ ! -f "$ROOT/package.json" ]]; then
  echo "[patch] ERROR: run this from repo root (where package.json is)."
  exit 1
fi

echo "[patch] repoRoot=$ROOT"

########################################
# A) Add Off-topic Bridge module
########################################
mkdir -p "$ROOT/apps/server/src/arbitration/pro"

cat > "$ROOT/apps/server/src/arbitration/pro/offtopic_bridge_v1.ts" <<'TS'
import crypto from "crypto";

type ConfidenceBand = "low" | "medium" | "high";

function band(x: number): ConfidenceBand {
  if (x >= 0.8) return "high";
  if (x >= 0.5) return "medium";
  return "low";
}

function clamp01(x: number) {
  return Math.max(0, Math.min(1, x));
}

function id(prefix = "g") {
  return `${prefix}_${crypto.randomBytes(6).toString("hex")}`;
}

type OfftopicCategory = "weather" | "sports" | "travel" | "food" | "life" | "explicit" | "other";

const OFFTOPIC_RX: Array<{ cat: OfftopicCategory; re: RegExp; w: number; note: string }> = [
  { cat: "explicit", re: /\b(off[- ]?topic|random question|side note|unrelated)\b/i, w: 0.85, note: "explicit_offtopic" },

  { cat: "weather", re: /\b(weather|forecast|rain|storm|snow|sunny|humidity|temperature|hurricane)\b/i, w: 0.7, note: "weather" },
  { cat: "weather", re: /\b(florida|miami|orlando|tampa)\b/i, w: 0.25, note: "geo_florida" },

  { cat: "sports", re: /\b(nfl|nba|mlb|nhl|playoffs?|super bowl|world cup|game|season)\b/i, w: 0.7, note: "sports" },

  { cat: "travel", re: /\b(travel|flight|airport|hotel|vacation|trip|traffic|uber|rental)\b/i, w: 0.65, note: "travel" },

  { cat: "food", re: /\b(food|restaurant|coffee|lunch|dinner|pizza|tacos|sushi)\b/i, w: 0.6, note: "food" },

  { cat: "life", re: /\b(weekend|family|kids|birthday|holiday|how are you)\b/i, w: 0.55, note: "life_smalltalk" },
];

const SALES_RX: Array<{ re: RegExp; w: number }> = [
  { re: /\b(integration|api|webhook|sso|oauth|scim|crm|salesforce|hubspot|writeback|sync)\b/i, w: 0.35 },
  { re: /\b(price|pricing|budget|cost|expensive|roi|value)\b/i, w: 0.35 },
  { re: /\b(security|soc ?2|iso|audit|retention|pii|encryption)\b/i, w: 0.35 },
  { re: /\b(timeline|deadline|this quarter|q[1-4]|30[- ]?60 days)\b/i, w: 0.25 },
  { re: /\b(decision maker|sign[- ]?off|stakeholder|procurement|legal)\b/i, w: 0.25 },
  { re: /\b(next steps|demo|pilot|trial|contract)\b/i, w: 0.25 },
];

function score(text: string, rules: Array<{ re: RegExp; w: number }>) {
  let s = 0;
  for (const r of rules) if (r.re.test(text)) s += r.w;
  return clamp01(s);
}

function detectCategory(text: string): { cat: OfftopicCategory; score: number; notes: string[] } {
  let best: OfftopicCategory = "other";
  let bestScore = 0;
  const notes: string[] = [];
  for (const r of OFFTOPIC_RX) {
    if (r.re.test(text)) {
      notes.push(r.note);
      const s = clamp01(r.w + (best === r.cat ? 0.1 : 0));
      // prefer the strongest category hit
      if (s > bestScore) {
        bestScore = s;
        best = r.cat;
      }
    }
  }
  return { cat: best, score: bestScore, notes };
}

function talkShopSentence(cat: OfftopicCategory, text: string): string {
  const isFlorida = /\b(florida|miami|orlando|tampa)\b/i.test(text);

  switch (cat) {
    case "weather":
      return isFlorida
        ? "Florida weather can be a coin flip—sun one minute, storm the next."
        : "Weather’s a coin flip sometimes—conditions change fast.";
    case "sports":
      return "Yeah, it’s been a wild season—momentum swings fast.";
    case "travel":
      return "Travel always sounds simple until you hit timing + logistics—then it gets real.";
    case "food":
      return "Now you’ve got me thinking about food—solid choice.";
    case "life":
      return "Totally—life stuff matters, and it’s good to keep it human.";
    case "explicit":
      return "All good—happy to take the side question for a second.";
    default:
      return "Fair—happy to touch that quickly.";
  }
}

function bridgeBackSentence(anchorMoment: string | undefined, stage: string | undefined): string {
  // anchorMoment comes from the engine’s last known “sales moment” (integration/price/security/etc.)
  const m = (anchorMoment || "").toLowerCase();
  if (m === "integration") {
    return "Bringing it back to integration depth—what systems are must-have, and do you need read-only or writeback + audit logs?";
  }
  if (m === "price") {
    return "Bringing it back to price—what outcome matters most in the next 30–60 days so we can size the right scope and avoid overbuying?";
  }
  if (m === "security") {
    return "Bringing it back to security—are your must-haves SOC2 + retention, or do you also need SSO/SCIM and detailed audit logs?";
  }
  if (m === "timeline") {
    return "Bringing it back to timing—what date are you working toward and what has to be true for you to say yes?";
  }
  if (m === "stakeholder") {
    return "Bringing it back to stakeholders—who signs off (security/legal/procurement) and what usually slows approvals down for you?";
  }
  if ((stage || "").toLowerCase() === "evaluation") {
    return "Bringing it back—what’s the single thing you need to verify to feel confident picking a vendor?";
  }
  // default: discovery + clarify
  return "Bringing it back—what’s the #1 outcome you’re trying to achieve, and what’s the biggest risk you’re trying to avoid?";
}

export type OfftopicBridgeArgs = {
  text: string;
  stage?: string;
  moment?: string;
  memory: any; // keep loose to avoid type fights across versions
};

export type OfftopicBridgeReturn = {
  patch: any;
  meta: any;
  note: { category: OfftopicCategory; offScore: number; salesScore: number; anchorMoment?: string; notes: string[] };
};

export function maybeBuildOfftopicBridgePatchV1(args: OfftopicBridgeArgs): OfftopicBridgeReturn | null {
  const text = args.text || "";
  const stage = args.stage;
  const moment = args.moment;

  const { cat, score: offScore, notes } = detectCategory(text);
  const salesScore = score(text, SALES_RX);

  // Rare-trigger guardrails:
  // - must be clearly off-topic
  // - and not already full of sales intent
  // - and usually the engine was "unknown" or low-signal
  const momentUnknownish = !moment || moment === "unknown" || moment === "other";
  const strongOfftopic = offScore >= 0.6 || (cat === "explicit" && offScore >= 0.75);
  const lowSalesIntent = salesScore <= 0.25;

  // Cooldown: max 1-2 times per session
  const mem = (args.memory || {}) as any;
  const now = Date.now();
  const last = Number(mem.lastOfftopicAt || 0);
  const count = Number(mem.offtopicCount || 0);

  const cooldownOk = now - last > 4 * 60 * 1000; // 4 minutes
  const countOk = count < 2;

  if (!(strongOfftopic && lowSalesIntent && (momentUnknownish || offScore - salesScore >= 0.45) && cooldownOk && countOk)) {
    return null;
  }

  mem.lastOfftopicAt = now;
  mem.offtopicCount = count + 1;

  // Use engine’s last “primary” moment to bridge back
  const anchorMoment = (mem.lastPrimaryMoment || "").toString() || (momentUnknownish ? undefined : moment);

  const talkShop = talkShopSentence(cat, text);
  const bridgeBack = bridgeBackSentence(anchorMoment, stage);
  const line = `${talkShop} ${bridgeBack}`.replace(/\s{2,}/g, " ").trim();

  const conf = clamp01(0.62 + offScore * 0.25 - salesScore * 0.15);

  const item = {
    id: id("g"),
    title: "Acknowledge + bridge back",
    category: `rapport/offtopic/bridge_back`,
    text: line,
    confidence: conf,
    confidenceBand: band(conf),
    explanation: {
      rationale: "Buyer drifted to small-talk/off-topic. Acknowledge briefly to build trust, then pivot back with a crisp question.",
      meta: {
        stage: stage ?? "unknown",
        moment: "offtopic",
        microGoal: "acknowledge_then_pivot",
        hits: notes,
        confidence: conf,
        confidenceBand: band(conf),
      },
      factsUsed: [],
    }
  };

  const patch = {
    text: line,
    guidance: { items: [item] }
  };

  const meta = {
    stage: stage ?? "unknown",
    moment: "offtopic",
    microGoal: "acknowledge_then_pivot",
    hits: notes,
    confidence: conf,
    confidenceBand: band(conf),
    usedLLM: false,
    usedProductPack: true,
  };

  return { patch, meta, note: { category: cat, offScore, salesScore, anchorMoment, notes } };
}
TS

########################################
# B) Add API Key auth (sell-ready)
########################################
mkdir -p "$ROOT/apps/server/src/auth"

cat > "$ROOT/apps/server/src/auth/api_key_v1.ts" <<'TS'
import type { Request, Response, NextFunction } from "express";

function getKey(): string {
  return (process.env.OVERLAY_API_KEY || "").trim();
}

/**
 * Protects /api/* endpoints with X-Overlay-Key (or ?key=...)
 * If OVERLAY_API_KEY is unset, auth is disabled (dev/demo friendly).
 */
export function requireApiKeyForApiV1(req: Request, res: Response, next: NextFunction) {
  const key = getKey();
  if (!key) return next();

  const hdr = (req.header("x-overlay-key") || "").trim();
  const q = (typeof req.query.key === "string" ? req.query.key : "").trim();
  const got = hdr || q;

  if (got === key) return next();
  return res.status(401).json({ ok: false, error: "unauthorized" });
}

/**
 * Protects WebSocket "start" message by requiring apiKey in the payload.
 * If OVERLAY_API_KEY is unset, auth is disabled.
 */
export function checkApiKeyForWsStartV1(raw: any, ws: any): boolean {
  const key = getKey();
  if (!key) return true;

  const got = (raw?.apiKey ?? raw?.api_key ?? "").toString().trim();
  if (got === key) return true;

  try { ws.close(1008, "unauthorized"); } catch {}
  return false;
}
TS

########################################
# C) Patch server index.ts to:
#    - apply /api auth middleware
#    - enforce ws start auth
#    - apply off-topic bridging after engine builds a patch
########################################
python3 - <<'PY'
from pathlib import Path

p = Path("apps/server/src/index.ts")
txt = p.read_text()

# 1) Ensure imports
if 'from "./auth/api_key_v1"' not in txt:
    # insert near config import
    if 'from "./config"' in txt:
        txt = txt.replace(
            'from "./config";',
            'from "./config";\nimport { requireApiKeyForApiV1, checkApiKeyForWsStartV1 } from "./auth/api_key_v1";'
        )
    else:
        txt = 'import { requireApiKeyForApiV1, checkApiKeyForWsStartV1 } from "./auth/api_key_v1";\n' + txt

if 'offtopic_bridge_v1' not in txt:
    # insert near arbitration imports
    needle = 'from "./arbitration'
    idx = txt.find(needle)
    if idx != -1:
        # prepend an import near top (safe)
        lines = txt.splitlines()
        ins = 0
        for i,l in enumerate(lines):
            if l.startswith("import ") and "express" in l:
                ins = i
                break
        lines.insert(ins+1, 'import { maybeBuildOfftopicBridgePatchV1 } from "./arbitration/pro/offtopic_bridge_v1";')
        txt = "\n".join(lines)
    else:
        txt = 'import { maybeBuildOfftopicBridgePatchV1 } from "./arbitration/pro/offtopic_bridge_v1";\n' + txt

# 2) Add middleware after cors
if "requireApiKeyForApiV1" in txt and "app.use(\"/api\", requireApiKeyForApiV1" not in txt:
    if "app.use(cors" in txt:
        txt = txt.replace("app.use(cors", "app.use(cors")
        # insert after the cors line (find the first occurrence of that full line)
        lines = txt.splitlines()
        out=[]
        inserted=False
        for line in lines:
            out.append(line)
            if (not inserted) and "app.use(cors" in line:
                out.append('app.use("/api", requireApiKeyForApiV1);')
                inserted=True
        txt = "\n".join(out)

# 3) Enforce WS start auth
if "if (type === \"start\")" in txt and "checkApiKeyForWsStartV1" in txt and "checkApiKeyForWsStartV1(raw, ws)" not in txt:
    lines = txt.splitlines()
    out=[]
    inserted=False
    for i,line in enumerate(lines):
        out.append(line)
        if (not inserted) and 'if (type === "start")' in line:
            out.append("      if (!checkApiKeyForWsStartV1(raw, ws)) return;")
            inserted=True
    txt = "\n".join(out)

# 4) Apply off-topic bridging after buildCoachOverlayPatchV1 call
# Make built mutable: const -> let
txt = txt.replace("const built = await buildCoachOverlayPatchV1", "let built = await buildCoachOverlayPatchV1")

if "maybeBuildOfftopicBridgePatchV1" in txt and "offtopic_bridge_applied" not in txt and "buildCoachOverlayPatchV1({" in txt:
    lines = txt.splitlines()
    out=[]
    inserted=False
    for i,line in enumerate(lines):
        out.append(line)
        # Insert immediately after the buildCoachOverlayPatchV1(...) block finishes.
        # We detect the line that closes the call: "});" AFTER a line containing "buildCoachOverlayPatchV1({"
        if (not inserted) and line.strip() == "});":
            # Look back a bit to ensure we are in the correct block
            window = "\n".join(lines[max(0,i-12):i+1])
            if "buildCoachOverlayPatchV1({" in window:
                out.append("")
                out.append("  // Track last primary sales moment for off-topic bridges (integration/price/security/etc.)")
                out.append("  const m0 = (built as any)?.meta?.moment;")
                out.append("  if (m0 && m0 !== \"unknown\" && m0 !== \"offtopic\") (ctx.memory as any).lastPrimaryMoment = m0;")
                out.append("")
                out.append("  // Rare behavior: if the buyer drifts into small-talk/off-topic, acknowledge briefly then pivot back.")
                out.append("  const off = maybeBuildOfftopicBridgePatchV1({")
                out.append("    text,")
                out.append("    stage: (built as any)?.meta?.stage,")
                out.append("    moment: m0,")
                out.append("    memory: ctx.memory as any,")
                out.append("  });")
                out.append("  if (off) {")
                out.append("    built = { ...(built as any), suppressed: false, patch: off.patch, meta: off.meta, decision: { ...(built as any)?.decision, offtopic: off.note } };")
                out.append("    await emitLog({ tenantId: ctx.tenantId, repId: ctx.repId, session_id: ctx.sessionId, service: \"server\", eventType: \"offtopic_bridge_applied\", data: { category: off.note.category, anchorMoment: off.note.anchorMoment ?? null, offScore: off.note.offScore, salesScore: off.note.salesScore } });")
                out.append("  }")
                out.append("")
                inserted=True
    txt = "\n".join(out)

p.write_text(txt)
print("✅ Patched apps/server/src/index.ts (off-topic bridge + API auth)")
PY

########################################
# D) Patch web client to optionally send VITE_OVERLAY_API_KEY
########################################
python3 - <<'PY'
from pathlib import Path

# 1) apps/web/src/App.tsx
p = Path("apps/web/src/App.tsx")
if p.exists():
    txt = p.read_text()
    if "VITE_OVERLAY_API_KEY" not in txt:
        # add apiKey const inside App()
        if "export function App()" in txt and "const [tab," in txt:
            txt = txt.replace(
                "export function App() {",
                "export function App() {\n  const apiKey = (import.meta as any).env?.VITE_OVERLAY_API_KEY as string | undefined;"
            )

        # include apiKey in WS start payload
        txt = txt.replace(
            'ws.send(JSON.stringify({ type: "start", session_id: sessionId, tenantId, repId }));',
            'ws.send(JSON.stringify({ type: "start", session_id: sessionId, tenantId, repId, apiKey }));'
        )

        # include apiKey header in transcript_final fetch
        if 'fetch("http://localhost:8080/api/demo/transcript_final"' in txt and "x-overlay-key" not in txt:
            txt = txt.replace(
                'headers: { "Content-Type": "application/json" },',
                'headers: { "Content-Type": "application/json", ...(apiKey ? { "x-overlay-key": apiKey } : {}) },'
            )

    p.write_text(txt)
    print("✅ Patched apps/web/src/App.tsx (optional API key)")
else:
    print("ℹ️ apps/web/src/App.tsx not found; skipping")

# 2) apps/web/src/lib/api.ts (trust dashboard + ui events)
p = Path("apps/web/src/lib/api.ts")
if p.exists():
    txt = p.read_text()
    if "VITE_OVERLAY_API_KEY" not in txt:
        # add API_KEY constant at top
        lines = txt.splitlines()
        ins = 0
        for i,l in enumerate(lines):
            if l.startswith("export ") or l.startswith("async "):
                ins = i
                break
        lines.insert(ins, 'const API_KEY = (import.meta as any).env?.VITE_OVERLAY_API_KEY as string | undefined;')
        txt = "\n".join(lines)

    # patch headers patterns
    txt = txt.replace(
        'headers: { "Content-Type": "application/json" },',
        'headers: { "Content-Type": "application/json", ...(API_KEY ? { "x-overlay-key": API_KEY } : {}) },'
    )
    p.write_text(txt)
    print("✅ Patched apps/web/src/lib/api.ts (optional API key)")
else:
    print("ℹ️ apps/web/src/lib/api.ts not found; skipping")
PY

########################################
# E) Update .env.example to document API key support
########################################
python3 - <<'PY'
from pathlib import Path
p = Path(".env.example")
if not p.exists():
    print("ℹ️ .env.example not found; skipping")
    raise SystemExit(0)

txt = p.read_text().splitlines()
out=[]
seen_server=False
seen_vite=False
for line in txt:
    out.append(line)
    if line.startswith("OVERLAY_API_KEY="): seen_server=True
    if line.startswith("VITE_OVERLAY_API_KEY="): seen_vite=True

if not seen_server:
    out.append("")
    out.append("# Optional: Protect server endpoints + WS start with a shared key")
    out.append("OVERLAY_API_KEY=")

if not seen_vite:
    out.append("# Optional: Web client passes the same key in WS start + API calls")
    out.append("VITE_OVERLAY_API_KEY=")

p.write_text("\n".join(out) + "\n")
print("✅ Updated .env.example (API key vars)")
PY

echo
echo "[patch] Done. Next:"
echo "  1) pnpm -C apps/server run build"
echo "  2) pnpm -C apps/web run build"
echo "  3) pnpm dev"
echo
