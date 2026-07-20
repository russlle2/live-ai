export const MIN_STYLE_OBSERVATIONS_V2 = 12;
export const MIN_STYLE_SESSIONS_V2 = 3;

export type StyleFeaturesV2 = {
  wordsPerResponse: number;
  wordsPerSentence: number;
  questionRatio: number;
  contractionRatio: number;
  acknowledgmentRatio: number;
  hedgeRatio: number;
  directness: number;
  warmth: number;
};

export type StyleObservationSourceV2 =
  | "owner_spontaneous"
  | "guidance_changed"
  | "guidance_accepted"
  | "factual_correction";

export type StyleObservationV2 = {
  observationId: string;
  sessionId: string;
  turnId: string;
  observedAt: string;
  features: StyleFeaturesV2;
  source: StyleObservationSourceV2;
};

export type StyleProfileV2 = {
  schema: "style_profile_v2";
  version: number;
  features: StyleFeaturesV2;
  observationCount: number;
  sessionCount: number;
  evidenceObservationIds: string[];
  evidenceSessionIds: string[];
  promotedAt: string | null;
};

export type StylePromotionStatusV2 =
  | "promoted"
  | "insufficient_evidence"
  | "insufficient_session_diversity"
  | "session_dominance"
  | "inconsistent_evidence";

export type StylePromotionResultV2 =
  | {
      status: "promoted";
      eligibleObservations: number;
      profile: StyleProfileV2;
    }
  | {
      status: Exclude<StylePromotionStatusV2, "promoted">;
      eligibleObservations: number;
      profile: StyleProfileV2;
    };

export type PinnedStylePhraseV2 = {
  phraseId: string;
  phrase: string;
  pinnedAt: string;
};

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,239}$/;
const ELIGIBLE_SOURCES = new Set<StyleObservationSourceV2>([
  "owner_spontaneous",
  "guidance_changed"
]);
const FEATURE_KEYS = [
  "wordsPerResponse",
  "wordsPerSentence",
  "questionRatio",
  "contractionRatio",
  "acknowledgmentRatio",
  "hedgeRatio",
  "directness",
  "warmth"
] as const satisfies readonly (keyof StyleFeaturesV2)[];
const FEATURE_MAXIMUMS: StyleFeaturesV2 = {
  wordsPerResponse: 200,
  wordsPerSentence: 100,
  questionRatio: 1,
  contractionRatio: 1,
  acknowledgmentRatio: 1,
  hedgeRatio: 1,
  directness: 1,
  warmth: 1
};
const INITIAL_MOVEMENT_CAPS: StyleFeaturesV2 = {
  wordsPerResponse: 2,
  wordsPerSentence: 1,
  questionRatio: 0.03,
  contractionRatio: 0.03,
  acknowledgmentRatio: 0.03,
  hedgeRatio: 0.03,
  directness: 0.03,
  warmth: 0.03
};
const EMPTY_FEATURES: StyleFeaturesV2 = {
  wordsPerResponse: 24,
  wordsPerSentence: 12,
  questionRatio: 0.2,
  contractionRatio: 0.15,
  acknowledgmentRatio: 0.15,
  hedgeRatio: 0.12,
  directness: 0.5,
  warmth: 0.5
};
const SECRET_PATTERN =
  /\b(?:password|passcode|one[- ]time code|otp|api[ _-]?key|access[ _-]?token|refresh[ _-]?token|private[ _-]?key|social security|ssn|card number)\b/i;
let pinnedIdSequence = 0;

function assertId(value: string, label: string): void {
  if (!ID_PATTERN.test(value)) {
    throw new TypeError(`${label} must be a bounded protocol identifier`);
  }
}

function assertTimestamp(value: string, label: string): void {
  if (value.length > 100 || !Number.isFinite(Date.parse(value))) {
    throw new TypeError(`${label} must be a valid timestamp`);
  }
}

function cloneFeatures(features: StyleFeaturesV2): StyleFeaturesV2 {
  return { ...features };
}

function cloneProfile(profile: StyleProfileV2): StyleProfileV2 {
  return {
    ...profile,
    features: cloneFeatures(profile.features),
    evidenceObservationIds: [...profile.evidenceObservationIds],
    evidenceSessionIds: [...profile.evidenceSessionIds]
  };
}

function assertFeatures(features: StyleFeaturesV2): void {
  for (const key of FEATURE_KEYS) {
    const value = features[key];
    if (
      typeof value !== "number" ||
      !Number.isFinite(value) ||
      value < 0 ||
      value > FEATURE_MAXIMUMS[key]
    ) {
      throw new TypeError(
        `${key} must be finite and between 0 and ${FEATURE_MAXIMUMS[key]}`
      );
    }
  }
}

function assertProfile(profile: StyleProfileV2): void {
  if (
    profile.schema !== "style_profile_v2" ||
    !Number.isSafeInteger(profile.version) ||
    profile.version < 0 ||
    !Number.isSafeInteger(profile.observationCount) ||
    profile.observationCount < 0 ||
    !Number.isSafeInteger(profile.sessionCount) ||
    profile.sessionCount < 0
  ) {
    throw new TypeError("style profile metadata is invalid");
  }
  assertFeatures(profile.features);
  for (const value of profile.evidenceObservationIds) {
    assertId(value, "evidence observation ID");
  }
  for (const value of profile.evidenceSessionIds) {
    assertId(value, "evidence session ID");
  }
  if (profile.promotedAt !== null) assertTimestamp(profile.promotedAt, "promotedAt");
}

function assertObservation(observation: StyleObservationV2): void {
  assertId(observation.observationId, "observationId");
  assertId(observation.sessionId, "sessionId");
  assertId(observation.turnId, "turnId");
  assertTimestamp(observation.observedAt, "observedAt");
  assertFeatures(observation.features);
  if (
    observation.source !== "owner_spontaneous" &&
    observation.source !== "guidance_changed" &&
    observation.source !== "guidance_accepted" &&
    observation.source !== "factual_correction"
  ) {
    throw new TypeError("style observation source is invalid");
  }
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function round(value: number, digits = 4): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function trimmedMean(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const trim = sorted.length >= 10 ? Math.floor(sorted.length * 0.1) : 0;
  const retained = trim > 0 ? sorted.slice(trim, -trim) : sorted;
  return retained.reduce((sum, value) => sum + value, 0) / retained.length;
}

function interquartileRange(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const lower = sorted[Math.floor((sorted.length - 1) * 0.25)] ?? 0;
  const upper = sorted[Math.ceil((sorted.length - 1) * 0.75)] ?? 0;
  return upper - lower;
}

export function emptyStyleProfileV2(): StyleProfileV2 {
  return {
    schema: "style_profile_v2",
    version: 0,
    features: cloneFeatures(EMPTY_FEATURES),
    observationCount: 0,
    sessionCount: 0,
    evidenceObservationIds: [],
    evidenceSessionIds: [],
    promotedAt: null
  };
}

export function promoteStyleProfileV2(
  current: StyleProfileV2,
  observations: StyleObservationV2[],
  promotedAt = new Date().toISOString()
): StylePromotionResultV2 {
  assertProfile(current);
  assertTimestamp(promotedAt, "promotedAt");
  const previouslyUsed = new Set(current.evidenceObservationIds);
  const batchIds = new Set<string>();
  const eligible: StyleObservationV2[] = [];

  for (const observation of observations) {
    assertObservation(observation);
    if (
      !ELIGIBLE_SOURCES.has(observation.source) ||
      previouslyUsed.has(observation.observationId) ||
      batchIds.has(observation.observationId)
    ) {
      continue;
    }
    batchIds.add(observation.observationId);
    eligible.push(observation);
  }

  const unchanged = cloneProfile(current);
  if (eligible.length < MIN_STYLE_OBSERVATIONS_V2) {
    return {
      status: "insufficient_evidence",
      eligibleObservations: eligible.length,
      profile: unchanged
    };
  }

  const sessions = new Set(eligible.map((observation) => observation.sessionId));
  if (sessions.size < MIN_STYLE_SESSIONS_V2) {
    return {
      status: "insufficient_session_diversity",
      eligibleObservations: eligible.length,
      profile: unchanged
    };
  }

  const sessionCounts = new Map<string, number>();
  for (const observation of eligible) {
    sessionCounts.set(
      observation.sessionId,
      (sessionCounts.get(observation.sessionId) ?? 0) + 1
    );
  }
  const dominantCount = Math.max(...sessionCounts.values());
  if (dominantCount / eligible.length > 0.6) {
    return {
      status: "session_dominance",
      eligibleObservations: eligible.length,
      profile: unchanged
    };
  }

  const boundedPreferenceKeys: readonly (keyof StyleFeaturesV2)[] = [
    "questionRatio",
    "contractionRatio",
    "acknowledgmentRatio",
    "hedgeRatio",
    "directness",
    "warmth"
  ];
  if (boundedPreferenceKeys.some((key) =>
    interquartileRange(eligible.map((observation) => observation.features[key])) > 0.45
  )) {
    return {
      status: "inconsistent_evidence",
      eligibleObservations: eligible.length,
      profile: unchanged
    };
  }

  const targets = {} as StyleFeaturesV2;
  for (const key of FEATURE_KEYS) {
    targets[key] = trimmedMean(eligible.map((observation) => observation.features[key]));
  }

  const nextFeatures = {} as StyleFeaturesV2;
  for (const key of FEATURE_KEYS) {
    const currentValue = current.features[key];
    const desiredMovement = current.version === 0
      ? targets[key] - currentValue
      : (targets[key] - currentValue) * 0.05;
    const movement = clamp(
      desiredMovement,
      -INITIAL_MOVEMENT_CAPS[key],
      INITIAL_MOVEMENT_CAPS[key]
    );
    nextFeatures[key] = round(
      clamp(currentValue + movement, 0, FEATURE_MAXIMUMS[key])
    );
  }

  const evidenceObservationIds = [
    ...current.evidenceObservationIds,
    ...eligible.map((observation) => observation.observationId)
  ].slice(-10_000);
  const evidenceSessionIds = [
    ...new Set([
      ...current.evidenceSessionIds,
      ...eligible.map((observation) => observation.sessionId)
    ])
  ].slice(-2_000);

  return {
    status: "promoted",
    eligibleObservations: eligible.length,
    profile: {
      schema: "style_profile_v2",
      version: current.version + 1,
      features: nextFeatures,
      observationCount: evidenceObservationIds.length,
      sessionCount: evidenceSessionIds.length,
      evidenceObservationIds,
      evidenceSessionIds,
      promotedAt
    }
  };
}

export function extractStyleFeaturesV2(text: string): StyleFeaturesV2 | null {
  const normalized = text.normalize("NFKC").replace(/\s+/g, " ").trim();
  const words = normalized.match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu) ?? [];
  if (words.length < 2) return null;

  const sentenceParts = normalized
    .split(/(?<=[.!?])\s+|\n+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
  const sentenceCount = Math.max(1, sentenceParts.length);
  const questionCount = sentenceParts.filter((sentence) => sentence.includes("?")).length;
  const contractionCount = words.filter((word) => /['’]/.test(word)).length;
  const acknowledgmentCount = (
    normalized.match(
      /\b(?:I understand|I hear you|that makes sense|that's fair|thank you|I appreciate|got it)\b/gi
    ) ?? []
  ).length;
  const hedgeCount = (
    normalized.match(
      /\b(?:maybe|perhaps|possibly|probably|might|could|I think|I guess|sort of|kind of)\b/gi
    ) ?? []
  ).length;
  const directCount = (
    normalized.match(
      /\b(?:let's|let us|I will|I'll|first|next|directly|need to|recommend|the answer is)\b/gi
    ) ?? []
  ).length;
  const warmthCount = (
    normalized.match(
      /\b(?:thank|appreciate|understand|glad|happy|fair|help|together)\b/gi
    ) ?? []
  ).length;

  return {
    wordsPerResponse: Math.min(FEATURE_MAXIMUMS.wordsPerResponse, words.length),
    wordsPerSentence: round(
      Math.min(FEATURE_MAXIMUMS.wordsPerSentence, words.length / sentenceCount)
    ),
    questionRatio: round(questionCount / sentenceCount),
    contractionRatio: round(contractionCount / words.length),
    acknowledgmentRatio: round(
      Math.min(1, acknowledgmentCount / sentenceCount)
    ),
    hedgeRatio: round(Math.min(1, hedgeCount / words.length)),
    directness: round(
      clamp(0.5 + directCount / sentenceCount * 0.12 - hedgeCount / words.length, 0, 1)
    ),
    warmth: round(
      clamp(
        0.35 +
          warmthCount / words.length * 0.8 +
          acknowledgmentCount / sentenceCount * 0.2,
        0,
        1
      )
    )
  };
}

export function pinStylePhraseV2(
  phrase: string,
  pinnedAt = new Date().toISOString(),
  createId: () => string = () => {
    pinnedIdSequence = (pinnedIdSequence + 1) % Number.MAX_SAFE_INTEGER;
    return `pinned-${Date.now().toString(36)}-${pinnedIdSequence.toString(36)}`;
  }
): PinnedStylePhraseV2 {
  const normalized = phrase.normalize("NFKC").replace(/\s+/g, " ").trim();
  if (normalized.length < 2 || normalized.length > 240) {
    throw new TypeError("pinned phrase must contain 2-240 characters");
  }
  if (SECRET_PATTERN.test(normalized)) {
    throw new TypeError("pinned phrase contains credential or identifier material");
  }
  assertTimestamp(pinnedAt, "pinnedAt");
  const phraseId = createId();
  assertId(phraseId, "phraseId");
  return { phraseId, phrase: normalized, pinnedAt };
}

export function rollbackStyleProfileV2(
  history: readonly StyleProfileV2[],
  targetVersion: number
): StyleProfileV2 {
  if (!Number.isSafeInteger(targetVersion) || targetVersion < 0) {
    throw new TypeError("target style version is invalid");
  }
  const target = history.find((profile) => profile.version === targetVersion);
  if (!target) throw new Error(`style profile version ${targetVersion} was not found`);
  assertProfile(target);
  return cloneProfile(target);
}
