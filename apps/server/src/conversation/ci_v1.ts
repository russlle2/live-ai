export type ConversationEntityV1 = {
  type: "name" | "product" | "price" | "objection_type" | "urgency";
  value: string;
  confidence: number;
};

export type ConversationMomentV1 = "objection" | "hesitation" | "buying_signal" | "neutral";

export type ComplianceRiskV1 = {
  type: "illegal" | "sensitive" | "coercive";
  phrase: string;
  severity: "low" | "medium" | "high";
};

const PRODUCT_WORDS = ["overlay", "assistant", "crm", "salesforce", "hubspot", "zoom", "google workspace", "google meet", "sso"];

const OBJECTION_MAP: Array<{ key: string; rx: RegExp }> = [
  { key: "price", rx: /\b(expensive|cost|pricing|budget|too much)\b/i },
  { key: "security", rx: /\b(security|soc2|compliance|risk|privacy)\b/i },
  { key: "integration", rx: /\b(integration|api|sync|sso|crm)\b/i },
  { key: "competitor", rx: /\b(competitor|already use|alternative|switch)\b/i }
];

const URGENCY_WORDS = ["today", "asap", "this week", "urgent", "deadline", "quarter end", "eow"];

const ILLEGAL_RISK = [/\b(bribe|kickback|fraud|fake invoice|money laundering)\b/i];
const SENSITIVE_RISK = [/\b(ssn|social security|credit card|card number|passport|dob|medical record)\b/i];
const COERCIVE_RISK = [/\b(force them|pressure them|they have no choice|hide the terms|don'?t tell legal)\b/i];

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function detectName(text: string): ConversationEntityV1 | null {
  const m = text.match(/\b(?:i\s*am|i'm|this is)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\b/);
  if (!m) return null;
  return { type: "name", value: m[1], confidence: 0.62 };
}

function detectProducts(text: string): ConversationEntityV1[] {
  const lower = text.toLowerCase();
  return PRODUCT_WORDS.filter((p) => lower.includes(p)).map((p) => ({ type: "product", value: p, confidence: 0.58 }));
}

function detectPrice(text: string): ConversationEntityV1[] {
  const out: ConversationEntityV1[] = [];
  const m1 = text.match(/\$\s?([0-9][0-9,]*(?:\.[0-9]{1,2})?)/g) || [];
  for (const raw of m1) out.push({ type: "price", value: raw.replace(/\s+/g, ""), confidence: 0.7 });
  const m2 = text.match(/\b([0-9]{2,})(?:\s?)(usd|dollars?)\b/gi) || [];
  for (const raw of m2) out.push({ type: "price", value: raw, confidence: 0.64 });
  return out;
}

function detectObjectionType(text: string): ConversationEntityV1[] {
  const out: ConversationEntityV1[] = [];
  for (const o of OBJECTION_MAP) {
    if (o.rx.test(text)) out.push({ type: "objection_type", value: o.key, confidence: 0.67 });
  }
  return out;
}

function detectUrgency(text: string): ConversationEntityV1[] {
  const lower = text.toLowerCase();
  return URGENCY_WORDS.filter((w) => lower.includes(w)).map((w) => ({ type: "urgency", value: w, confidence: 0.66 }));
}

function detectMoment(text: string): ConversationMomentV1 {
  if (/\b(not sure|maybe|we need to think|later|unclear|hesitant|concerned)\b/i.test(text)) return "hesitation";
  if (/\b(yes|let'?s do it|send contract|move forward|approved|next step)\b/i.test(text)) return "buying_signal";
  if (OBJECTION_MAP.some((o) => o.rx.test(text))) return "objection";
  return "neutral";
}

function risksFor(text: string, patterns: RegExp[], type: ComplianceRiskV1["type"]): ComplianceRiskV1[] {
  const out: ComplianceRiskV1[] = [];
  for (const rx of patterns) {
    const m = text.match(rx);
    if (!m) continue;
    out.push({ type, phrase: m[0], severity: type === "illegal" ? "high" : type === "sensitive" ? "medium" : "high" });
  }
  return out;
}

export function analyzeConversationV1(text: string): {
  entities: ConversationEntityV1[];
  moments: ConversationMomentV1[];
  complianceRisks: ComplianceRiskV1[];
  confidence: number;
} {
  const entities: ConversationEntityV1[] = [];
  const name = detectName(text);
  if (name) entities.push(name);
  entities.push(...detectProducts(text));
  entities.push(...detectPrice(text));
  entities.push(...detectObjectionType(text));
  entities.push(...detectUrgency(text));

  const moment = detectMoment(text);
  const complianceRisks = [
    ...risksFor(text, ILLEGAL_RISK, "illegal"),
    ...risksFor(text, SENSITIVE_RISK, "sensitive"),
    ...risksFor(text, COERCIVE_RISK, "coercive")
  ];

  const confidence = clamp01(0.35 + entities.length * 0.06 + (moment !== "neutral" ? 0.12 : 0) + (complianceRisks.length ? 0.09 : 0));

  return {
    entities,
    moments: [moment],
    complianceRisks,
    confidence
  };
}
