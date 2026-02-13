import crypto from "crypto";
import type { GuidanceControls, GuidanceItemV1 } from "@overlay-assistant/shared";
import { scoreIntents } from "./intents_v1";
import { scoreObjections } from "./objections_v1";
import { TEMPLATE_RULES, templateToGuidanceItem } from "./templates_v1";
import { confidenceBand, transcriptQualityScore, shouldEmitLowConfidence } from "./confidence_v1";

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

export type ArbitrationInput = {
  text: string;
  controls: GuidanceControls;
  domainKeywords: string[];
};

export type ArbitrationDecision = {
  items: GuidanceItemV1[];
  trace: {
    transcriptHash: string;
    transcriptLen: number;
    topIntent?: string;
    topObjection?: string;
  };
};

export function sha256Hex(s: string): string {
  return crypto.createHash("sha256").update(s).digest("hex");
}

export function arbitrateV1(input: ArbitrationInput): ArbitrationDecision {
  const t = input.text ?? "";
  const tNorm = t.toLowerCase();
  const transcriptHash = sha256Hex(tNorm);
  const transcriptLen = t.length;

  const intents = scoreIntents(tNorm);
  const objections = scoreObjections(tNorm);
  const topIntent = intents[0]?.intent;
  const topObjection = objections[0]?.objection;

  const key = topObjection ? `objection:${topObjection}` : topIntent ? `intent:${topIntent}` : undefined;

  let rule = key ? TEMPLATE_RULES.find((r) => r.category === key) : undefined;
  if (!rule) rule = TEMPLATE_RULES.find((r) => r.id === "decision_1");

  const tq = transcriptQualityScore(t, input.domainKeywords);
  const matchScore = clamp01(objections[0]?.matchScore ?? intents[0]?.matchScore ?? 0.5);
  const confidence = clamp01(0.55 * matchScore + 0.35 * tq + 0.1 * 1.0);
  const band = confidenceBand(confidence);

  const controls = input.controls;
  const emit = band !== "low" ? confidence >= 0.55 : shouldEmitLowConfidence(controls, confidence);

  const items = emit && !controls.guidanceMuted && controls.guidanceMode !== "off"
    ? [templateToGuidanceItem(rule!, confidence, band)]
    : [];

  return { items, trace: { transcriptHash, transcriptLen, topIntent, topObjection } };
}
