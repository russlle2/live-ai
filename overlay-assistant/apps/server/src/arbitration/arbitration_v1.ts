import crypto from "crypto";
import type { GuidanceControls, GuidanceItemV1 } from "@overlay-assistant/shared";
import { scoreIntents } from "./intents_v1.js";
import { scoreObjections } from "./objections_v1.js";
import { TEMPLATE_RULES, templateToGuidanceItem } from "./templates_v1.js";
import { confidenceBand, transcriptQualityScore, shouldEmitLowConfidence } from "./confidence_v1.js";

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

/* ── LRU cache for arbitration results ────────────────────────────── */
const CACHE_MAX = 512;
const arbitrationCache = new Map<string, { decision: ArbitrationDecision; ts: number }>();

function cacheKey(tNorm: string, controls: GuidanceControls): string {
  return `${tNorm}|${controls.guidanceMode}|${controls.guidanceMuted}|${controls.aiDepth}|${controls.showLowConfidence}`;
}

function pruneCache() {
  if (arbitrationCache.size <= CACHE_MAX) return;
  // evict oldest 25%
  const entries = [...arbitrationCache.entries()].sort((a, b) => a[1].ts - b[1].ts);
  const toRemove = Math.ceil(entries.length * 0.25);
  for (let i = 0; i < toRemove; i++) arbitrationCache.delete(entries[i][0]);
}

/* ── Deduplication: prevent duplicate in-flight arbitrations ──────── */
const inflightKeys = new Set<string>();

export type ArbitrationInput = {
  text: string;
  controls: GuidanceControls;
  domainKeywords: string[];
  speaker?: "rep" | "lead" | "unknown";
};

export type ArbitrationDecision = {
  items: GuidanceItemV1[];
  trace: {
    transcriptHash: string;
    transcriptLen: number;
    topIntent?: string;
    topObjection?: string;
    speaker?: string;
    cacheHit?: boolean;
    latencyMs?: number;
  };
};

export function sha256Hex(s: string): string {
  return crypto.createHash("sha256").update(s).digest("hex");
}

export function arbitrateV1(input: ArbitrationInput): ArbitrationDecision {
  const startMs = Date.now();
  const t = input.text ?? "";
  const tNorm = t.toLowerCase();
  const transcriptHash = sha256Hex(tNorm);
  const transcriptLen = t.length;
  const speaker = input.speaker ?? "unknown";

  // ── Cache lookup ──
  const ck = cacheKey(tNorm, input.controls);
  const cached = arbitrationCache.get(ck);
  if (cached && Date.now() - cached.ts < 30_000) {
    return {
      ...cached.decision,
      trace: { ...cached.decision.trace, cacheHit: true, latencyMs: Date.now() - startMs }
    };
  }

  // ── Dedup guard (skip if already in-flight for same key) ──
  if (inflightKeys.has(ck)) {
    return { items: [], trace: { transcriptHash, transcriptLen, speaker, cacheHit: false, latencyMs: Date.now() - startMs } };
  }
  inflightKeys.add(ck);

  try {
    const intents = scoreIntents(tNorm);
    const objections = scoreObjections(tNorm);
    const topIntent = intents[0]?.intent;
    const topObjection = objections[0]?.objection;

    const key = topObjection ? `objection:${topObjection}` : topIntent ? `intent:${topIntent}` : undefined;

    let rule = key ? TEMPLATE_RULES.find((r) => r.category === key) : undefined;
    if (!rule) {
      // Rotate through fallback templates to avoid repetition
      const fallbacks = TEMPLATE_RULES.filter((r) => r.category === "fallback");
      rule = fallbacks.length > 0
        ? fallbacks[Date.now() % fallbacks.length]
        : TEMPLATE_RULES.find((r) => r.id === "decision_1");
    }

    const tq = transcriptQualityScore(t, input.domainKeywords);
    const matchScore = clamp01(objections[0]?.matchScore ?? intents[0]?.matchScore ?? 0.5);
    const confidence = clamp01(0.55 * matchScore + 0.35 * tq + 0.1 * 1.0);
    const band = confidenceBand(confidence);

    const controls = input.controls;
    const emit = band !== "low" ? confidence >= 0.55 : shouldEmitLowConfidence(controls, confidence);

    const items = emit && !controls.guidanceMuted && controls.guidanceMode !== "off"
      ? [templateToGuidanceItem(rule!, confidence, band, speaker)]
      : [];

    const decision: ArbitrationDecision = {
      items,
      trace: { transcriptHash, transcriptLen, topIntent, topObjection, speaker, cacheHit: false, latencyMs: Date.now() - startMs }
    };

    // ── Store in cache ──
    arbitrationCache.set(ck, { decision, ts: Date.now() });
    pruneCache();

    return decision;
  } finally {
    inflightKeys.delete(ck);
  }
}
