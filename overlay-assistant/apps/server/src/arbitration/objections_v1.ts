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
  "too expensive", "can't", "won't", "need to", "must", "require", "risk",
  "hesitant", "unsure", "doubt", "afraid", "difficult", "complicated",
  "hard to", "not ready", "not confident", "skeptical", "don't think"
];

function frictionScore(tNorm: string): number {
  const hits = FRICTION.filter((s) => tNorm.includes(s)).length;
  return clamp01(0.15 * hits);
}

export function scoreObjections(tNorm: string): ObjectionScore[] {
  const f = frictionScore(tNorm);
  const out: ObjectionScore[] = [];

  // Pricing — lower threshold to catch subtle budget mentions
  if ((/budget|pricing|cost|price|expensive|afford|spend|investment/i.test(tNorm)) && (f >= 0.1 || /too expensive|over budget|can't afford/i.test(tNorm))) {
    out.push({ objection: "pricing", matchScore: clamp01(0.65 + f), reasons: ["They mentioned cost or budget concerns", `friction:${f.toFixed(2)}`] });
  }
  // Security
  if ((/security|compliance|soc ?2|hipaa|gdpr|data protection|encryption/i.test(tNorm)) && (f >= 0.1 || /soc ?2|hipaa|gdpr/i.test(tNorm))) {
    out.push({ objection: "security", matchScore: clamp01(0.65 + f), reasons: ["They brought up security or compliance", `friction:${f.toFixed(2)}`] });
  }
  // Competitor
  if ((/competitor|compare|vs\.?|already use|switch from|currently using|other option/i.test(tNorm)) && (f >= 0.1 || /already use|currently using/i.test(tNorm))) {
    out.push({ objection: "competitor", matchScore: clamp01(0.6 + f), reasons: ["They mentioned a competitor or existing tool", `friction:${f.toFixed(2)}`] });
  }
  // Timing
  if ((/timeline|later|next quarter|not now|timing|not the right time|too soon|not ready/i.test(tNorm)) && (f >= 0.1 || /not now|not ready|later/i.test(tNorm))) {
    out.push({ objection: "timing", matchScore: clamp01(0.55 + f), reasons: ["They said it's not the right time", `friction:${f.toFixed(2)}`] });
  }
  // Legal / procurement
  if ((/procurement|legal|security review|sign|approval|contract|purchasing/i.test(tNorm)) && (f >= 0.1 || /procurement|legal|approval/i.test(tNorm))) {
    out.push({ objection: "legal_procurement", matchScore: clamp01(0.55 + f), reasons: ["They mentioned legal or procurement steps", `friction:${f.toFixed(2)}`] });
  }

  return out.sort((a, b) => b.matchScore - a.matchScore);
}
