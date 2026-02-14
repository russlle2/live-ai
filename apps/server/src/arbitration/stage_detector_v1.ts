import type { SessionMemoryV1, CallStage } from "./session_memory_v1";

const RX = {
  evaluation: [
    /\bevaluat(e|ing|ion)\b/i,
    /\bcompare(d|ing)?\b/i,
    /\bshortlist\b/i,
    /\bvendor\b/i,
    /\brequirements?\b/i,
    /\bintegration\b/i,
    /\bdoes it support\b/i,
  ],
  negotiation: [
    /\bdiscount\b/i,
    /\bpricing\b/i,
    /\bcontract\b/i,
    /\bterms?\b/i,
    /\bbudget\b/i,
    /\bquote\b/i,
    /\bprocurement\b/i,
  ],
  closing: [
    /\bnext steps\b/i,
    /\bmove forward\b/i,
    /\bstart\b/i,
    /\bkickoff\b/i,
    /\bpaperwork\b/i,
    /\bsend (over|it)\b/i,
    /\bwho signs\b/i,
  ]
};

function matches(text: string, list: RegExp[]) {
  return list.some((r) => r.test(text));
}

/**
 * inferStageV1
 * Stage transitions are "sticky" (they should not bounce backwards easily).
 */
export function inferStageV1(text: string, memory: SessionMemoryV1): CallStage {
  const t = text;

  // Highest priority: closing signals
  if (matches(t, RX.closing)) return "closing";

  // Negotiation
  if (matches(t, RX.negotiation)) return "negotiation";

  // Evaluation
  if (matches(t, RX.evaluation)) {
    // Don’t regress from negotiation/closing
    if (memory.stage === "negotiation" || memory.stage === "closing") return memory.stage;
    return "evaluation";
  }

  return memory.stage;
}
