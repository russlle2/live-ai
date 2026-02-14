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
