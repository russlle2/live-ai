/**
 * speaker_diarization_v1.ts
 *
 * Multi-signal speaker diarization engine.
 * Determines who is speaking (rep vs customer) using:
 *
 * 1. Explicit client-provided speaker label (highest confidence)
 * 2. Device-based attribution (desktop host = rep, mobile viewer = customer)
 * 3. Energy-based voice profiling (track per-speaker energy fingerprints)
 * 4. Linguistic pattern analysis (product terms → rep, objections → customer)
 * 5. Turn-taking heuristic (conversation alternates speakers)
 * 6. Product-context awareness (user-provided product terms → rep vocal signature)
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export type SpeakerRole = "rep" | "customer" | "unknown";

export interface SpeakerTurn {
  speaker: SpeakerRole;
  text: string;
  confidence: number;
  at: string;
  signals: SpeakerSignal[];
}

export type SpeakerSignal =
  | { type: "explicit_label"; value: SpeakerRole; weight: number }
  | { type: "device_attribution"; value: SpeakerRole; weight: number; deviceType: string }
  | { type: "linguistic"; value: SpeakerRole; weight: number; patterns: string[] }
  | { type: "turn_taking"; value: SpeakerRole; weight: number }
  | { type: "energy_profile"; value: SpeakerRole; weight: number; energyDelta: number }
  | { type: "silence_gap"; value: "turn_change" | "same_speaker"; weight: number; gapMs: number }
  | { type: "product_context"; value: SpeakerRole; weight: number; matchedTerms: string[] };

export interface SpeakerProfile {
  avgEnergy: number;
  turnCount: number;
  totalWords: number;
  recentEnergies: number[];
  lastSpeakAt: number;
}

export interface DiarizationState {
  turns: SpeakerTurn[];
  lastSpeaker: SpeakerRole;
  lastSpeakAt: number;
  repProfile: SpeakerProfile;
  customerProfile: SpeakerProfile;
  /** Adaptive confidence threshold for unknown → guessed classification */
  adaptiveThreshold: number;
  /** Product/service terms the rep would use (from product context) */
  repVocabulary: Set<string>;
  /** Total classified turns */
  classifiedTurns: number;
  /** Consecutive same-speaker count (for detecting monologues vs dialogue) */
  consecutiveSame: number;
}

// ─── Constants ───────────────────────────────────────────────────────────────

/** Words overwhelmingly spoken by customers (buying signals, objections, questions about the product) */
const CUSTOMER_PATTERNS: Array<{ rx: RegExp; tag: string }> = [
  { rx: /\b(how much|what(?:'s| is) the (?:price|cost)|pricing|expensive|budget)\b/i, tag: "price_inquiry" },
  { rx: /\b(can you|could you|do you|does it|is (?:it|there)|will (?:it|you))\b/i, tag: "question_to_rep" },
  { rx: /\b(we(?:'re| are) (?:using|on)|currently (?:use|have)|our (?:current|existing))\b/i, tag: "existing_stack" },
  { rx: /\b(worried about|concerned about|not sure|hesitant|skeptical|risk)\b/i, tag: "concern" },
  { rx: /\b(competitor|alternative|already use|compared to|(?:what|how).+different)\b/i, tag: "competitive_compare" },
  { rx: /\b(let me (?:check|think|talk)|need to (?:discuss|run by|check)|my (?:boss|team|manager|cto|cfo))\b/i, tag: "stakeholder_defer" },
  { rx: /\b(tell me (?:more|about)|walk me through|explain|show me|demo)\b/i, tag: "info_request" },
  { rx: /\b(what(?:'s| is) (?:the|your) (?:timeline|next step))\b/i, tag: "process_question" },
  { rx: /\b(we need|we want|looking for|require|must have)\b/i, tag: "requirement_statement" },
  { rx: /\b(sounds (?:good|great|interesting)|that(?:'s| is) (?:good|great|helpful))\b/i, tag: "buying_signal" },
  { rx: /\b(no thanks|not (?:interested|right now)|pass|we(?:'ll| will) pass)\b/i, tag: "rejection_signal" },
];

/** Words overwhelmingly spoken by reps (pitching, handling objections, selling) */
const REP_PATTERNS: Array<{ rx: RegExp; tag: string }> = [
  { rx: /\b(we (?:offer|provide|have|can)|our (?:platform|product|solution|team|service))\b/i, tag: "pitch_language" },
  { rx: /\b(let me (?:show|explain|walk|pull up)|i(?:'ll| will) (?:send|share|show))\b/i, tag: "demo_language" },
  { rx: /\b(roi|return on investment|save you|reduce (?:cost|time)|increase (?:revenue|efficiency))\b/i, tag: "value_prop" },
  { rx: /\b(case study|customer(?:s)?(?:\s+(?:like|similar))|proof point|testimonial)\b/i, tag: "social_proof" },
  { rx: /\b(great question|absolutely|totally|that(?:'s| is) a (?:great|fair|good) (?:point|question))\b/i, tag: "rep_acknowledgment" },
  { rx: /\b(free trial|pilot|poc|proof of concept|sandbox|starter plan)\b/i, tag: "offer_language" },
  { rx: /\b(would it help if|what if (?:we|i)|here(?:'s| is) what i(?:'d| would) (?:suggest|recommend))\b/i, tag: "consultative_sell" },
  { rx: /\b(from what (?:you|i)(?:'ve| have) (?:told|shared|described|said))\b/i, tag: "summary_language" },
  { rx: /\b(next step|follow[- ]up|schedule|book|calendar)\b/i, tag: "close_language" },
  { rx: /\b(integration|api|sso|soc2|gdpr|uptime|sla)\b/i, tag: "technical_pitch" },
];

const SILENCE_GAP_THRESHOLD_MS = 2500; // >2.5s silence = likely speaker change

// ─── State factory ───────────────────────────────────────────────────────────

function newProfile(): SpeakerProfile {
  return { avgEnergy: 0, turnCount: 0, totalWords: 0, recentEnergies: [], lastSpeakAt: 0 };
}

export function createDiarizationState(): DiarizationState {
  return {
    turns: [],
    lastSpeaker: "unknown",
    lastSpeakAt: 0,
    repProfile: newProfile(),
    customerProfile: newProfile(),
    adaptiveThreshold: 0.55,
    repVocabulary: new Set(),
    classifiedTurns: 0,
    consecutiveSame: 0,
  };
}

// ─── Vocabulary injection from product context ───────────────────────────────

export function injectProductVocabulary(
  state: DiarizationState,
  productContext: {
    productName?: string;
    oneLiner?: string;
    valueProps?: string[];
    pricing?: string;
    competitors?: string;
    additionalNotes?: string;
  } | null | undefined
) {
  if (!productContext) return;

  const terms = new Set<string>();
  const extract = (s: string | undefined) => {
    if (!s) return;
    // extract 3+ char words
    const words = s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(w => w.length >= 3);
    for (const w of words) {
      // skip common words
      if (COMMON_WORDS.has(w)) continue;
      terms.add(w);
    }
  };

  extract(productContext.productName);
  extract(productContext.oneLiner);
  if (productContext.valueProps) productContext.valueProps.forEach(extract);
  extract(productContext.pricing);
  extract(productContext.additionalNotes);

  state.repVocabulary = terms;
}

const COMMON_WORDS = new Set([
  "the", "and", "for", "are", "but", "not", "you", "all", "can", "had", "her",
  "was", "one", "our", "out", "has", "his", "how", "its", "may", "new", "now",
  "old", "see", "way", "who", "did", "get", "let", "say", "she", "too", "use",
  "any", "each", "than", "that", "them", "then", "they", "this", "will", "with",
  "what", "when", "your", "from", "have", "more", "most", "some", "very", "just",
  "about", "also", "been", "more", "would", "could", "other", "their", "there",
  "these", "about", "which", "should", "where", "after", "before", "between",
]);

// ─── Core diarization ────────────────────────────────────────────────────────

export interface ClassifyInput {
  text: string;
  energy?: number;
  /** Explicit speaker label from the client ("rep" | "customer") */
  explicitSpeaker?: SpeakerRole;
  /** Device type of the device that captured this audio */
  deviceType?: string;
  /** Device role (host/controller/viewer) */
  deviceRole?: string;
  /** Timestamp epoch ms */
  timestamp?: number;
}

export interface ClassifyResult {
  speaker: SpeakerRole;
  confidence: number;
  signals: SpeakerSignal[];
  isNewTurn: boolean;
  /** What the rep should know about this utterance */
  coachingContext: {
    /** If customer spoke: what they're expressing */
    customerIntent?: string;
    /** If rep spoke: how well they did */
    repAssessment?: string;
  };
}

export function classifySpeaker(state: DiarizationState, input: ClassifyInput): ClassifyResult {
  const now = input.timestamp ?? Date.now();
  const text = input.text.trim();
  const tLower = text.toLowerCase();
  const wordCount = text.split(/\s+/).length;
  const signals: SpeakerSignal[] = [];

  // ─── Signal 1: Explicit label (weight: 1.0, definitive) ─────────────
  if (input.explicitSpeaker && input.explicitSpeaker !== "unknown") {
    signals.push({
      type: "explicit_label",
      value: input.explicitSpeaker,
      weight: 1.0,
    });
  }

  // ─── Signal 2: Device attribution (weight: 0.7) ─────────────────────
  if (input.deviceRole || input.deviceType) {
    const role = input.deviceRole;
    const dtype = input.deviceType;
    // Host device = rep
    if (role === "host") {
      signals.push({ type: "device_attribution", value: "rep", weight: 0.7, deviceType: dtype ?? "unknown" });
    }
    // Viewer = customer
    else if (role === "viewer") {
      signals.push({ type: "device_attribution", value: "customer", weight: 0.65, deviceType: dtype ?? "unknown" });
    }
    // Mobile controller could be either — lower weight
    else if (dtype === "mobile" && role === "controller") {
      signals.push({ type: "device_attribution", value: "customer", weight: 0.35, deviceType: dtype });
    }
  }

  // ─── Signal 3: Linguistic patterns (weight: 0.3-0.6 per match) ──────
  const customerMatches: string[] = [];
  const repMatches: string[] = [];

  for (const pat of CUSTOMER_PATTERNS) {
    if (pat.rx.test(tLower)) customerMatches.push(pat.tag);
  }
  for (const pat of REP_PATTERNS) {
    if (pat.rx.test(tLower)) repMatches.push(pat.tag);
  }

  // More matches = higher weight, capped
  if (customerMatches.length > 0) {
    const w = Math.min(0.6, 0.3 + customerMatches.length * 0.1);
    signals.push({ type: "linguistic", value: "customer", weight: w, patterns: customerMatches });
  }
  if (repMatches.length > 0) {
    const w = Math.min(0.6, 0.3 + repMatches.length * 0.1);
    signals.push({ type: "linguistic", value: "rep", weight: w, patterns: repMatches });
  }

  // ─── Signal 4: Product context vocabulary (weight: 0.4) ─────────────
  if (state.repVocabulary.size > 0) {
    const words = tLower.split(/\s+/);
    const matches = words.filter(w => state.repVocabulary.has(w));
    if (matches.length >= 2) {
      signals.push({
        type: "product_context",
        value: "rep",
        weight: Math.min(0.5, 0.25 + matches.length * 0.05),
        matchedTerms: matches.slice(0, 5),
      });
    }
  }

  // ─── Signal 5: Turn-taking (silence gap) ────────────────────────────
  if (state.lastSpeakAt > 0) {
    const gap = now - state.lastSpeakAt;
    if (gap >= SILENCE_GAP_THRESHOLD_MS) {
      // Long silence → likely speaker change
      const opposite: SpeakerRole = state.lastSpeaker === "rep" ? "customer"
        : state.lastSpeaker === "customer" ? "rep" : "unknown";
      if (opposite !== "unknown") {
        signals.push({ type: "silence_gap", value: "turn_change", weight: 0.4, gapMs: gap });
        signals.push({ type: "turn_taking", value: opposite, weight: 0.35 });
      }
    } else if (gap < 600) {
      // Very fast follow-up → likely same speaker continuing
      if (state.lastSpeaker !== "unknown") {
        signals.push({ type: "silence_gap", value: "same_speaker", weight: 0.25, gapMs: gap });
        signals.push({ type: "turn_taking", value: state.lastSpeaker, weight: 0.2 });
      }
    }
  }

  // ─── Signal 6: Energy profiling ─────────────────────────────────────
  if (typeof input.energy === "number" && input.energy > 0) {
    const repAvg = state.repProfile.avgEnergy;
    const custAvg = state.customerProfile.avgEnergy;

    if (repAvg > 0 && custAvg > 0 && Math.abs(repAvg - custAvg) > 0.08) {
      const distToRep = Math.abs(input.energy - repAvg);
      const distToCust = Math.abs(input.energy - custAvg);
      if (distToRep < distToCust) {
        signals.push({ type: "energy_profile", value: "rep", weight: 0.25, energyDelta: distToRep });
      } else {
        signals.push({ type: "energy_profile", value: "customer", weight: 0.25, energyDelta: distToCust });
      }
    }
  }

  // ─── Weighted vote ──────────────────────────────────────────────────
  let repScore = 0;
  let custScore = 0;
  let totalWeight = 0;

  for (const sig of signals) {
    if ("value" in sig && (sig.value === "rep" || sig.value === "customer")) {
      if (sig.value === "rep") repScore += sig.weight;
      else custScore += sig.weight;
      totalWeight += sig.weight;
    }
  }

  let speaker: SpeakerRole = "unknown";
  let confidence = 0;

  if (totalWeight > 0) {
    const repNorm = repScore / totalWeight;
    const custNorm = custScore / totalWeight;

    if (repNorm > custNorm && repScore >= state.adaptiveThreshold * 0.5) {
      speaker = "rep";
      confidence = Math.min(0.99, repNorm);
    } else if (custNorm > repNorm && custScore >= state.adaptiveThreshold * 0.5) {
      speaker = "customer";
      confidence = Math.min(0.99, custNorm);
    } else if (repNorm === custNorm && state.lastSpeaker !== "unknown") {
      // tie-break: assume speaker changed (more useful for coaching)
      speaker = state.lastSpeaker === "rep" ? "customer" : "rep";
      confidence = 0.45;
    }
  }

  // If still unknown and we have conversation history, use alternating heuristic
  if (speaker === "unknown" && state.turns.length > 0 && state.lastSpeaker !== "unknown") {
    // If the last 2 turns were the same speaker, next is likely the other
    if (state.consecutiveSame >= 2) {
      speaker = state.lastSpeaker === "rep" ? "customer" : "rep";
      confidence = 0.4;
    } else {
      speaker = state.lastSpeaker === "rep" ? "customer" : "rep";
      confidence = 0.35;
    }
  }

  // ─── Update state ───────────────────────────────────────────────────
  const isNewTurn = speaker !== state.lastSpeaker && speaker !== "unknown";

  const turn: SpeakerTurn = {
    speaker,
    text,
    confidence,
    at: new Date(now).toISOString(),
    signals,
  };

  state.turns.push(turn);
  if (state.turns.length > 100) state.turns = state.turns.slice(-80);

  if (speaker !== "unknown") {
    state.consecutiveSame = speaker === state.lastSpeaker ? state.consecutiveSame + 1 : 1;
    state.lastSpeaker = speaker;
    state.classifiedTurns += 1;

    // Update energy profile
    const profile = speaker === "rep" ? state.repProfile : state.customerProfile;
    profile.turnCount += 1;
    profile.totalWords += wordCount;
    profile.lastSpeakAt = now;
    if (typeof input.energy === "number") {
      profile.recentEnergies.push(input.energy);
      if (profile.recentEnergies.length > 20) profile.recentEnergies.shift();
      profile.avgEnergy = profile.recentEnergies.reduce((a, b) => a + b, 0) / profile.recentEnergies.length;
    }

    // Adapt threshold based on classification success
    if (confidence >= 0.7) {
      state.adaptiveThreshold = Math.max(0.35, state.adaptiveThreshold * 0.98);
    }
  }

  state.lastSpeakAt = now;

  // ─── Coaching context ───────────────────────────────────────────────
  const coachingContext = buildCoachingContext(speaker, text, customerMatches, repMatches, state);

  return { speaker, confidence, signals, isNewTurn, coachingContext };
}

// ─── Coaching context builder ─────────────────────────────────────────────────

function buildCoachingContext(
  speaker: SpeakerRole,
  text: string,
  customerPatterns: string[],
  repPatterns: string[],
  state: DiarizationState
): ClassifyResult["coachingContext"] {
  if (speaker === "customer") {
    // Determine customer intent
    let intent = "general_statement";

    if (customerPatterns.includes("price_inquiry")) intent = "asking_about_pricing";
    else if (customerPatterns.includes("concern")) intent = "expressing_concern";
    else if (customerPatterns.includes("competitive_compare")) intent = "comparing_competitors";
    else if (customerPatterns.includes("info_request")) intent = "requesting_information";
    else if (customerPatterns.includes("buying_signal")) intent = "showing_buying_interest";
    else if (customerPatterns.includes("rejection_signal")) intent = "signaling_rejection";
    else if (customerPatterns.includes("stakeholder_defer")) intent = "deferring_to_stakeholder";
    else if (customerPatterns.includes("requirement_statement")) intent = "stating_requirements";
    else if (customerPatterns.includes("existing_stack")) intent = "describing_current_setup";
    else if (customerPatterns.includes("question_to_rep")) intent = "asking_direct_question";
    else if (customerPatterns.includes("process_question")) intent = "asking_about_process";

    return { customerIntent: intent };
  }

  if (speaker === "rep") {
    // Assess rep performance
    let assessment = "neutral_statement";

    if (repPatterns.includes("rep_acknowledgment")) assessment = "good_acknowledgment";
    else if (repPatterns.includes("consultative_sell")) assessment = "strong_consultative_approach";
    else if (repPatterns.includes("value_prop")) assessment = "delivering_value_proposition";
    else if (repPatterns.includes("social_proof")) assessment = "sharing_social_proof";
    else if (repPatterns.includes("close_language")) assessment = "attempting_close";
    else if (repPatterns.includes("demo_language")) assessment = "demonstrating_product";
    else if (repPatterns.includes("pitch_language")) assessment = "pitching";
    else if (repPatterns.includes("offer_language")) assessment = "making_offer";
    else if (repPatterns.includes("summary_language")) assessment = "summarizing_needs";
    else if (repPatterns.includes("technical_pitch")) assessment = "technical_explanation";

    // Check for talk-ratio concern (rep monologuing)
    if (
      state.repProfile.totalWords > 100
      && state.customerProfile.totalWords > 0
      && state.repProfile.totalWords / (state.customerProfile.totalWords || 1) > 2.5
    ) {
      assessment = "warning_talking_too_much";
    }

    return { repAssessment: assessment };
  }

  return {};
}

// ─── Analytics helpers ────────────────────────────────────────────────────────

export function getSpeakerStats(state: DiarizationState) {
  const repWords = state.repProfile.totalWords;
  const custWords = state.customerProfile.totalWords;
  const totalWords = repWords + custWords;

  return {
    repTurns: state.repProfile.turnCount,
    customerTurns: state.customerProfile.turnCount,
    repWords,
    customerWords: custWords,
    talkRatio: totalWords > 0
      ? { rep: Math.round((repWords / totalWords) * 100), customer: Math.round((custWords / totalWords) * 100) }
      : { rep: 50, customer: 50 },
    avgRepEnergy: state.repProfile.avgEnergy,
    avgCustomerEnergy: state.customerProfile.avgEnergy,
    classifiedTurns: state.classifiedTurns,
    totalTurns: state.turns.length,
    lastSpeaker: state.lastSpeaker,
  };
}

/**
 * Get the last N speaker-labeled turns (for UI display).
 */
export function getRecentTurns(state: DiarizationState, n = 20): SpeakerTurn[] {
  return state.turns.slice(-n);
}
