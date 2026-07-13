import { z } from "zod";

export const GOOGLE_READONLY_SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/drive.readonly"
] as const;

export type GoogleSyncFetch = typeof globalThis.fetch;

export type GoogleRuntimeConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  storageDir: string;
  /** Secret used to encrypt OAuth material, sync cursors, and cached source text at rest. */
  storageEncryptionKey: string;
  batchSize?: number;
  maxPagesPerRun?: number;
  intervalMs?: number;
  requestTimeoutMs?: number;
  maxJsonResponseBytes?: number;
  maxTextResponseBytes?: number;
  maxExtractionsPerRun?: number;
  dailyExtractionBudget?: number;
  maxCachedSources?: number;
  gmailQuery?: string;
  driveQuery?: string;
  fetch?: GoogleSyncFetch;
  now?: () => Date;
};

export const OAuthTokenSchema = z.object({
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1).optional(),
  expiresAt: z.number().int().positive(),
  tokenType: z.string().default("Bearer"),
  scopes: z.array(z.string()).default([]),
  accountEmail: z.string().email().optional(),
  updatedAt: z.string()
});
export type OAuthToken = z.infer<typeof OAuthTokenSchema>;

export const OAuthPendingSchema = z.object({
  state: z.string().min(20),
  codeVerifier: z.string().min(43),
  createdAt: z.string()
});
export type OAuthPending = z.infer<typeof OAuthPendingSchema>;

export const GmailSyncStateSchema = z.object({
  phase: z.enum(["bootstrap", "incremental"]).default("bootstrap"),
  bootstrapHistoryId: z.string().optional(),
  listPageToken: z.string().optional(),
  pendingListNextPageToken: z.string().optional(),
  pendingMessageIds: z.array(z.string()).default([]),
  pendingDeletedMessageIds: z.array(z.string()).default([]),
  historyId: z.string().optional(),
  historyAnchorId: z.string().optional(),
  historyPageToken: z.string().optional(),
  pendingHistoryNextPageToken: z.string().optional(),
  pendingHistoryLatestId: z.string().optional(),
  lastSyncAt: z.string().optional()
});
export type GmailSyncState = z.infer<typeof GmailSyncStateSchema>;

export const DriveFilePointerSchema = z.object({
  id: z.string(),
  removed: z.boolean().default(false)
});
export type DriveFilePointer = z.infer<typeof DriveFilePointerSchema>;

export const DriveSyncStateSchema = z.object({
  phase: z.enum(["bootstrap", "incremental"]).default("bootstrap"),
  bootstrapChangesToken: z.string().optional(),
  listPageToken: z.string().optional(),
  pendingListNextPageToken: z.string().optional(),
  pendingFiles: z.array(DriveFilePointerSchema).default([]),
  changesPageToken: z.string().optional(),
  changesAnchorToken: z.string().optional(),
  pendingChangesNextPageToken: z.string().optional(),
  pendingChangesNewStartToken: z.string().optional(),
  lastSyncAt: z.string().optional()
});
export type DriveSyncState = z.infer<typeof DriveSyncStateSchema>;

export const GoogleSyncStateSchema = z.object({
  schema: z.literal("google_sync_state_v1"),
  updatedAt: z.string(),
  extractionBudgetDay: z.string().optional(),
  extractionsToday: z.number().int().nonnegative().default(0),
  gmail: GmailSyncStateSchema,
  drive: DriveSyncStateSchema
});
export type GoogleSyncState = z.infer<typeof GoogleSyncStateSchema>;

export type GoogleSourceType = "gmail" | "drive";
export type MemorySensitivity = "normal" | "sensitive" | "restricted";

/**
 * A non-identifying relationship signal derived locally from the Gmail
 * profile address and message From/To headers. Exact addresses never enter
 * this object or the model prompt.
 */
export const GmailAuthorshipContextSchema = z.object({
  authorRelationship: z.enum(["owner", "correspondent", "unknown"]),
  direction: z.enum(["outbound", "inbound", "self", "unknown"])
});
export type GmailAuthorshipContext = z.infer<typeof GmailAuthorshipContextSchema>;

export const SourceDocumentSchema = z.object({
  sourceType: z.enum(["gmail", "drive"]),
  sourceRef: z.string().min(1),
  externalId: z.string().min(1),
  title: z.string().max(500),
  timestamp: z.string().optional(),
  mimeType: z.string().optional(),
  webUrl: z.string().url().optional(),
  text: z.string().max(60_000),
  contentHash: z.string().min(16),
  sensitivity: z.enum(["normal", "sensitive", "restricted"]),
  reviewFlags: z.array(z.string()).default([]),
  gmailAuthorship: GmailAuthorshipContextSchema.optional()
});
export type SourceDocument = z.infer<typeof SourceDocumentSchema>;

export const MemoryCategorySchema = z.enum([
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
]);
export type MemoryCategory = z.infer<typeof MemoryCategorySchema>;

export const ExtractedFactDraftSchema = z.object({
  fact: z.string().min(2).max(4000),
  category: MemoryCategorySchema,
  keywords: z.array(z.string().min(1).max(80)).max(40).default([]),
  confidence: z.number().min(0).max(1),
  sensitivity: z.enum(["normal", "sensitive", "restricted"]),
  temporality: z.enum(["durable", "current", "historical", "unknown"]),
  claimKey: z.string().max(160).optional(),
  validFrom: z.string().optional(),
  validTo: z.string().optional(),
  reviewFlags: z.array(z.string()).default([])
});
export type ExtractedFactDraft = z.infer<typeof ExtractedFactDraftSchema>;

/**
 * OpenAI Structured Outputs requires every object property to be required.
 * Nullable values model the three fields that are optional in the internal
 * draft shape; they are removed before the draft enters the rest of the app.
 */
export const ExtractedFactModelSchema = z.object({
  fact: z.string().min(2).max(4000),
  category: MemoryCategorySchema,
  keywords: z.array(z.string().min(1).max(80)).max(40),
  confidence: z.number().min(0).max(1),
  sensitivity: z.enum(["normal", "sensitive", "restricted"]),
  temporality: z.enum(["durable", "current", "historical", "unknown"]),
  claimKey: z.string().max(160).nullable(),
  validFrom: z.string().nullable(),
  validTo: z.string().nullable(),
  reviewFlags: z.array(z.string())
});
export type ExtractedFactModel = z.infer<typeof ExtractedFactModelSchema>;

export const ExtractedMemoryFactSchema = ExtractedFactDraftSchema.extend({
  id: z.string().min(1),
  source: z.object({
    type: z.enum(["gmail", "drive"]),
    ref: z.string(),
    timestamp: z.string().optional(),
    title: z.string().optional()
  }),
  userVerified: z.literal(false),
  sourceContentHash: z.string()
});
export type ExtractedMemoryFact = z.infer<typeof ExtractedMemoryFactSchema>;

export type MemoryFactExtractor = {
  extract(document: SourceDocument): Promise<ExtractedFactDraft[]>;
};

export type GoogleMemoryIngestor = (
  facts: ExtractedMemoryFact[],
  sourceRef: string
) => Promise<void>;

export const CachedSourceSchema = SourceDocumentSchema.extend({
  firstSeenAt: z.string(),
  lastSeenAt: z.string(),
  extractedContentHash: z.string().optional(),
  extractedFacts: z.array(ExtractedMemoryFactSchema).default([]),
  extractionReviewFlags: z.array(z.string()).default([]),
  deletedAt: z.string().optional()
});
export type CachedSource = z.infer<typeof CachedSourceSchema>;

export const SourceCacheSchema = z.object({
  schema: z.literal("google_source_cache_v1"),
  updatedAt: z.string(),
  sources: z.record(CachedSourceSchema)
});
export type SourceCacheFile = z.infer<typeof SourceCacheSchema>;

export type GoogleSyncRunResult = {
  authorized: boolean;
  gmailDocuments: number;
  driveDocuments: number;
  extractedDocuments: number;
  ingestedFacts: number;
  reviewRequired: number;
};

export type GoogleAuthorizationRevocationResult = {
  providerRevoked: boolean;
  localAuthorizationCleared: boolean;
  warnings: string[];
};

export type GoogleLocalPurgeResult = {
  removedSources: number;
  providerRevoked: boolean;
  localCleanupComplete: boolean;
  warnings: string[];
};
