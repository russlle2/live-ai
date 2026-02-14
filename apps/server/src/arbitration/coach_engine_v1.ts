import crypto from "crypto";
import type { GuidanceItemV1 } from "@overlay-assistant/shared";
import type { SessionMemoryV1 } from "./session_memory_v1";
import { createSessionMemory, updateTranscript } from "./session_memory_v1";
import { inferStageV1 } from "./stage_detector_v1";
import { detectMomentV1 } from "./moment_detector_v1";
import { pickPlaybookV1 } from "./playbooks_v1";
import { pickMicroGoalV1 } from "./micro_goals_v1";
import { detectLanguageV1 } from "./language_v1";
import { loadProductPackV1 } from "../product_pack/product_pack_v1";
import { loadFactsV1, retrieveFactsV1 } from "../product_pack/retriever_v1";
import { maybeRefineSuggestionV1 } from "../llm/http_json_provider_v1";

export type CoachDecisionMetaV1 = {
  stage: string;
  moment: string;
  microGoal: string;
  hits: string[];
  activeMoments: string[];
  language: string;
  usedProductPack: boolean;
  usedFactsCount: number;
  usedLLM: boolean;
  confidence: number;
  confidenceBand: "low" | "medium" | "high";
};

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

function band(conf: number): "low" | "medium" | "high" {
  if (conf >= 0.8) return "high";
  if (conf >= 0.55) return "medium";
  return "low";
}

function makeId(prefix: string) {
  return `${prefix}_${crypto.randomBytes(6).toString("hex")}`;
}

export type BuildCoachArgsV1 = {
  tenantId: string;
  repId: string;
  sessionId: string;
  controls: any;
  memory?: SessionMemoryV1;
  text: string;
};

export type BuildCoachResultV1 =
  | { suppressed: true; meta: CoachDecisionMetaV1 }
  | { suppressed: false; rawPatch: any; item: GuidanceItemV1; meta: CoachDecisionMetaV1 };

export async function buildCoachOverlayPatchV1(args: BuildCoachArgsV1): Promise<BuildCoachResultV1> {
  const memory = args.memory ?? createSessionMemory();
  const controls = args.controls ?? {};

  updateTranscript(memory, args.text);
  memory.stage = inferStageV1(args.text, memory);

  const moment = detectMomentV1(args.text, memory);
  const mg = pickMicroGoalV1(memory.stage, moment.primary, memory);
  const language = detectLanguageV1(args.text);

  const pack = loadProductPackV1(args.tenantId);
  const factsAll = loadFactsV1(args.tenantId);
  const factsUsed = retrieveFactsV1(args.text, factsAll, 4);

  // Base deterministic playbook
  let sug = pickPlaybookV1(moment.primary, memory);

  // Safe deterministic nudge using pack (no invented claims)
  const productName = pack?.productName;
  if (productName && (moment.primary === "value" || moment.primary === "price")) {
    const d = pack?.differentiators?.filter(Boolean) ?? [];
    if (d.length) {
      sug = {
        ...sug,
        followUp: `${sug.followUp} (Context: teams choose ${productName} for: ${d[0].slice(0, 120)})`,
      };
    }
  }

  const aiDepth = String(controls.aiDepth ?? "P0");
  const llmEnabled = Boolean((process.env.LLM_ENDPOINT_URL ?? "").trim());
  let usedLLM = false;

  // Optional LLM refine/translate
  if (aiDepth !== "P0" && llmEnabled) {
    const refined = await maybeRefineSuggestionV1({
      language,
      stage: memory.stage,
      moment: moment.primary,
      microGoal: mg.microGoal,
      transcriptSnippet: memory.transcriptWindow.slice(-6).join("\n"),
      baseSuggestion: sug,
      productFacts: {
        productName: pack?.productName,
        oneLiner: pack?.oneLiner,
        differentiators: pack?.differentiators,
        proofPoints: pack?.proofPoints,
        integrations: pack?.integrations,
        compliance: pack?.compliance,
        allowedClaims: pack?.allowedClaims,
        forbiddenClaims: pack?.forbiddenClaims,
        retrievedFacts: factsUsed.map((f) => ({ id: f.id, text: f.text })),
      },
    });

    if (refined) {
      usedLLM = true;
      sug = {
        title: (refined.title ?? sug.title).slice(0, 80),
        line: refined.line.slice(0, 260),
        followUp: refined.followUp.slice(0, 260),
        ifPushed: refined.ifPushed.slice(0, 280),
      };
    }
  }

  // Confidence
  let confidence = moment.confidence;
  if (pack) confidence += 0.05;
  if (factsUsed.length) confidence += 0.05;
  if (usedLLM) confidence += 0.05;
  if (moment.primary === "integration" && memory.stage === "evaluation") confidence += 0.08;
  confidence = clamp(confidence, 0, 1);

  const confidenceBand = band(confidence);
  const showLow = Boolean(controls.showLowConfidence);
  const muted = Boolean(controls.guidanceMuted);

  const meta: CoachDecisionMetaV1 = {
    stage: memory.stage,
    moment: moment.primary,
    microGoal: mg.microGoal,
    hits: moment.hits,
    activeMoments: Array.from(memory.activeMoments),
    language,
    usedProductPack: Boolean(pack),
    usedFactsCount: factsUsed.length,
    usedLLM,
    confidence,
    confidenceBand,
  };

  // Adaptive frequency: speak only when it adds value
  const directQuestion = /\?\s*$/.test(args.text.trim()) || /\bwhat\b|\bwhy\b|\bhow\b/i.test(args.text);
  const decisionMoment = meta.stage === "negotiation" || meta.stage === "closing";
  const shouldSpeak = directQuestion || decisionMoment || meta.confidenceBand !== "low";

  if (muted) return { suppressed: true, meta };
  if (!shouldSpeak) return { suppressed: true, meta };
  if (confidenceBand === "low" && !showLow) return { suppressed: true, meta };

  const item: GuidanceItemV1 = {
    id: makeId("g"),
    createdAt: new Date().toISOString(),
    title: sug.title,
    category: `${meta.stage}/${meta.moment}/${meta.microGoal}`,
    text: sug.line,
    confidence,
    confidenceBand,
    explanation: {
      schema: "explanation_v1",
      reasons: [mg.rationale],
      followUp: sug.followUp,
      ifPushed: sug.ifPushed,
      meta,
      factsUsed,
      productName: pack?.productName,
      oneLiner: pack?.oneLiner,
    } as any,
  };

  const rawPatch = { guidance: { items: [item] }, text: item.text };
  return { suppressed: false, rawPatch, item, meta };
}
