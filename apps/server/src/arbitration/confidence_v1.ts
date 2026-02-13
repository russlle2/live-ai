import type { ConfidenceBand, GuidanceControls } from "@overlay-assistant/shared";

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

export function transcriptQualityScore(t: string, domainKeywords: string[]): number {
  const words = t.trim().split(/\s+/).filter(Boolean).length;
  const hasPunct = /[.?!,]/.test(t);
  const hasDomain = domainKeywords.some((k) => t.toLowerCase().includes(k.toLowerCase()));
  const wScore = clamp01((words - 3) / 12);
  return clamp01(0.25 + 0.35 * wScore + 0.2 * (hasPunct ? 1 : 0) + 0.2 * (hasDomain ? 1 : 0));
}

export function confidenceBand(confidence: number): ConfidenceBand {
  if (confidence >= 0.75) return "high";
  if (confidence >= 0.55) return "medium";
  return "low";
}

export function shouldEmitLowConfidence(controls: GuidanceControls, confidence: number): boolean {
  return controls.showLowConfidence && confidence >= 0.35;
}
