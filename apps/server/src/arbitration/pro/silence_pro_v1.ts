import type { GuidanceControls } from "@overlay-assistant/shared";
import type { SilenceCueV1 } from "./types_pro_v1";

export function isDirectQuestionV1(text: string): boolean {
  const t = (text || "").trim();
  if (!t) return false;
  if (t.endsWith("?")) return true;
  return /\b(can you|could you|how do|what is|what are|tell me|walk me through|why)\b/i.test(t);
}

/**
 * Silence engine — sales meaning:
 * - Ask a clean question
 * - Then STOP talking (hold space) so the prospect fills the gap with truth
 */
export function computeSilenceCueV1(suggestedLine: string): SilenceCueV1 | null {
  const s = (suggestedLine || "").trim();
  if (!s) return null;
  if (/\?\s*(\)|$)/.test(s) || s.endsWith("?")) {
    return { type: "pause_after_question", seconds: 3, reason: "question_then_pause" };
  }
  if (/\b(let me think|hmm|not sure)\b/i.test(s)) {
    return { type: "hold_space", seconds: 4, reason: "give_them_space" };
  }
  return null;
}

function minIntervalMs(depth: GuidanceControls["aiDepth"]): number {
  // less spam at P0; more responsive at P2+
  if (depth === "P2") return 1500;
  if (depth === "P1") return 2500;
  return 4000;
}

/**
 * Output gate (NOT the same as silence coaching).
 * This prevents “same suggestion every turn” spam.
 */
export function shouldSuppressOutputV1(args: {
  controls: GuidanceControls;
  memory: any;
  now: number;
  suggestionHash: string;
  confidenceBand: "low" | "medium" | "high";
  hasNewSignal: boolean;
}): { suppress: boolean; reason: string } {
  const { controls, memory, now, suggestionHash, confidenceBand, hasNewSignal } = args;

  if (controls.guidanceMuted || controls.guidanceMode === "off") return { suppress: true, reason: "muted_or_off" };

  // separate from server throttle (server uses memory.lastSuggestionAt for debouncing)
  if (!memory.pro) memory.pro = {};
  const lastOutAt = typeof memory.pro.lastOutAt === "number" ? memory.pro.lastOutAt : 0;
  const lastHash = typeof memory.pro.lastSuggestionHash === "string" ? memory.pro.lastSuggestionHash : "";

  const interval = minIntervalMs(controls.aiDepth);
  if (lastOutAt && now - lastOutAt < interval && !hasNewSignal) {
    return { suppress: true, reason: "throttled" };
  }

  // duplicate within 20s AND no new signal
  if (lastHash && lastHash === suggestionHash && (now - lastOutAt) < 20_000 && !hasNewSignal) {
    return { suppress: true, reason: "duplicate" };
  }

  // if low confidence and user does NOT want low-confidence suggestions, suppress
  if (confidenceBand === "low" && !controls.showLowConfidence) {
    return { suppress: true, reason: "low_confidence_hidden" };
  }

  return { suppress: false, reason: "emit" };
}

export function markOutputEmittedV1(memory: any, now: number, suggestionHash: string): void {
  if (!memory.pro) memory.pro = {};
  memory.pro.lastOutAt = now;
  memory.pro.lastSuggestionHash = suggestionHash;
}
