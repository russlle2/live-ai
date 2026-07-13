export const MEMORY_FACT_CATEGORIES = [
  "identity",
  "employment",
  "education",
  "skills",
  "achievement",
  "project",
  "preference",
  "constraint",
  "story",
  "communication_style",
  "availability",
  "other"
] as const;

export const MEMORY_SOURCE_TYPES = ["gmail", "drive", "conversation", "manual", "system"] as const;
export const MEMORY_SENSITIVITIES = ["normal", "sensitive", "restricted"] as const;
export const MEMORY_TEMPORALITIES = ["durable", "current", "historical", "unknown"] as const;

export type MemoryFactCategory = (typeof MEMORY_FACT_CATEGORIES)[number];
export type MemorySourceType = (typeof MEMORY_SOURCE_TYPES)[number];
export type MemorySensitivity = (typeof MEMORY_SENSITIVITIES)[number];
export type MemoryTemporality = (typeof MEMORY_TEMPORALITIES)[number];

export type MemoryFact = {
  id: string;
  category: MemoryFactCategory;
  fact: string;
  keywords: string[];
  source: {
    type: MemorySourceType;
    ref?: string;
    timestamp?: string;
    title?: string;
  };
  confidence: number;
  sensitivity: MemorySensitivity;
  temporality: MemoryTemporality;
  userVerified: boolean;
  validFrom?: string;
  validTo?: string;
  createdAt: string;
  updatedAt: string;
};

export type MemoryFactWriteInput = Omit<MemoryFact, "createdAt" | "updatedAt">;

export type CategorizedMemoryFacts = {
  confirmedReviewClear: MemoryFact[];
  needsReview: MemoryFact[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function safeText(value: unknown, maximumLength: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().slice(0, maximumLength);
  return normalized || undefined;
}

function enumValue<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && allowed.includes(value as T) ? value as T : fallback;
}

/**
 * Treat API data as untrusted at the UI boundary. Only the fields the review
 * surface needs are retained, text stays plain, and malformed rows are omitted.
 */
export function normalizeMemoryFact(value: unknown): MemoryFact | null {
  if (!isRecord(value)) return null;
  const id = safeText(value.id, 240);
  const fact = safeText(value.fact, 4000);
  if (!id || !fact || fact.length < 2) return null;

  const sourceInput = isRecord(value.source) ? value.source : {};
  const rawConfidence = typeof value.confidence === "number" && Number.isFinite(value.confidence)
    ? value.confidence
    : 0;
  const keywordValues = Array.isArray(value.keywords) ? value.keywords : [];
  const keywords = [...new Set(keywordValues
    .map((keyword) => safeText(keyword, 80))
    .filter((keyword): keyword is string => Boolean(keyword))
  )].slice(0, 40);

  const source: MemoryFact["source"] = {
    type: enumValue(sourceInput.type, MEMORY_SOURCE_TYPES, "system")
  };
  const sourceRef = safeText(sourceInput.ref, 1000);
  const sourceTimestamp = safeText(sourceInput.timestamp, 100);
  const sourceTitle = safeText(sourceInput.title, 500);
  if (sourceRef) source.ref = sourceRef;
  if (sourceTimestamp) source.timestamp = sourceTimestamp;
  if (sourceTitle) source.title = sourceTitle;

  const validFrom = safeText(value.validFrom, 100);
  const validTo = safeText(value.validTo, 100);
  const normalized: MemoryFact = {
    id,
    category: enumValue(value.category, MEMORY_FACT_CATEGORIES, "other"),
    fact,
    keywords,
    source,
    confidence: Math.max(0, Math.min(1, rawConfidence)),
    sensitivity: enumValue(value.sensitivity, MEMORY_SENSITIVITIES, "normal"),
    temporality: enumValue(value.temporality, MEMORY_TEMPORALITIES, "unknown"),
    userVerified: value.userVerified === true,
    createdAt: safeText(value.createdAt, 100) ?? "",
    updatedAt: safeText(value.updatedAt, 100) ?? ""
  };
  if (validFrom) normalized.validFrom = validFrom;
  if (validTo) normalized.validTo = validTo;
  return normalized;
}

const REVIEW_REASON_LABELS: Record<string, string> = {
  needs_review: "Requires your review",
  low_confidence: "Low-confidence extraction",
  sensitive_review: "Sensitive claim needs confirmation",
  correspondent_authored_claim: "Came from someone else’s message",
  unknown_authorship_claim: "Source authorship is unknown",
  drive_authorship_unverified: "Drive authorship is unverified",
  source_instruction_like_content: "Source contained instruction-like text",
  other_person_only_evidence: "Supported only by the other person’s words"
};

function labelReviewReason(reason: string): string {
  if (REVIEW_REASON_LABELS[reason]) return REVIEW_REASON_LABELS[reason];
  if (reason.startsWith("conflicts_with:")) return "Conflicts with another stored fact";
  if (reason.startsWith("excluded:")) return "Potentially private source text was excluded";
  if (reason.startsWith("content_unavailable:")) return "Some source content was unavailable";
  return reason
    .replaceAll("_", " ")
    .replaceAll("-", " ")
    .replace(/\s+/g, " ")
    .replace(/^./, (character) => character.toUpperCase());
}

export function memoryReviewReasons(fact: MemoryFact): string[] {
  const reasons = fact.keywords
    .filter((keyword) => keyword.toLowerCase().startsWith("review:"))
    .map((keyword) => keyword.slice("review:".length).trim().toLowerCase())
    .filter(Boolean)
    .map(labelReviewReason);
  if (!fact.userVerified) reasons.unshift("Not yet verified by you");
  return [...new Set(reasons)];
}

export function categorizeMemoryFacts(values: unknown[]): CategorizedMemoryFacts {
  const byId = new Map<string, MemoryFact>();
  for (const value of values) {
    const fact = normalizeMemoryFact(value);
    if (fact) byId.set(fact.id, fact);
  }

  const sorted = [...byId.values()].sort((left, right) => {
    const updatedDifference = (Date.parse(right.updatedAt) || 0) - (Date.parse(left.updatedAt) || 0);
    return updatedDifference || left.category.localeCompare(right.category) || left.fact.localeCompare(right.fact);
  });
  return {
    confirmedReviewClear: sorted.filter((fact) => fact.userVerified && memoryReviewReasons(fact).length === 0),
    needsReview: sorted.filter((fact) => !fact.userVerified || memoryReviewReasons(fact).length > 0)
  };
}

/** Explicit verification resolves review flags while retaining ordinary search keywords. */
export function prepareVerifiedMemoryFact(fact: MemoryFact, correction?: string): MemoryFactWriteInput {
  const corrected = correction?.trim();
  return {
    id: fact.id,
    category: fact.category,
    fact: corrected || fact.fact,
    keywords: fact.keywords.filter((keyword) => !keyword.toLowerCase().startsWith("review:")),
    source: { ...fact.source },
    confidence: fact.confidence,
    sensitivity: fact.sensitivity,
    temporality: fact.temporality,
    userVerified: true,
    ...(fact.validFrom ? { validFrom: fact.validFrom } : {}),
    ...(fact.validTo ? { validTo: fact.validTo } : {})
  };
}
