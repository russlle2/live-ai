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
  return (s || "").replace(/\s+/g, " ").trim();
}

function hardTrim(s: string, maxChars: number) {
  const t = normalize(s);
  if (t.length <= maxChars) return t;
  return t.slice(0, Math.max(0, maxChars - 1)) + "…";
}

const OFFTRACK_TOPICS: { topic: OfftrackBridgeTopic; rx: RegExp; }[] = [
  { topic: "weather", rx: /\b(weather|forecast|rain|sunny|humidity|hurricane|snow|temperature|storm)\b/i },
  { topic: "sports",  rx: /\b(nfl|nba|mlb|nhl|soccer|football|basketball|playoffs|team|score|season)\b/i },
  { topic: "travel",  rx: /\b(travel|flight|hotel|vacation|trip|airport|beach|road\s*trip)\b/i },
  { topic: "food",    rx: /\b(food|restaurant|coffee|cafe|pizza|tacos|bbq|recipe|cooking)\b/i },
  { topic: "pets",    rx: /\b(dog|dogs|cat|cats|puppy|kitten|pet|pets)\b/i },
  { topic: "movies",  rx: /\b(movie|movies|tv|show|series|netflix|hbo|disney)\b/i },
  { topic: "music",   rx: /\b(music|song|songs|album|artist|concert)\b/i },
];

const SALES_ANCHOR_RX =
  /\b(price|pricing|cost|roi|value|budget|integration|api|webhook|sso|oauth|scim|crm|salesforce|hubspot|security|soc\s?2|compliance|deploy|deployment|timeline|decision|procurement|legal|contract|demo|pilot)\b/i;

const METAPHOR_RX =
  /\b(analogy|metaphor|compare\s+(it|this)\s+to|like\s+a|tell\s+me\s+how|explain\s+it\s+like|good\s+medium)\b/i;

function detectTopic(customerText: string): OfftrackBridgeTopic | null {
  for (const t of OFFTRACK_TOPICS) {
    if (t.rx.test(customerText)) return t.topic;
  }
  // fallback: very light "smalltalk"
  if (/\b(how\s+are\s+you|how\s+was\s+your\s+weekend|weekend|haha|lol)\b/i.test(customerText)) return "smalltalk";
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
