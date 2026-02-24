import crypto from "crypto";
import type { GuidanceControls, GuidanceItemV1 } from "@overlay-assistant/shared";

// IMPORTANT: we wrap the existing engine so you keep product packs + your current logic.
// The pro layer adds:
// - objection stacking
// - stage momentum
// - silence coaching
// - tone adaptation
import { buildCoachOverlayPatchV1 as baseBuild } from "./coach_engine_v1";

import { updateObjectionStackV1, objectionLabelV1 } from "./pro/objection_stack_pro_v1";
import { inferStageV1, updateMomentumV1 } from "./pro/momentum_pro_v1";
import { inferToneProfileV1, applyToneToLineV1 } from "./pro/tone_pro_v1";
import { computeSilenceCueV1, isDirectQuestionV1, markOutputEmittedV1, shouldSuppressOutputV1 } from "./pro/silence_pro_v1";
import type { ProMetaV1, SalesStageV1 } from "./pro/types_pro_v1";
import { applyOfftrackBridgeV1 } from "@overlay-assistant/shared";

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

function sha256Hex(s: string): string {
  return crypto.createHash("sha256").update(s).digest("hex");
}

function randId(prefix: string): string {
  return `${prefix}_${crypto.randomBytes(6).toString("hex")}`;
}

function safeString(x: unknown): string {
  return typeof x === "string" ? x : "";
}

function extractBaseMeta(built: any): any {
  return built?.meta
    ?? built?.decision?.meta
    ?? built?.patch?.guidance?.items?.[0]?.explanation?.meta
    ?? undefined;
}

function extractBaseLine(built: any): string {
  const p = built?.patch ?? built?.patchV1 ?? built?.overlayPatch ?? built?.patch_payload;
  const pText = p?.text;
  if (typeof pText === "string" && pText.trim()) return pText.trim();
  const itemText = p?.guidance?.items?.[0]?.text;
  if (typeof itemText === "string" && itemText.trim()) return itemText.trim();
  return "";
}

function fallbackLine(stage: SalesStageV1, tNorm: string): { line: string; followUp: string; ifPushed: string; rationale: string } {
  if (/\bprice|pricing|budget|expensive\b/i.test(tNorm)) {
    return {
      line: "Totally fair. Before I answer, what are you comparing us to—and what outcome matters most in the next 30–60 days (speed, reliability, compliance, or cost control)?",
      followUp: "If we scoped to the smallest plan that still hits the #1 outcome, would that make it workable?",
      ifPushed: "If price is the constraint, I’ll keep it simple: what’s the dollar range you’ve already set aside?",
      rationale: "fallback_price"
    };
  }
  if (/\b(integration|api|sso|crm)\b/i.test(tNorm)) {
    return {
      line: "Totally—when you say “integration depth,” which systems are must‑have (CRM, SSO, data warehouse), and what workflow do you need end‑to‑end?",
      followUp: "Is “deep” more about real‑time sync, writeback, permissions/audit logs, or reliability under load?",
      ifPushed: "If you share your stack, we can map requirements to a yes/no list and verify fast in a short technical follow‑up.",
      rationale: "fallback_integration"
    };
  }
  if (stage === "closing") {
    return {
      line: "Makes sense. To keep momentum: what would a good next step look like—quick validation call, pilot, or paperwork—so we’re moving forward today?",
      followUp: "Who else needs to be on that next step to avoid rework?",
      ifPushed: "If you give me the owner + deadline, I’ll propose a tight plan and we’ll execute.",
      rationale: "fallback_closing"
    };
  }
  return {
    line: "Can I ask one quick question so I don’t guess—what’s the main outcome you’re trying to achieve, and what’s the biggest risk you’re trying to avoid?",
    followUp: "If we nail those two, what would success look like by next week?",
    ifPushed: "If you tell me the #1 outcome, I’ll keep this short and specific.",
    rationale: "fallback_clarify"
  };
}

function buildStackedLine(stage: SalesStageV1, top2: Array<{ key: string }>): { preface: string; question: string } {
  const a = objectionLabelV1(top2[0].key as any);
  const b = objectionLabelV1(top2[1].key as any);

  if (stage === "decision" || stage === "closing") {
    return {
      preface: `Got it — it sounds like the two moving parts are ${a} and ${b}.`,
      question: "Which one is the blocker to moving forward this week?"
    };
  }

  return {
    preface: `Makes sense — I’m hearing two threads: ${a} and ${b}.`,
    question: "Which one matters most to solve first so I answer the right thing?"
  };
}

export async function buildCoachOverlayPatchV1(args: {
  tenantId: string;
  repId: string;
  sessionId: string;
  controls: GuidanceControls;
  memory: any;
  text: string;
  speaker?: "rep" | "customer" | "unknown";
}): Promise<{ suppressed: boolean; patch?: any; meta?: any; decision?: any }> {
  const { controls, memory } = args;
  const text = safeString(args.text);
  const tNorm = text.toLowerCase();
  const now = Date.now();
  const speaker = args.speaker ?? "unknown";

  // ── Rep spoke: brief assessment + ALWAYS generate next line to say ──────
  let repAssessmentNote: string | undefined;
  if (speaker === "rep") {
    const fb = buildRepFeedback(text, tNorm, memory, now);
    const fbMeta = fb.meta as any;
    const emoji = fbMeta?.assessment === "strong" ? "💪" : fbMeta?.assessment === "warning" ? "⚠️" : "👍";
    repAssessmentNote = `${emoji} ${(fb.patch?.text ?? "").replace(/^[💪👍⚠️💡]\s*/, "").slice(0, 100)}`;
    // DON'T return — fall through to generate next script for the rep to say
  }

  // 1) Run your existing engine (keeps product packs + your current intent logic)
  let built: any;
  try {
    built = await baseBuild(args as any);
  } catch (e: any) {
    built = { suppressed: false, patch: null, meta: { usedLLM: false, error: "base_engine_failed" }, decision: { error: String(e?.message ?? e) } };
  }

  const baseMeta = extractBaseMeta(built) ?? {};
  const baseLine = extractBaseLine(built);

  // 2) Pro signals
  const objections = updateObjectionStackV1(memory, text, now);
  const prevStage: SalesStageV1 = (memory?.pro?.stage ?? baseMeta?.stage ?? "discovery") as SalesStageV1;
  const stageInf = inferStageV1(tNorm, prevStage);
  const momentum = updateMomentumV1(memory, tNorm, stageInf.stage, objections);
  const tone = inferToneProfileV1(text, stageInf.stage);

  const directQ = isDirectQuestionV1(text);

  // 3) Compose a better line (objection stacking + stage momentum)
  let line = baseLine;
  let followUp = safeString(built?.patch?.guidance?.items?.[0]?.explanation?.followUp);
  let ifPushed = safeString(built?.patch?.guidance?.items?.[0]?.explanation?.ifPushed);
  let rationale = safeString(built?.patch?.guidance?.items?.[0]?.explanation?.rationale);

  if (!line) {
    const fb = fallbackLine(stageInf.stage, tNorm);
    line = fb.line;
    followUp = fb.followUp;
    ifPushed = fb.ifPushed;
    rationale = fb.rationale;
  }

  // Objection stacking: if 2+ strong objections, *start* by stacking them (prevents random advice)
  if (objections.top.length >= 2) {
    const stack = buildStackedLine(stageInf.stage, objections.top.slice(0, 2) as any);
    // Keep your base line as the second sentence if it’s relevant; otherwise just ask the stack question.
    line = `${stack.preface} ${stack.question}`;
    if (!followUp) followUp = "If we solve that first, what would “good enough” look like in your world?";
    if (!ifPushed) ifPushed = "If you tell me the blocker, I’ll give you a straight yes/no path to verify it.";
    if (!rationale) rationale = "objection_stacking";
  }

  // Stage momentum nudges (exact scripts, not coaching advice)
  if (stageInf.stage === "evaluation" && momentum.level !== "high" && !/\b(next step|schedule|book)\b/i.test(line)) {
    line = `${line} Want to do a quick 10-minute requirements map right now, or should we book it?`;
  }
  if (stageInf.stage === "decision" && !/\bwho\b/i.test(line)) {
    line = `${line} Besides you, who else needs to say yes for this to move forward?`;
  }
  if (stageInf.stage === "closing" && !/\bnext step\b/i.test(line)) {
    line = `${line} What is the cleanest next step to keep this moving today?`;
  }

  // 4) Tone adaptation (rewrite style, not facts)
  line = applyToneToLineV1(line, tone);

  // 5) Silence coaching cue (tell rep when to shut up)
  const silenceCue = computeSilenceCueV1(line);
  if (silenceCue?.type === "pause_after_question" && !/\bthen pause\b/i.test(line)) {
    // add a tiny cue without being awkward
    line = `${line} (then pause)`;
  }

  // 6) Confidence (use base if present, otherwise infer)
  const baseConf = typeof baseMeta?.confidence === "number" ? baseMeta.confidence : undefined;
  const conf = clamp01(
    baseConf ?? (
      0.40
      + 0.12 * (directQ ? 1 : 0)
      + 0.18 * Math.min(1, objections.top[0]?.score ?? 0)
      + 0.12 * (momentum.level === "high" ? 1 : momentum.level === "medium" ? 0.6 : 0.2)
    )
  );
  const confidenceBand: "low" | "medium" | "high" = conf >= 0.75 ? "high" : conf >= 0.55 ? "medium" : "low";

  // "new signal" = new objection or stage change or big momentum move
  const hasNewSignal =
    (objections.newKeys.length > 0)
    || stageInf.changed
    || Math.abs(momentum.delta) >= 8
    || directQ;

  const suggestionHash = sha256Hex(line);

  const gate = shouldSuppressOutputV1({
    controls,
    memory,
    now,
    suggestionHash,
    confidenceBand,
    hasNewSignal
  });

  // 7) Build GuidanceItem + patch (your sanitizer currently accepts {text, guidance})
  const meta: ProMetaV1 = {
    stage: stageInf.stage,
    momentum,
    objectionsTop: objections.top.map((o) => ({ key: o.key, score: o.score, count: o.count })),
    tone,
    suppressed: gate.suppress,
    suppressedReason: gate.reason
  };

  if (gate.suppress) {
    return {
      suppressed: true,
      meta: { ...(baseMeta ?? {}), ...meta }
    };
  }

  markOutputEmittedV1(memory, now, suggestionHash);

  const item: GuidanceItemV1 = {
    id: randId("g"),
    title: repAssessmentNote
      ? (objections.top[0]?.key ? `SAY THIS (${objectionLabelV1(objections.top[0].key)})` : "SAY THIS NEXT")
      : (objections.top[0]?.key ? `SAY THIS (${objectionLabelV1(objections.top[0].key)})` : "SAY THIS NOW"),
    category: `${meta.stage}/${baseMeta?.moment ?? "moment"}/${baseMeta?.microGoal ?? "micro_goal"}`,
    text: line,
    confidence: conf,
    confidenceBand,
    createdAt: new Date().toISOString(),
    explanation: {
      followUp: followUp || undefined,
      ifPushed: ifPushed || undefined,
      rationale: rationale || "pro_layer",
      silenceCue: silenceCue || undefined,
      repAssessmentNote: repAssessmentNote || undefined,
      meta: { ...(baseMeta ?? {}), ...meta }
    } as any
  };

  const patch = {
    text: line,
    guidance: { items: [item] }
  };

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


  return {
    suppressed: false,
    patch,
    meta: { ...(baseMeta ?? {}), ...meta },
    decision: built?.decision
  };
}

// ─── Rep Feedback Engine ─────────────────────────────────────────────────────
// When the REP speaks, evaluate what they said and provide live coaching feedback.

function buildRepFeedback(
  text: string,
  tNorm: string,
  memory: any,
  now: number
): { suppressed: boolean; patch?: any; meta?: any; decision?: any } {
  const wordCount = text.split(/\s+/).length;

  // Detect what the rep is doing
  let assessment: "strong" | "good" | "adjust" | "warning" = "good";
  let feedback = "";
  let tip = "";
  let category = "rep_feedback";

  // ── Check for strong patterns ──────────────────────────────────────
  if (/\b(great question|absolutely|totally understand|that(?:'s| is) a fair (?:point|concern))\b/i.test(tNorm)) {
    assessment = "strong";
    feedback = "Good acknowledgment — the customer feels heard.";
    tip = "Now follow up with a targeted question or value statement.";
    category = "rep_acknowledgment";
  } else if (/\b(what(?:'s| is) (?:the|your)|tell me about|how do you|walk me through)\b/i.test(tNorm)) {
    assessment = "strong";
    feedback = "Great — you're asking questions and driving discovery.";
    tip = "Listen to their answer carefully before pivoting to a solution.";
    category = "rep_discovery";
  } else if (/\b(roi|save you|reduce (?:cost|time)|increase (?:revenue|efficiency)|return on)\b/i.test(tNorm)) {
    assessment = "strong";
    feedback = "Good value framing — tie the ROI to their specific situation.";
    tip = "Ask: 'Does that match what you're seeing internally?'";
    category = "rep_value_prop";
  } else if (/\b(next step|follow[- ]?up|schedule|book|calendar|let(?:'s| us) (?:set|book|schedule))\b/i.test(tNorm)) {
    assessment = "strong";
    feedback = "Strong close attempt — you're driving toward commitment.";
    tip = "If they hesitate, ask what would make them comfortable moving forward.";
    category = "rep_close_attempt";
  }

  // ── Check for adjustable patterns ──────────────────────────────────
  if (!feedback) {
    if (/\b(we (?:offer|provide|have|can)|our (?:platform|product|solution|team))\b/i.test(tNorm) && wordCount > 40) {
      assessment = "adjust";
      feedback = "You're pitching, but it's getting long. Customers tune out after ~20 seconds.";
      tip = "Break it up: pause and ask 'Does that resonate with what you need?'";
      category = "rep_monologue";
    } else if (/\b(we (?:offer|provide|have|can)|our (?:platform|product|solution|team))\b/i.test(tNorm)) {
      assessment = "good";
      feedback = "Good — you're presenting your solution.";
      tip = "Tie it back to something the customer said earlier.";
      category = "rep_pitch";
    } else if (/\b(case study|customer(?:s)?(?:\s+(?:like|similar))|proof point|testimonial)\b/i.test(tNorm)) {
      assessment = "strong";
      feedback = "Social proof is powerful — nicely played.";
      tip = "Make it specific: mention the customer's industry if you can.";
      category = "rep_social_proof";
    } else if (/\b(free trial|pilot|poc|proof of concept|sandbox)\b/i.test(tNorm)) {
      assessment = "good";
      feedback = "Good offer — but make sure you've established value first.";
      tip = "Frame the trial around their #1 use case, not as a generic demo.";
      category = "rep_offer";
    }
  }

  // ── Warning patterns ───────────────────────────────────────────────
  if (!feedback) {
    if (/\b(honestly|to be honest|between us|off the record)\b/i.test(tNorm)) {
      assessment = "warning";
      feedback = "Careful — 'to be honest' can undermine trust. It implies you weren't being honest before.";
      tip = "Drop the qualifier and just state the fact directly.";
      category = "rep_trust_risk";
    } else if (/\b(i(?:'m| am) not sure|i don(?:'t| not) know|let me check|good question,? i)\b/i.test(tNorm)) {
      assessment = "adjust";
      feedback = "It's OK to not know — but frame it as action, not uncertainty.";
      tip = "Say: 'I want to give you the exact answer — I'll verify and follow up by [time].'";
      category = "rep_uncertainty";
    } else if (/\b(um+|uh+|like,?\s+like|you know|basically|sort of|kind of)\b/i.test(tNorm) && (tNorm.match(/\bum+|\buh+/gi) || []).length >= 2) {
      assessment = "adjust";
      feedback = "Multiple filler words detected. Take a breath — pausing shows confidence.";
      tip = "A 2-second silence is more powerful than 'um'.";
      category = "rep_filler_words";
    }
  }

  // ── Fallback ───────────────────────────────────────────────────────
  if (!feedback) {
    feedback = "You're speaking — the AI is listening and evaluating.";
    tip = "Keep it concise. The best reps speak less than 40% of the time.";
    category = "rep_general";
  }

  // ── Talk-ratio warning ─────────────────────────────────────────────
  const repWords = memory?.speakerStats?.rep?.words ?? 0;
  const custWords = memory?.speakerStats?.customer?.words ?? 0;
  if (repWords > 100 && custWords > 0 && repWords / (custWords || 1) > 2.5) {
    assessment = "warning";
    feedback = `Talk ratio alert: You've said ${repWords} words vs. the customer's ${custWords}. Ask a question to rebalance.`;
    tip = "Try: 'What's your take on that?' or 'How does that map to your situation?'";
    category = "rep_talk_ratio";
  }

  const assessmentEmoji = assessment === "strong" ? "💪" : assessment === "good" ? "👍" : assessment === "warning" ? "⚠️" : "💡";

  const item: GuidanceItemV1 = {
    id: randId("rf"),
    title: `${assessmentEmoji} ${assessment === "warning" ? "CAREFUL" : "KEEP GOING"}`,
    category: `rep_feedback/${category}`,
    text: `${feedback} → ${tip}`,
    confidence: assessment === "strong" ? 0.85 : assessment === "good" ? 0.7 : assessment === "warning" ? 0.9 : 0.6,
    confidenceBand: assessment === "warning" ? "high" : assessment === "strong" ? "high" : "medium",
    createdAt: new Date().toISOString(),
    explanation: {
      followUp: tip,
      rationale: category,
      meta: { speaker: "rep", assessment, category }
    } as any
  };

  const patch = {
    text: `${assessmentEmoji} ${feedback}`,
    guidance: { items: [item] }
  };

  return {
    suppressed: false,
    patch,
    meta: { speaker: "rep", assessment, category, stage: memory?.pro?.stage ?? "discovery" },
    decision: { type: "rep_feedback", assessment }
  };
}
