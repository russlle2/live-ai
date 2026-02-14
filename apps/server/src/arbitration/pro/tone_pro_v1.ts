import type { ToneIdV1, ToneProfileV1, SalesStageV1 } from "./types_pro_v1";

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

const TONE_RX: Record<ToneIdV1, Array<{ id: string; re: RegExp; w: number }>> = {
  technical: [
    { id: "tech:stack", re: /\b(api|webhook|sso|oauth|scim|latency|throughput|schema|architecture|data warehouse|snowflake|bigquery)\b/i, w: 0.55 },
    { id: "tech:sec", re: /\b(encryption|audit logs?|access control|soc ?2|iso)\b/i, w: 0.45 }
  ],
  executive: [
    { id: "exec:roi", re: /\b(roi|outcome|impact|kpi|cost control|strategy)\b/i, w: 0.55 },
    { id: "exec:timeline", re: /\b(30[- ]?60 days?|quarter|q[1-4])\b/i, w: 0.35 }
  ],
  urgent: [
    { id: "urg:asap", re: /\b(asap|urgent|today|tomorrow|this week)\b/i, w: 0.60 },
    { id: "urg:deadline", re: /\b(deadline|by end of)\b/i, w: 0.40 }
  ],
  frustrated: [
    { id: "frus:anger", re: /\b(this is ridiculous|wasting time|annoying|frustrating)\b/i, w: 0.60 },
    { id: "frus:caps", re: /\b[A-Z]{5,}\b/, w: 0.35 }
  ],
  skeptical: [
    { id: "skep:why", re: /\b(why|prove|not convinced|sounds like|too good to be true)\b/i, w: 0.55 },
    { id: "skep:compare", re: /\b(compared|compare|other vendors?|alternative)\b/i, w: 0.35 }
  ],
  friendly: [
    { id: "fr:thanks", re: /\b(thanks|appreciate|excited|love)\b/i, w: 0.55 }
  ],
  playful: [
    { id: "play:lol", re: /\b(lol|haha|lmao)\b/i, w: 0.70 }
  ],
  neutral: [
    { id: "neu:default", re: /[\s\S]/, w: 0.01 }
  ]
};

function styleFor(t: ToneIdV1, stage: SalesStageV1): ToneProfileV1["style"] {
  if (t === "executive") return { brevity: "short", warmth: "neutral", directness: "direct" };
  if (t === "urgent") return { brevity: "short", warmth: "neutral", directness: "direct" };
  if (t === "technical") return { brevity: stage === "discovery" ? "normal" : "normal", warmth: "neutral", directness: "neutral" };
  if (t === "frustrated") return { brevity: "short", warmth: "high", directness: "soft" };
  if (t === "skeptical") return { brevity: "normal", warmth: "neutral", directness: "neutral" };
  if (t === "friendly") return { brevity: "normal", warmth: "high", directness: "neutral" };
  if (t === "playful") return { brevity: "normal", warmth: "high", directness: "neutral" };
  return { brevity: "normal", warmth: "neutral", directness: "neutral" };
}

export function inferToneProfileV1(text: string, stage: SalesStageV1): ToneProfileV1 {
  const notes: string[] = [];
  const scores: Record<ToneIdV1, number> = {
    neutral: 0,
    friendly: 0,
    skeptical: 0,
    technical: 0,
    executive: 0,
    urgent: 0,
    frustrated: 0,
    playful: 0
  };

  for (const tone of Object.keys(TONE_RX) as ToneIdV1[]) {
    for (const r of TONE_RX[tone]) {
      if (r.re.test(text)) {
        scores[tone] += r.w;
        notes.push(r.id);
      }
    }
  }

  let best: ToneIdV1 = "neutral";
  let bestScore = -1;
  for (const k of Object.keys(scores) as ToneIdV1[]) {
    if (scores[k] > bestScore) { bestScore = scores[k]; best = k; }
  }

  const confidence = clamp01(bestScore);
  return { id: best, confidence, notes, style: styleFor(best, stage) };
}

function hardTrim(s: string, maxChars: number): string {
  const t = (s || "").replace(/\s+/g, " ").trim();
  if (t.length <= maxChars) return t;
  return t.slice(0, maxChars - 1) + "…";
}

export function applyToneToLineV1(line: string, tone: ToneProfileV1): string {
  let out = line;

  // softeners / hardeners
  if (tone.id === "frustrated") {
    // de-escalate
    if (!/^I hear you|^Totally fair|^Fair/i.test(out)) out = `I hear you. ${out}`;
  }
  if (tone.id === "executive") {
    // compress & outcome focus
    out = out.replace(/\b(Totally—|Totally fair—|Honestly—|Sure—)\b/i, "").trim();
    out = hardTrim(out, 220);
  }
  if (tone.id === "technical") {
    // ensure specificity without adding product claims
    if (!/\b(read[- ]only|writeback|two[- ]way|audit|permissions)\b/i.test(out)) {
      out = `${out} (Is this read‑only or do you need writeback + audit logs?)`;
    }
  }
  if (tone.id === "skeptical") {
    // lean toward proof/validation
    if (!/\bprove|validate|verify|evidence\b/i.test(out)) {
      out = `${out} We can validate this with a quick yes/no checklist.`;
    }
  }
  if (tone.id === "urgent") {
    out = hardTrim(out, 200);
    if (!/\b(today|this week|right now|now\b/i.test(out)) {
      out = `${out} If we have 2 minutes now, we can confirm the must‑haves.`;
    }
  }

  // keep readable
  out = out.replace(/\s+\)/g, ")").replace(/\(\s+/g, "(").replace(/\s{2,}/g, " ").trim();
  return out;
}
