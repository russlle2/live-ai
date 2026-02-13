export type ObjectionId =
  | "pricing"
  | "security"
  | "competitor"
  | "timing"
  | "legal_procurement";

export type ObjectionScore = { objection: ObjectionId; matchScore: number; reasons: string[] };

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

const FRICTION = [
  "not sure", "concern", "worried", "issue", "problem", "doesn't work",
  "too expensive", "can't", "won't", "need to", "must", "require", "risk"
];

function frictionScore(tNorm: string): number {
  const hits = FRICTION.filter((s) => tNorm.includes(s)).length;
  return clamp01(0.2 * hits);
}

export function scoreObjections(tNorm: string): ObjectionScore[] {
  const f = frictionScore(tNorm);
  const out: ObjectionScore[] = [];

  if ((/budget|pricing|cost|price/i.test(tNorm)) && (f >= 0.2 || /too expensive/i.test(tNorm))) {
    out.push({ objection: "pricing", matchScore: clamp01(0.65 + f), reasons: ["rx:budget", `friction:${f}`] });
  }
  if ((/security|compliance|soc ?2|hipaa|gdpr/i.test(tNorm)) && (f >= 0.2 || /soc ?2|hipaa|gdpr/i.test(tNorm))) {
    out.push({ objection: "security", matchScore: clamp01(0.65 + f), reasons: ["rx:security", `friction:${f}`] });
  }
  if ((/competitor|compare|vs\.?|already use/i.test(tNorm)) && (f >= 0.2 || /already use/i.test(tNorm))) {
    out.push({ objection: "competitor", matchScore: clamp01(0.6 + f), reasons: ["rx:competitor", `friction:${f}`] });
  }
  if ((/timeline|later|next quarter|not now|timing/i.test(tNorm)) && f >= 0.2) {
    out.push({ objection: "timing", matchScore: clamp01(0.55 + f), reasons: ["rx:timing", `friction:${f}`] });
  }
  if ((/procurement|legal|security review|sign/i.test(tNorm)) && f >= 0.2) {
    out.push({ objection: "legal_procurement", matchScore: clamp01(0.55 + f), reasons: ["rx:legal", `friction:${f}`] });
  }

  return out.sort((a, b) => b.matchScore - a.matchScore);
}
