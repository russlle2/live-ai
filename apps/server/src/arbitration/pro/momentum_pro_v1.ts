import type { MomentumV1, SalesStageV1 } from "./types_pro_v1";
import type { ObjectionStackV1 } from "./types_pro_v1";

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

function stageIndex(s: SalesStageV1): number {
  return s === "discovery" ? 0 : s === "evaluation" ? 1 : s === "decision" ? 2 : 3;
}

const STAGE_SIGNALS: Record<SalesStageV1, RegExp[]> = {
  discovery: [
    /\b(trying to|use case|goal|problem|why|how does)\b/i,
    /\b(help me understand|walk me through)\b/i
  ],
  evaluation: [
    /\b(compared|compare|evaluating|shortlist|criteria|requirements)\b/i,
    /\b(integration depth|security review|demo|trial|pilot)\b/i
  ],
  decision: [
    /\b(procurement|legal|contract|msa|sow|po)\b/i,
    /\b(sign[- ]?off|approve|budget|pricing|discount)\b/i
  ],
  closing: [
    /\b(next steps|send (the )?(agreement|paperwork)|kickoff|onboarding)\b/i,
    /\b(go live|rollout|start date)\b/i
  ]
};

const POSITIVE = [
  /\b(next steps|let's do|schedule|book|kickoff|pilot|trial)\b/i,
  /\b(we need this|we want this|this would help|makes sense)\b/i,
  /\b(timeline|deadline|by (today|tomorrow|this week|next week))\b/i
];

const NEGATIVE = [
  /\b(expensive|pricey|overpriced)\b/i,
  /\b(not sure|skeptical|concerned|worried|risk)\b/i,
  /\b(not now|later|next quarter)\b/i,
  /\b(doesn't make sense|confusing|random|off topic)\b/i
];

export function inferStageV1(tNorm: string, prev: SalesStageV1): { stage: SalesStageV1; changed: boolean; reasons: string[] } {
  const scores: Record<SalesStageV1, number> = { discovery: 0, evaluation: 0, decision: 0, closing: 0 };
  const reasons: string[] = [];

  for (const s of Object.keys(STAGE_SIGNALS) as SalesStageV1[]) {
    for (const re of STAGE_SIGNALS[s]) {
      if (re.test(tNorm)) {
        scores[s] += 1;
        reasons.push(`stage:${s}`);
      }
    }
  }

  // inertia: don't bounce backwards unless strong
  scores[prev] += 0.75;

  // choose best
  let best: SalesStageV1 = prev;
  let bestScore = -1;
  for (const s of Object.keys(scores) as SalesStageV1[]) {
    if (scores[s] > bestScore) { bestScore = scores[s]; best = s; }
  }

  // monotonic-ish: if best is behind prev by 2+ stages, keep prev
  if (stageIndex(best) + 1 < stageIndex(prev)) best = prev;

  return { stage: best, changed: best !== prev, reasons };
}

export function updateMomentumV1(memory: any, tNorm: string, stage: SalesStageV1, objections: ObjectionStackV1): MomentumV1 {
  if (!memory.pro) memory.pro = {};
  const prev = typeof memory.pro.momentumScore === "number" ? memory.pro.momentumScore : 52;

  let score = prev;

  const posHits = POSITIVE.reduce((n, re) => n + (re.test(tNorm) ? 1 : 0), 0);
  const negHits = NEGATIVE.reduce((n, re) => n + (re.test(tNorm) ? 1 : 0), 0);

  // objections slightly reduce momentum if multiple unresolved
  const unresolved = (objections?.top?.length ?? 0);
  score += 4 * posHits;
  score -= 4 * negHits;
  score -= unresolved >= 2 ? 4 : unresolved === 1 ? 1 : 0;

  // stage progression is good
  const prevStage: SalesStageV1 = memory.pro.stage ?? "discovery";
  if (stageIndex(stage) > stageIndex(prevStage)) score += 8;

  score = clamp(score, 0, 100);

  const delta = clamp(score - prev, -25, 25);

  const level: MomentumV1["level"] = score >= 70 ? "high" : score >= 45 ? "medium" : "low";
  const rationale: string[] = [];
  if (posHits) rationale.push(`pos:${posHits}`);
  if (negHits) rationale.push(`neg:${negHits}`);
  if (unresolved) rationale.push(`unresolved:${unresolved}`);
  if (stageIndex(stage) > stageIndex(prevStage)) rationale.push("stage_advanced");

  memory.pro.stage = stage;
  memory.pro.momentumScore = score;
  memory.pro.momentumDelta = delta;

  return { score, delta, level, rationale };
}
