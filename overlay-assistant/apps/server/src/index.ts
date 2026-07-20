import http from "http";
import { randomBytes, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import express from "express";
import cors from "cors";
import compression from "compression";
import { WebSocketServer } from "ws";
import { z } from "zod";
import {
  initialConversationStateV2,
  MIN_STYLE_OBSERVATIONS_V2,
  parseRuntimeEventV2,
  reduceConversationStateV2,
  type ConversationStateV2,
  type StyleObservationSourceV2
} from "@overlay-assistant/runtime";

import {
  sanitizePatch_v1,
  getInitialPlaybookStageV1,
  selectNextPlaybookStageV1,
  DEFAULT_SESSION_PROFILE_V1,
  SCENARIO_MODES_V1,
  type WsClientMessageV1,
  type WsServerMessageV1,
  type OverlayMessageV1,
  type GuidanceControls,
  type ConversationSpeakerV1,
  type CaptureProvenanceV1,
  type ConversationPlaybookStageIdV1,
  type DeviceRoleV1,
  type SessionProfileV1
} from "@overlay-assistant/shared";

import { CONFIG, ARBITRATION_LOCUS } from "./config.js";
import { upsertSession, endSession, getTrustSummaryForTenant, purgeAllRuntimeDatabaseData } from "./db/queries.js";
import { pool, pingDb } from "./db/pool.js";
import {
  beginObsDataPurge,
  discardPendingObsEvents,
  emitLog,
  endObsDataPurge
} from "./obs/emitLog.js";
import { arbitrateV1 } from "./arbitration/arbitration_v1.js";
import { getAiCoaching, isAiCoachEnabled } from "./arbitration/ai_coach_v1.js";
import {
  getDeterministicCushion,
  selectDeterministicGuidance,
  shouldCoachSpeaker
} from "./arbitration/live_fallback_v1.js";
import {
  authorizePersonalLogin,
  authorizeWebSocketStart,
  currentAuthRuntimePolicy,
  PersonalLoginInputSchema,
  requireAuth,
  signToken
} from "./middleware/auth.js";
import {
  rateLimitCoaching,
  clearAllRateLimits,
  clearSessionRateLimit,
  createRouteRateLimit,
  getRateLimitStats
} from "./middleware/rate_limit.js";
import { clearAllTokenUsage, getTenantUsageSummary, getAllTenantUsage, logTokenUsage } from "./middleware/token_usage.js";
import { applySecurityHeaders, requestContext } from "./middleware/security.js";
import { isAllowedWebSocketOrigin } from "./middleware/ws_origin.js";
import {
  isDirectLoopbackRequest,
  isSafeLoopbackDemoBinding,
  loadOrCreatePersonalAuth,
  rotateManagedPersonalAuth,
  clearManagedPersonalAuthArtifacts
} from "./middleware/auth_bootstrap.js";
import {
  appendSessionTurn,
  clearGoogleMemoryFacts,
  clearMemoryFile,
  clearSessionLogs,
  deleteMemoryFact,
  getMemoryStats,
  MemoryFactInputSchema,
  readMemoryFile,
  replaceGoogleSourceFacts,
  retrieveMemoryFacts,
  searchSessionTurns,
  upsertMemoryFacts,
  type MemoryFactInput
} from "./memory/personal_memory.js";
import { learnFromConversation } from "./memory/conversation_learning.js";
import {
  appendDeliveryStyleObservation,
  createDeliveryStyleObservation,
  type DeliveryStyleObservation
} from "./memory/delivery_style_learning.js";
import { SlowStyleLearnerV2 } from "./memory/slow_style_profile_v2.js";
import { GuidanceFeedbackStoreV2 } from "./session/guidance_feedback_v2.js";
import { SessionGuidanceV2 } from "./session/session_guidance_v2.js";
import { createRealtimeTranscriptionClientSecret } from "./openai/realtime_token.js";
import { getOpenAIClient, openAISafetyIdentifier } from "./openai/client.js";
import {
  createSpeakerServiceClient,
  SpeakerServiceError
} from "./integrations/speaker/speaker_service.js";
import {
  createGoogleSyncRouter,
  GoogleMemorySync,
  GoogleOAuthError,
  OpenAIGoogleMemoryExtractor,
  toPersonalMemoryInputs
} from "./integrations/google/index.js";
import {
  buildStyleAwareCoachingContext,
  loadReviewedCoachingCorpora,
  type CoachingDomain,
  type CoachingExample
} from "./knowledge/coaching_corpus.js";

type Speaker = ConversationSpeakerV1;

const authBootstrap = loadOrCreatePersonalAuth({
  filePath: CONFIG.personalAuthStatePath,
  jwtSecret: CONFIG.jwtSecret,
  personalAccessCode: CONFIG.personalAccessCode,
  allowInsecureDemoAuth: CONFIG.allowInsecureDemoAuth
});
CONFIG.jwtSecret = authBootstrap.jwtSecret;
CONFIG.personalAccessCode = authBootstrap.personalAccessCode;
CONFIG.authAutoBootstrapped = authBootstrap.managed;
if (CONFIG.googleStorageEncryptionKey.length < 32 && authBootstrap.managed) {
  CONFIG.googleStorageEncryptionKey = authBootstrap.storageEncryptionKey;
}
if (CONFIG.privateStorageEncryptionKey.length < 32 && authBootstrap.managed) {
  CONFIG.privateStorageEncryptionKey = authBootstrap.storageEncryptionKey;
}
if (CONFIG.privateStorageEncryptionKey.length < 32 && CONFIG.allowInsecureDemoAuth) {
  CONFIG.privateStorageEncryptionKey = randomBytes(48).toString("base64url");
}
if (CONFIG.privateStorageEncryptionKey.length < 32) {
  throw new Error(
    "PRIVATE_STORAGE_ENCRYPTION_KEY must contain at least 32 characters when authentication is environment-managed"
  );
}
if (CONFIG.allowInsecureDemoAuth && !isSafeLoopbackDemoBinding({
  host: CONFIG.host,
  webOrigin: CONFIG.webOrigin
})) {
  throw new Error("ALLOW_INSECURE_DEMO_AUTH requires loopback HOST and WEB_ORIGIN");
}

type ProductContext = {
  productName?: string;
  differentiators?: string;
  competitors?: string;
  targetIndustry?: string;
  commonObjections?: string;
};

type ConversationTurn = { speaker: Speaker; text: string };
let privateDataEpoch = 0;
let privateDataPurgeActive = false;
const privateDataTasks = new Set<Promise<unknown>>();
const privateMutationOperations = new Set<Promise<unknown>>();

function trackPrivateDataTask<T>(
  epoch: number,
  work: () => Promise<T>
): Promise<T | undefined> {
  const task = Promise.resolve().then(() =>
    epoch === privateDataEpoch ? work() : undefined
  );
  privateDataTasks.add(task);
  void task.then(
    () => privateDataTasks.delete(task),
    () => privateDataTasks.delete(task)
  );
  return task;
}

async function drainPrivateDataTasks(): Promise<void> {
  while (privateDataTasks.size > 0) {
    await Promise.allSettled([...privateDataTasks]);
  }
}

function isPrivateMutationRequest(req: express.Request): boolean {
  return !["GET", "HEAD", "OPTIONS"].includes(req.method) ||
    req.path.startsWith("/api/google/") ||
    req.path === "/api/runtime/status";
}

function isPrivatePurgeRequest(req: express.Request): boolean {
  return req.method === "DELETE" && req.path === "/api/private-data";
}

function trackPrivateMutationOperation<T>(work: () => Promise<T>): Promise<T> {
  if (privateDataPurgeActive) {
    return Promise.reject(new Error("private_data_purge_in_progress"));
  }
  const operation = Promise.resolve().then(work);
  privateMutationOperations.add(operation);
  void operation.then(
    () => privateMutationOperations.delete(operation),
    () => privateMutationOperations.delete(operation)
  );
  return operation;
}

async function drainPrivateMutationRequests(): Promise<void> {
  while (privateMutationOperations.size > 0) {
    await Promise.allSettled([...privateMutationOperations]);
  }
}

function coachingDomainForMode(mode: SessionProfileV1["mode"]): CoachingDomain {
  return mode === "general" ? "professional_growth" : mode;
}

function coachingCorpusStats(examples: CoachingExample[]) {
  const byDomain: Record<string, number> = {};
  for (const example of examples) byDomain[example.domain] = (byDomain[example.domain] ?? 0) + 1;
  return { total: examples.length, byDomain };
}

type PendingDeliverySuggestion = {
  guidanceId: string;
  text: string;
  leadSeq: number;
  at: string;
};

type SessionCtx = {
  dataEpoch: number;
  sessionId: string;
  tenantId: string;
  repId: string;
  controls: GuidanceControls;
  seq: number;
  speaker: Speaker;
  profile: SessionProfileV1;
  lastActivity: number;
  productContext?: ProductContext;
  conversationHistory: ConversationTurn[];
  runtimeState: ConversationStateV2;
  latestLeadSeq: number;
  mockStarted: boolean;
  learningInFlight: boolean;
  lastLearnedSeq: number;
  learningPending: boolean;
  learningPendingForce: boolean;
  completedPlaybookStageIds: ConversationPlaybookStageIdV1[];
  activePlaybookStageId?: ConversationPlaybookStageIdV1;
  lastCoachingMessage?: Extract<WsServerMessageV1, { type: "overlay_message" }>;
  guidance: SessionGuidanceV2;
  pendingFinalSuggestion?: PendingDeliverySuggestion;
  deliveryStyleObservations: DeliveryStyleObservation[];
};

const CONVERSATION_LEARNING_TURN_INTERVAL = 6;

const DEFAULT_CONTROLS: GuidanceControls = {
  guidanceMode: "assist",
  guidanceMuted: false,
  aiDepth: "P0",
  showLowConfidence: false
};

const SessionProfileInput = z.object({
  mode: z.enum(SCENARIO_MODES_V1).optional(),
  targetRole: z.string().max(300).optional(),
  company: z.string().max(300).optional(),
  goal: z.string().max(1500).optional(),
  preContext: z.string().max(5000).optional()
}).strict();

function mergeSessionProfile(
  current: SessionProfileV1,
  input?: z.infer<typeof SessionProfileInput>
): SessionProfileV1 {
  if (!input) return current;
  return {
    ...current,
    ...input,
    mode: input.mode ?? current.mode
  };
}

function safeLearningErrorData(error: unknown): Record<string, string> {
  const value = error && typeof error === "object" ? error as Record<string, unknown> : {};
  const rawType = error instanceof Error ? error.name : "unknown_error";
  const errorType = rawType.replace(/[^a-zA-Z0-9_.-]/g, "_").slice(0, 80) || "unknown_error";
  const rawCode = typeof value.code === "string" ? value.code : "";
  const errorCode = rawCode.replace(/[^a-zA-Z0-9_.-]/g, "_").slice(0, 80);
  return errorCode ? { errorType, errorCode } : { errorType };
}

/**
 * Queue durable-memory extraction outside the transcript hot path. The session
 * owns serialization state so interval and final-flush requests cannot overlap.
 */
function scheduleConversationLearning(
  ctx: SessionCtx,
  options: { force?: boolean } = {}
): void {
  if (ctx.dataEpoch !== privateDataEpoch) return;
  const force = options.force === true;
  const unlearnedTurns = ctx.seq - ctx.lastLearnedSeq;
  if (unlearnedTurns <= 0 || ctx.conversationHistory.length === 0) return;
  if (!force && unlearnedTurns < CONVERSATION_LEARNING_TURN_INTERVAL) return;

  if (ctx.learningInFlight) {
    ctx.learningPending = true;
    ctx.learningPendingForce ||= force;
    return;
  }

  const snapshotSeq = ctx.seq;
  const snapshotTurns = ctx.conversationHistory.map((turn) => ({ ...turn }));
  const snapshotProfile = { ...ctx.profile };
  const learningEpoch = ctx.dataEpoch;
  ctx.learningInFlight = true;
  ctx.lastLearnedSeq = snapshotSeq;

  // setImmediate prevents prompt construction and request setup from consuming
  // even a small slice of the latency-sensitive transcript callback.
  setImmediate(() => {
    void trackPrivateDataTask(learningEpoch, () => learnFromConversation({
        sessionId: ctx.sessionId,
        tenantId: ctx.tenantId,
        repId: ctx.repId,
        profile: snapshotProfile,
        turns: snapshotTurns,
        upsert: async (facts) => learningEpoch === privateDataEpoch
          ? upsertMemoryFacts(facts)
          : { inserted: 0, updated: 0, total: 0 }
      }))
      .catch((error: unknown) => {
      emitLog({
        tenantId: ctx.tenantId,
        repId: ctx.repId,
        session_id: ctx.sessionId,
        service: "conversation_learning",
        eventType: "conversation_memory_learning_error",
        level: "WARN",
        data: safeLearningErrorData(error)
      });
      }).finally(() => {
      ctx.learningInFlight = false;
      const pending = ctx.learningPending;
      const pendingForce = ctx.learningPendingForce;
      ctx.learningPending = false;
      ctx.learningPendingForce = false;

      if (
        pendingForce ||
        (pending && ctx.seq - ctx.lastLearnedSeq >= CONVERSATION_LEARNING_TURN_INTERVAL)
      ) {
        scheduleConversationLearning(ctx, { force: pendingForce });
      }
      });
  });
}

function recordDeliveryStyleObservation(
  ctx: SessionCtx,
  actual: string,
  turnSeq: number,
  at: string
): StyleObservationSourceV2 {
  if (ctx.dataEpoch !== privateDataEpoch) return "owner_spontaneous";
  const suggestion = ctx.pendingFinalSuggestion;
  if (!suggestion || suggestion.leadSeq !== ctx.latestLeadSeq) return "owner_spontaneous";
  const suggestionAgeMs = Date.now() - Date.parse(suggestion.at);
  if (!Number.isFinite(suggestionAgeMs) || suggestionAgeMs < 0 || suggestionAgeMs > 10 * 60_000) {
    ctx.pendingFinalSuggestion = undefined;
    guidanceFeedbackStore.clearSession(ctx.sessionId);
    return "owner_spontaneous";
  }
  const feedback = guidanceFeedbackStore.takeForOwnerTurn(
    ctx.sessionId,
    suggestion.guidanceId
  );
  ctx.pendingFinalSuggestion = undefined;
  if (feedback?.status === "ignored") return "owner_spontaneous";

  const observation = createDeliveryStyleObservation({
    sessionId: ctx.sessionId,
    suggested: suggestion.text,
    actual,
    observedAt: at,
    suggestionKind: "final",
    feedbackStatus: feedback?.status === "accepted" ? "accepted" : "unmarked"
  });
  ctx.deliveryStyleObservations.push(observation);

  void trackPrivateDataTask(
    ctx.dataEpoch,
    () => appendDeliveryStyleObservation(observation)
  ).catch((error: unknown) => {
    emitLog({
      tenantId: ctx.tenantId,
      repId: ctx.repId,
      session_id: ctx.sessionId,
      service: "delivery_style_learning",
      eventType: "delivery_observation_write_error",
      level: "WARN",
      data: safeLearningErrorData(error)
    });
  });

  broadcast(ctx.sessionId, {
    type: "delivery_observation",
    session_id: ctx.sessionId,
    guidanceId: suggestion.guidanceId,
    seq: turnSeq,
    at,
    suggestion: observation.suggestedExcerpt,
    actual: observation.actualExcerpt,
    feedbackStatus: observation.feedbackStatus === "accepted" ? "accepted" : "unmarked",
    comparison: {
      classification: observation.comparison.classification,
      similarity: observation.comparison.similarity,
      lengthRatio: observation.comparison.lengthRatio,
      note: observation.comparison.differences.join(" ").slice(0, 420)
    },
    observationCount: ctx.deliveryStyleObservations.length
  });
  return feedback?.status === "accepted" ||
    observation.comparison.classification === "exact"
    ? "guidance_accepted"
    : "guidance_changed";
}

const app = express();
const guidanceFeedbackStore = new GuidanceFeedbackStoreV2();
const sessions = new Map<string, SessionCtx>();
const socketsBySession = new Map<string, Set<any>>();
let totalWsConnections = 0;
const wsConnectionsByIp = new Map<string, number>();
const slowStyleLearner = new SlowStyleLearnerV2({
  directory: CONFIG.sessionLogDir,
  upsert: upsertMemoryFacts
});
const speakerService = createSpeakerServiceClient({
  // Local development needs no repeated setup; Docker overrides this with the
  // private service hostname on the Compose network.
  baseUrl: process.env.SPEAKER_SERVICE_URL ?? "http://127.0.0.1:8791"
});
const coachingCorpusState = loadReviewedCoachingCorpora(
  CONFIG.coachingCorpusPaths,
  CONFIG.coachingSourceManifestPath
)
  .then((examples) => ({ examples, error: null as string | null }))
  .catch((error: unknown) => ({
    examples: [] as CoachingExample[],
    error: error instanceof Error ? error.message.slice(0, 200) : "coaching_corpus_load_failed"
  }));
const googleOpenAIClient = getOpenAIClient();
const googleRuntimeConfigured = Boolean(
  CONFIG.googleClientId &&
  CONFIG.googleClientSecret &&
  CONFIG.googleRedirectUri &&
  CONFIG.googleStorageEncryptionKey.length >= 32 &&
  googleOpenAIClient
);
const googleUnavailableReason = !googleOpenAIClient
  ? "openai_not_configured"
  : !(CONFIG.googleClientId && CONFIG.googleClientSecret && CONFIG.googleRedirectUri)
    ? "google_oauth_not_configured"
    : CONFIG.googleStorageEncryptionKey.length < 32
      ? "google_storage_encryption_key_not_configured"
      : "google_memory_not_configured";
const googleSync = googleRuntimeConfigured && googleOpenAIClient
  ? new GoogleMemorySync(
    {
      clientId: CONFIG.googleClientId,
      clientSecret: CONFIG.googleClientSecret,
      redirectUri: CONFIG.googleRedirectUri,
      storageDir: CONFIG.googleSyncDir,
      storageEncryptionKey: CONFIG.googleStorageEncryptionKey,
      batchSize: CONFIG.googleSyncBatchSize,
      maxPagesPerRun: CONFIG.googleSyncMaxPages,
      intervalMs: CONFIG.googleSyncIntervalMs,
      requestTimeoutMs: CONFIG.googleRequestTimeoutMs,
      maxJsonResponseBytes: CONFIG.googleMaxJsonResponseBytes,
      maxTextResponseBytes: CONFIG.googleMaxTextResponseBytes,
      maxExtractionsPerRun: CONFIG.googleMaxExtractionsPerRun,
      dailyExtractionBudget: CONFIG.googleDailyExtractionBudget,
      maxCachedSources: CONFIG.googleMaxCachedSources,
      gmailQuery: CONFIG.googleGmailQuery,
      driveQuery: CONFIG.googleDriveQuery || undefined
    },
    new OpenAIGoogleMemoryExtractor(googleOpenAIClient, {
      model: CONFIG.openaiDeepModel,
      safetyIdentifier: openAISafetyIdentifier("personal", "google-memory-sync"),
      timeoutMs: Math.max(CONFIG.openaiRequestTimeoutMs, 15_000),
      onUsage: async (usage) => {
        await logTokenUsage({
          tenantId: "personal",
          repId: "owner",
          sessionId: "google-memory-sync",
          service: "google_memory_extractor",
          ...usage
        });
      }
    }),
    async (facts, sourceRef) => {
      await replaceGoogleSourceFacts(
        sourceRef,
        toPersonalMemoryInputs(facts) as MemoryFactInput[]
      );
    }
  )
  : null;
app.disable("x-powered-by");
if (CONFIG.trustProxy) app.set("trust proxy", 1);
app.use(requestContext);
app.use(applySecurityHeaders);
if (CONFIG.compressionEnabled) app.use(compression());
app.use(express.json({ limit: "256kb" }));
app.use(cors({
  origin: CONFIG.webOrigin,
  credentials: true,
  maxAge: 86400 // cache preflight for 24h
}));

// Serialize every state-changing HTTP handler against owner deletion. The
// OAuth callback is a GET but writes the encrypted token, so it joins the gate.
app.use((req, res, next) => {
  if (!isPrivateMutationRequest(req) || isPrivatePurgeRequest(req)) return next();
  if (privateDataPurgeActive) {
    return sendErr(res, 409, "private_data_purge_in_progress");
  }
  return next();
});

const authRateLimit = createRouteRateLimit({
  key: "auth_login",
  max: 10,
  windowMs: 60_000,
  keySelector: (req) => req.ip ?? "unknown_ip"
});

const telemetryRateLimit = createRouteRateLimit({
  key: "ui_event",
  max: 120,
  windowMs: 60_000,
  keySelector: (req) => req.auth?.tenantId ?? req.ip ?? "unknown_ip"
});

function sendOk<T>(res: express.Response, payload?: T, status = 200) {
  if (payload === undefined) return res.status(status).json({ ok: true });
  return res.status(status).json({ ok: true, ...payload });
}

function sendErr(res: express.Response, status: number, error: string, message?: string, detail?: unknown) {
  return res.status(status).json({ ok: false, error, message, detail });
}

function assertTenantAccess(req: express.Request, tenantId: string): boolean {
  if (!req.auth) return false;
  return req.auth.tenantId === tenantId;
}

function asyncRoute<T extends express.Request>(
  fn: (req: T, res: express.Response) => Promise<unknown>
) {
  return (req: T, res: express.Response, next: express.NextFunction) => {
    const operation = isPrivateMutationRequest(req) && !isPrivatePurgeRequest(req)
      ? trackPrivateMutationOperation(() => Promise.resolve(fn(req, res)))
      : Promise.resolve(fn(req, res));
    operation.catch(next);
  };
}

app.get("/health", asyncRoute(async (_req, res) => {
  const dbOk = await pingDb();
  const status = dbOk || !CONFIG.databaseRequired ? 200 : 503;
  return res.status(status).json({
    ok: status === 200,
    status: dbOk ? "healthy" : CONFIG.databaseRequired ? "unhealthy" : "degraded"
  });
}));

const TranscriptFinalInput = z.object({
  session_id: z.string().min(1),
  text: z.string().min(1).max(2000),
  speaker: z.enum(["rep", "lead", "unknown"]).optional(),
  source: z.enum(["rep", "lead"]).optional(),
  captureProvenance: z.enum([
    "dedicated_owner_mic",
    "dedicated_browser_tab",
    "verified_owner_voice",
    "directional_inference",
    "manual_label",
    "unverified"
  ]).optional(),
  attributionConfidence: z.number().min(0).max(1).optional(),
  attributionReason: z.string().regex(/^[a-z0-9_:-]+$/i).max(100).optional(),
  deviceRole: z.enum(["audio_host", "companion"]).optional(),
  profile: SessionProfileInput.optional(),
  productContext: z.object({
    productName: z.string().max(200).optional(),
    differentiators: z.string().max(2000).optional(),
    competitors: z.string().max(1000).optional(),
    targetIndustry: z.string().max(200).optional(),
    commonObjections: z.string().max(2000).optional(),
  }).optional()
}).strict();

/* ── Personal-owner auth bootstrap and login ───────────────── */
app.get("/api/auth/bootstrap", (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (!CONFIG.authAutoBootstrapped || !isDirectLoopbackRequest({
    remoteAddress: req.socket.remoteAddress,
    forwarded: req.headers.forwarded,
    xForwardedFor: req.headers["x-forwarded-for"],
    xRealIp: req.headers["x-real-ip"],
    via: req.headers.via
  })) {
    return sendErr(res, 403, "bootstrap_access_denied");
  }
  return sendOk(res, {
    accessCode: CONFIG.personalAccessCode,
    purpose: "pair_trusted_owner_device"
  });
});

app.post("/api/auth/login", authRateLimit, (req, res) => {
  const parsed = PersonalLoginInputSchema.safeParse(req.body);
  if (!parsed.success) return sendErr(res, 400, "validation_error", "Invalid login request", parsed.error.flatten());
  const admission = authorizePersonalLogin({
    policy: currentAuthRuntimePolicy(),
    configuredAccessCode: CONFIG.personalAccessCode,
    candidateAccessCode: parsed.data.accessCode
  });
  if (!admission.ok) {
    return sendErr(res, admission.status, admission.code, admission.message);
  }
  if (admission.mode === "demo") {
    return sendOk(res, { token: "demo-mode", mode: "demo", expiresIn: CONFIG.authTokenTtl });
  }
  const token = signToken(admission.identity);
  return sendOk(res, { token, mode: "jwt", expiresIn: CONFIG.authTokenTtl });
});

const runtimeEventRateLimit = createRouteRateLimit({
  key: "runtime_event",
  max: 600,
  windowMs: 60_000,
  keySelector: (req) => req.auth?.repId ?? req.ip ?? "unknown_user"
});

app.post("/api/runtime/events", requireAuth, runtimeEventRateLimit, asyncRoute(async (req, res) => {
  let event: ReturnType<typeof parseRuntimeEventV2>;
  try {
    event = parseRuntimeEventV2(req.body);
  } catch {
    return sendErr(res, 400, "invalid_runtime_event");
  }
  const ctx = sessions.get(event.sessionId);
  if (!ctx) return sendErr(res, 404, "unknown_session");
  if (!assertTenantAccess(req, ctx.tenantId)) {
    return sendErr(res, 403, "forbidden", "Tenant mismatch");
  }

  const previousInterruptionId = ctx.runtimeState.lastInterruption?.eventId;
  ctx.runtimeState = reduceConversationStateV2(ctx.runtimeState, event);
  ctx.lastActivity = Date.now();
  if (event.payload.type === "speech.started") {
    ctx.guidance.cancel(`${event.payload.speaker}_speech_started`);
  }
  const interruption = ctx.runtimeState.lastInterruption;
  if (interruption && interruption.eventId !== previousInterruptionId) {
    broadcast(ctx.sessionId, {
      type: "interruption_detected",
      session_id: ctx.sessionId,
      at: interruption.detectedAt,
      interruptedTurnId: interruption.interruptedTurnId,
      interruptingTurnId: interruption.interruptingTurnId
    });
  }
  return sendOk(res, {
    accepted: true,
    overlapActive: ctx.runtimeState.overlapActive
  });
}));

app.post("/api/demo/transcript_final", requireAuth, rateLimitCoaching, asyncRoute(async (req, res) => {
  const parsed = TranscriptFinalInput.safeParse(req.body);
  if (!parsed.success) return sendErr(res, 400, "validation_error", "Invalid transcript payload", parsed.error.flatten());

  const {
    session_id,
    text,
    speaker,
    source,
    profile,
    productContext,
    captureProvenance,
    attributionConfidence,
    attributionReason
  } = parsed.data;
  const ctx = sessions.get(session_id);
  if (!ctx) return sendErr(res, 404, "unknown_session");
  if (!assertTenantAccess(req, ctx.tenantId)) return sendErr(res, 403, "forbidden", "Tenant mismatch");

  const transcriptSpeaker: Speaker = source ?? speaker ?? ctx.speaker;
  ctx.speaker = transcriptSpeaker;
  ctx.profile = mergeSessionProfile(ctx.profile, profile);
  if (productContext) ctx.productContext = productContext;
  void trackPrivateDataTask(ctx.dataEpoch, () => onTranscriptFinal(ctx, text, transcriptSpeaker, {
      captureProvenance,
      attributionConfidence,
      attributionReason
    }))
    .catch(() => {});
  return sendOk(res);
}));

const UiEventInput = z.object({
  tenantId: z.string().min(1),
  repId: z.string().min(1),
  sessionId: z.string().min(1),
  eventType: z.enum([
    "suggestion_shown",
    "suggestion_applied",
    "suggestion_dismissed",
    "mute_on",
    "mute_off",
    "undo",
    "patch_received",
    "patch_rejected"
  ]),
  data: z.record(z.any()).optional()
}).strict();
const UiGuidanceEventData = z.object({
  guidanceId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,239}$/)
}).strict();

app.post("/api/ui-event", requireAuth, telemetryRateLimit, asyncRoute(async (req, res) => {
  const parsed = UiEventInput.safeParse(req.body);
  if (!parsed.success) return sendErr(res, 400, "validation_error", "Invalid UI event payload", parsed.error.flatten());

  const e = parsed.data;
  if (!assertTenantAccess(req, e.tenantId)) return sendErr(res, 403, "forbidden", "Tenant mismatch");
  if (req.auth?.repId !== e.repId) return sendErr(res, 403, "forbidden", "Owner mismatch");
  const session = sessions.get(e.sessionId);
  if (!session || session.tenantId !== e.tenantId || session.repId !== e.repId) {
    return sendErr(res, 404, "unknown_session");
  }

  // Hard guard: block obvious transcript leakage fields
  const dataStr = JSON.stringify(e.data ?? {});
  if (/transcript|utterance|raw_text|full_text/i.test(dataStr)) {
    return sendErr(res, 400, "ui_event_contains_disallowed_fields");
  }
  if (
    e.eventType === "suggestion_shown" ||
    e.eventType === "suggestion_applied" ||
    e.eventType === "suggestion_dismissed"
  ) {
    const guidance = UiGuidanceEventData.safeParse(e.data);
    if (!guidance.success) return sendErr(res, 400, "guidance_id_required");
    if (e.eventType === "suggestion_applied" || e.eventType === "suggestion_dismissed") {
      const marked = guidanceFeedbackStore.mark({
        sessionId: e.sessionId,
        guidanceId: guidance.data.guidanceId,
        status: e.eventType === "suggestion_applied" ? "accepted" : "ignored"
      });
      if (!marked) return sendErr(res, 409, "stale_guidance_feedback");
      if (
        e.eventType === "suggestion_dismissed" &&
        session.guidance.currentGuidanceId === guidance.data.guidanceId
      ) {
        session.guidance.cancel("owner_dismissed");
      }
    }
  }
  if (e.eventType === "mute_on" || e.eventType === "mute_off") {
    session.controls.guidanceMuted = e.eventType === "mute_on";
    if (session.controls.guidanceMuted) session.guidance.cancel("owner_muted_guidance");
  }

  await emitLog({
    tenantId: e.tenantId,
    repId: e.repId,
    session_id: e.sessionId,
    service: "web",
    eventType: e.eventType,
    data: e.data ?? {}
  });

  return sendOk(res);
}));

app.get("/api/trust/summary", requireAuth, asyncRoute(async (req, res) => {
  const tenantId = String(req.query.tenantId ?? "");
  if (!tenantId) return sendErr(res, 400, "tenantId_required");
  if (!assertTenantAccess(req, tenantId)) return sendErr(res, 403, "forbidden", "Tenant mismatch");
  const summary = await getTrustSummaryForTenant(tenantId);
  return sendOk(res, { summary });
}));

const server = http.createServer(app);
const wss = new WebSocketServer({
  server,
  path: CONFIG.wsPath,
  maxPayload: 64 * 1024,
  verifyClient: ({ origin }, done) => {
    if (isAllowedWebSocketOrigin(origin, CONFIG.webOrigin)) done(true);
    else done(false, 403, "origin_not_allowed");
  }
});

function closeSocketsForPurge(sockets: Set<any>, reason: string): void {
  for (const socket of sockets) {
    try { socket.close(1000, reason); } catch { /* best-effort connection cleanup */ }
  }
}

const realtimeTokenRateLimit = createRouteRateLimit({
  key: "realtime_token",
  max: 30,
  windowMs: 60_000,
  keySelector: (req) => req.auth?.repId ?? req.ip ?? "unknown_user"
});

const RealtimeTokenInput = z.object({
  session_id: z.string().min(1).max(200),
  source: z.enum(["rep", "lead"])
}).strict();

app.post("/api/realtime/token", requireAuth, realtimeTokenRateLimit, asyncRoute(async (req, res) => {
  const parsed = RealtimeTokenInput.safeParse(req.body);
  if (!parsed.success) {
    return sendErr(res, 400, "validation_error", "Invalid Realtime token request", parsed.error.flatten());
  }
  if (!CONFIG.openaiApiKey) {
    return sendErr(res, 503, "openai_not_configured", "Realtime transcription requires an OpenAI API key");
  }

  const ctx = sessions.get(parsed.data.session_id);
  if (!ctx) return sendErr(res, 404, "unknown_session", "Start the session before opening audio channels");
  if (!assertTenantAccess(req, ctx.tenantId)) return sendErr(res, 403, "forbidden", "Tenant mismatch");

  const secret = await createRealtimeTranscriptionClientSecret({
    source: parsed.data.source,
    safetyIdentifier: openAISafetyIdentifier(ctx.tenantId, ctx.repId)
  });
  emitLog({
    tenantId: ctx.tenantId,
    repId: ctx.repId,
    session_id: ctx.sessionId,
    service: "server",
    eventType: "realtime_client_secret_created",
    data: {
      source: parsed.data.source,
      model: CONFIG.openaiTranscriptionModel,
      expiresAt: secret.expiresAt
    }
  });

  return sendOk(res, {
    value: secret.value,
    expiresAt: secret.expiresAt,
    session: {
      type: "transcription",
      source: parsed.data.source,
      model: CONFIG.openaiTranscriptionModel
    }
  });
}));

const MemoryUpsertInput = z.object({
  facts: z.array(MemoryFactInputSchema).min(1).max(100)
}).strict();

const MemorySearchQuery = z.object({
  q: z.string().max(4000).optional().default(""),
  mode: z.enum(SCENARIO_MODES_V1).optional().default("general"),
  targetRole: z.string().max(300).optional(),
  company: z.string().max(300).optional(),
  goal: z.string().max(1500).optional(),
  preContext: z.string().max(5000).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional().default(12)
});
const ArchiveSearchQuery = z.object({
  q: z.string().trim().min(2).max(500),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20)
});
const archiveSearchRateLimit = createRouteRateLimit({
  key: "archive_search",
  max: 60,
  windowMs: 60_000,
  keySelector: (req) => req.auth?.repId ?? req.ip ?? "unknown_user"
});

app.get("/api/memory/stats", requireAuth, asyncRoute(async (_req, res) => {
  return sendOk(res, { stats: await getMemoryStats() });
}));

app.get("/api/memory/facts", requireAuth, asyncRoute(async (req, res) => {
  const memory = await readMemoryFile();
  const includeRestricted = req.query.includeRestricted === "true" && req.auth?.role === "admin";
  const category = typeof req.query.category === "string" ? req.query.category : "";
  const facts = memory.facts.filter((fact) =>
    (includeRestricted || fact.sensitivity !== "restricted") &&
    (!category || fact.category === category)
  );
  return sendOk(res, { facts, total: facts.length });
}));

app.get("/api/memory/search", requireAuth, asyncRoute(async (req, res) => {
  const parsed = MemorySearchQuery.safeParse(req.query);
  if (!parsed.success) {
    return sendErr(res, 400, "validation_error", "Invalid memory search", parsed.error.flatten());
  }
  const { q, limit, ...profile } = parsed.data;
  const facts = await retrieveMemoryFacts({ query: q, profile, limit });
  return sendOk(res, { facts, total: facts.length });
}));

app.get("/api/archive/search", requireAuth, archiveSearchRateLimit, asyncRoute(async (req, res) => {
  if (privateDataPurgeActive) {
    return sendErr(res, 409, "private_data_purge_in_progress");
  }
  const parsed = ArchiveSearchQuery.safeParse(req.query);
  if (!parsed.success) {
    return sendErr(res, 400, "validation_error", "Invalid archive search", parsed.error.flatten());
  }
  const results = await searchSessionTurns({
    query: parsed.data.q,
    limit: parsed.data.limit
  });
  return sendOk(res, { results, total: results.length });
}));

app.post("/api/memory/facts", requireAuth, asyncRoute(async (req, res) => {
  const parsed = MemoryUpsertInput.safeParse(req.body);
  if (!parsed.success) {
    return sendErr(res, 400, "validation_error", "Invalid memory facts", parsed.error.flatten());
  }
  const result = await upsertMemoryFacts(parsed.data.facts);
  return sendOk(res, { result }, 201);
}));

app.delete("/api/memory/facts/:id", requireAuth, asyncRoute(async (req, res) => {
  const parsed = z.string().min(1).max(240).safeParse(req.params.id);
  if (!parsed.success) return sendErr(res, 400, "validation_error", "Invalid memory fact ID");
  const result = await deleteMemoryFact(parsed.data);
  return result.removed
    ? sendOk(res, { result })
    : sendErr(res, 404, "memory_fact_not_found");
}));

const speakerEnrollmentRateLimit = createRouteRateLimit({
  key: "speaker_enrollment",
  max: 12,
  windowMs: 60 * 60_000,
  keySelector: (req) => req.auth?.repId ?? req.ip ?? "unknown_user"
});

const speakerClassificationRateLimit = createRouteRateLimit({
  key: "speaker_classification",
  max: 120,
  windowMs: 60_000,
  keySelector: (req) => req.auth?.repId ?? req.ip ?? "unknown_user"
});

const speakerWavBody = express.raw({
  type: ["audio/wav", "audio/x-wav"],
  limit: speakerService.maxAudioBytes
});

function speakerAudio(req: express.Request, res: express.Response): Uint8Array | null {
  if (!Buffer.isBuffer(req.body)) {
    sendErr(res, 415, "audio_wav_required", "Send a PCM WAV body with Content-Type: audio/wav");
    return null;
  }
  return new Uint8Array(req.body.buffer, req.body.byteOffset, req.body.byteLength);
}

function sendSpeakerError(res: express.Response, error: unknown) {
  if (error instanceof SpeakerServiceError) {
    return sendErr(res, error.status ?? 502, "speaker_service_error", error.message);
  }
  return sendErr(res, 502, "speaker_service_error", "Speaker verification is unavailable");
}

app.get("/api/speaker/health", requireAuth, asyncRoute(async (_req, res) => {
  return sendOk(res, await speakerService.health());
}));

app.post(
  "/api/speaker/enroll",
  requireAuth,
  speakerEnrollmentRateLimit,
  speakerWavBody,
  asyncRoute(async (req, res) => {
    const audio = speakerAudio(req, res);
    if (!audio) return;
    try {
      return sendOk(res, await speakerService.enroll(audio));
    } catch (error) {
      return sendSpeakerError(res, error);
    }
  })
);

app.post(
  "/api/speaker/classify",
  requireAuth,
  speakerClassificationRateLimit,
  speakerWavBody,
  asyncRoute(async (req, res) => {
    const audio = speakerAudio(req, res);
    if (!audio) return;
    return sendOk(res, await speakerService.classify(audio));
  })
);

const googleConnectedRedirect = CONFIG.webOrigin === "*"
  ? "/?google=connected"
  : `${CONFIG.webOrigin.replace(/\/$/, "")}/?google=connected`;

if (googleSync) {
  app.use("/api/google", createGoogleSyncRouter(googleSync, {
    protect: requireAuth,
    successRedirect: googleConnectedRedirect,
    runOperation: trackPrivateMutationOperation
  }));
} else {
  app.get("/api/google/status", requireAuth, (_req, res) => {
    return res.json({
      configured: false,
      authorized: false,
      reason: googleUnavailableReason
    });
  });
  app.post("/api/google/oauth/start", requireAuth, (_req, res) => {
    return sendErr(
      res,
      503,
      googleUnavailableReason,
      googleUnavailableReason === "openai_not_configured"
        ? "Google memory extraction requires the server-side OpenAI key"
        : googleUnavailableReason === "google_storage_encryption_key_not_configured"
          ? "Set a dedicated GOOGLE_STORAGE_ENCRYPTION_KEY for environment-managed authentication, then restart the server"
          : "Set the one-time Google OAuth client values, then restart the server"
    );
  });
  app.get("/api/google/oauth/callback", (_req, res) => {
    return sendErr(res, 503, "google_oauth_not_configured");
  });
  app.post("/api/google/sync", requireAuth, (_req, res) => {
    return sendErr(res, 503, "google_oauth_not_configured");
  });
}

app.get("/api/runtime/status", requireAuth, asyncRoute(async (_req, res) => {
  const [memory, voice, google, coaching] = await Promise.all([
    getMemoryStats(),
    speakerService.health(),
    googleSync?.status() ?? Promise.resolve({
      configured: false,
      authorized: false,
      cachedSources: 0,
      pendingExtraction: 0,
      extractionBudget: {
        day: new Date().toISOString().slice(0, 10),
        used: 0,
        dailyLimit: CONFIG.googleDailyExtractionBudget,
        perRunLimit: CONFIG.googleMaxExtractionsPerRun
      },
      sourceCapacity: {
        used: 0,
        limit: CONFIG.googleMaxCachedSources,
        full: false
      },
      state: null
    }),
    coachingCorpusState
  ]);
  const googleState = google.state;
  const gmailLastSyncAt = googleState?.gmail?.lastSyncAt;
  const driveLastSyncAt = googleState?.drive?.lastSyncAt;
  const lastSyncAt = [gmailLastSyncAt, driveLastSyncAt]
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1);

  return sendOk(res, {
    automation: {
      apiKey: {
        configured: Boolean(CONFIG.openaiApiKey),
        serverOnly: true,
        liveModel: CONFIG.openaiModel,
        transcriptionModel: CONFIG.openaiTranscriptionModel
      },
      memory: {
        ...memory,
        automaticRetrieval: true
      },
      coachingKnowledge: {
        ...coachingCorpusStats(coaching.examples),
        loaded: coaching.examples.length > 0,
        automaticRetrieval: true,
        separateFromPersonalMemory: true,
        ...(coaching.error ? { error: coaching.error } : {})
      },
      transcripts: {
        automaticCapture: true,
        automaticLearning: true,
        learningIntervalTurns: CONVERSATION_LEARNING_TURN_INTERVAL,
        automaticDeliveryComparison: true,
        automaticSpeakingStyleLearning: true,
        deliveryLearningMinimumPairs: MIN_STYLE_OBSERVATIONS_V2
      },
      google: {
        configured: google.configured,
        authorized: google.authorized,
        cachedSources: google.cachedSources,
        pendingExtraction: google.pendingExtraction,
        extractionBudget: google.extractionBudget,
        sourceCapacity: google.sourceCapacity,
        lastSyncAt
      },
      voice: {
        ...voice,
        automaticEnrollment: true,
        rawAudioStored: false,
        primaryIdentity: "separate_channels"
      }
    }
  });
}));

const PrivateDataPurgeInput = z.object({
  confirmation: z.literal("ERASE MY PRIVATE DATA"),
  scopes: z.array(z.enum(["all", "memory", "transcripts", "google", "voice", "database"]))
    .min(1)
    .max(6)
}).strict();

app.delete("/api/private-data", requireAuth, asyncRoute(async (req, res) => {
  const parsed = PrivateDataPurgeInput.safeParse(req.body);
  if (!parsed.success) {
    return sendErr(
      res,
      400,
      "purge_confirmation_required",
      "Type ERASE MY PRIVATE DATA and choose at least one scope"
    );
  }
  if (privateDataPurgeActive) {
    return sendErr(res, 409, "private_data_purge_in_progress");
  }

  privateDataPurgeActive = true;
  privateDataEpoch += 1;
  const scopes = new Set(parsed.data.scopes);
  const all = scopes.has("all");
  const result: Record<string, unknown> = {};
  const warnings: string[] = [];
  const activeSockets = new Set([...socketsBySession.values()].flatMap((items) => [...items]));
  for (const session of sessions.values()) session.guidance.cancel("private_data_purge");
  sessions.clear();
  socketsBySession.clear();
  result.pendingGuidanceFeedback = guidanceFeedbackStore.clearAll();
  closeSocketsForPurge(activeSockets, "owner_private_data_purge");

  try {
    result.discardedTelemetry = await beginObsDataPurge();
    await drainPrivateMutationRequests();
    await drainPrivateDataTasks();
    discardPendingObsEvents();

    const purgeGoogle = all || scopes.has("google") || scopes.has("memory");
    if (scopes.has("memory") && !all && !scopes.has("google")) {
      result.googleIncludedWithMemory = true;
    }
    if (purgeGoogle) {
      try {
        // Remove derived facts even when OAuth is currently unconfigured.
        result.googleMemory = await clearGoogleMemoryFacts();
      } catch {
        warnings.push("google_derived_memory_cleanup_incomplete");
      }
      if (googleSync) {
        try {
          const googlePurge = await googleSync.purgeLocalData();
          result.google = googlePurge;
          warnings.push(...googlePurge.warnings);
          if (!googlePurge.localCleanupComplete) {
            warnings.push("google_local_cleanup_incomplete");
          }
        } catch {
          warnings.push("google_local_cleanup_incomplete");
        }
      } else {
        try {
          await fs.rm(CONFIG.googleSyncDir, { recursive: true, force: true });
          result.google = { removedSources: 0, removedUnconfiguredStore: true };
        } catch {
          warnings.push("google_local_cleanup_incomplete");
        }
      }
    }

    if (all || scopes.has("voice")) {
      try {
        result.voice = await speakerService.deleteEnrollment();
      } catch {
        warnings.push("voice_service_unavailable_profile_may_remain");
      }
    }

    if (all || scopes.has("memory")) {
      try {
        result.memory = await clearMemoryFile();
      } catch {
        warnings.push("memory_file_cleanup_incomplete");
      }
    }
    if (all || scopes.has("transcripts")) {
      try {
        result.transcripts = await clearSessionLogs();
      } catch {
        warnings.push("transcript_file_cleanup_incomplete");
      }
    }

    if (all || scopes.has("database")) {
      try {
        result.database = await purgeAllRuntimeDatabaseData();
      } catch {
        warnings.push("database_unavailable_metadata_may_remain");
      }
      result.inMemoryUsageEntries = clearAllTokenUsage();
    }
    clearAllRateLimits();
    discardPendingObsEvents();

    if (all) {
      if (CONFIG.authAutoBootstrapped) {
        const rotated = rotateManagedPersonalAuth(
          CONFIG.personalAuthStatePath,
          { rotateStorageEncryptionKey: true }
        );
        CONFIG.jwtSecret = rotated.jwtSecret;
        CONFIG.personalAccessCode = rotated.personalAccessCode;
        CONFIG.googleStorageEncryptionKey = rotated.storageEncryptionKey;
        CONFIG.privateStorageEncryptionKey = rotated.storageEncryptionKey;
        googleSync?.rotateStorageEncryptionKey(rotated.storageEncryptionKey);
        result.auth = { rotated: true, storageEncryptionKeyRotated: true };
      } else {
        result.localManagedAuthArtifacts = clearManagedPersonalAuthArtifacts(
          CONFIG.personalAuthStatePath,
          { removeCanonical: true }
        );
        warnings.push("environment_managed_auth_not_rotated");
      }
    }

    return sendOk(res, {
      purged: [...scopes],
      result,
      warnings: [...new Set(warnings)]
    });
  } finally {
    endObsDataPurge();
    privateDataPurgeActive = false;
  }
}));

function safeJsonParse(s: string): any | null {
  try { return JSON.parse(s); } catch { return null; }
}

function broadcast(sessionId: string, msg: WsServerMessageV1) {
  const set = socketsBySession.get(sessionId);
  if (!set) return;
  // Pre-serialize once for all sockets (avoids repeated JSON.stringify)
  const payload = JSON.stringify(msg);
  for (const ws of set) {
    if (ws.readyState === ws.OPEN) ws.send(payload);
  }
}

function sendCoachingPatch(
  ctx: SessionCtx,
  text: string,
  at: string,
  guidanceId: string,
  coaching: Omit<
    NonNullable<Extract<WsServerMessageV1, { type: "overlay_message" }>["coaching"]>,
    "guidanceId" | "feedbackStatus"
  >
): boolean {
  const sanitized = sanitizePatch_v1({ text });
  if (!sanitized.ok) {
    emitLog({
      tenantId: ctx.tenantId,
      repId: ctx.repId,
      session_id: ctx.sessionId,
      service: "server",
      eventType: "patch_rejected",
      data: {
        reason: sanitized.reason,
        detailSafe: sanitized.detailSafe,
        bytes: sanitized.bytes
      }
    });
    const fail: OverlayMessageV1 = {
      type: "settings",
      settings: {
        controls: ctx.controls,
        status: { failureCode: "patch_rejected" }
      }
    };
    broadcast(ctx.sessionId, {
      type: "overlay_message",
      session_id: ctx.sessionId,
      at,
      message: fail
    });
    return false;
  }

  emitLog({
    tenantId: ctx.tenantId,
    repId: ctx.repId,
    session_id: ctx.sessionId,
    service: "server",
    eventType: "patch_received",
    data: {
      bytes: sanitized.bytes,
      phase: coaching.phase,
      latencyMs: coaching.latencyMs,
      aiGenerated: coaching.aiGenerated
    }
  });

  const deliveryCoaching: NonNullable<
    Extract<WsServerMessageV1, { type: "overlay_message" }>["coaching"]
  > = {
    ...coaching,
    guidanceId,
    feedbackStatus: "unmarked"
  };
  const delivery: Extract<WsServerMessageV1, { type: "overlay_message" }> = {
    type: "overlay_message",
    session_id: ctx.sessionId,
    at,
    message: { type: "patch", patch: sanitized.patch },
    coaching: deliveryCoaching
  };
  ctx.lastCoachingMessage = delivery;
  guidanceFeedbackStore.register({
    sessionId: ctx.sessionId,
    guidanceId,
    basedOnTurnSeq: ctx.latestLeadSeq
  });
  if (coaching.playbookStageId) {
    ctx.activePlaybookStageId = coaching.playbookStageId as ConversationPlaybookStageIdV1;
  }
  if (coaching.phase === "final" && typeof sanitized.patch.text === "string") {
    ctx.pendingFinalSuggestion = {
      guidanceId,
      text: sanitized.patch.text,
      leadSeq: ctx.latestLeadSeq,
      at
    };
  }
  broadcast(ctx.sessionId, delivery);
  return true;
}

function exactPlaybookLine(say: string): string {
  const trimmed = say.trim().replace(/^say\s*:\s*/i, "");
  return `Say: “${trimmed.replace(/^[“\"]|[”\"]$/g, "")}”`;
}

function guidanceIsDisabled(ctx: SessionCtx): boolean {
  return ctx.controls.guidanceMuted || ctx.controls.guidanceMode === "off";
}

/**
 * onTranscriptFinal — the HOT PATH.
 *
 * When OPENAI_API_KEY is set:
 *   → Uses GPT for contextual, specific coaching (async, ~200–800ms)
 *   → Falls back to a mode-specific, non-fabricated line if API fails
 *
 * When no API key:
 *   → Uses deterministic, mode-specific coaching (synchronous, <1ms)
 */
async function onTranscriptFinal(ctx: SessionCtx, text: string, speaker: Speaker, attribution: {
  captureProvenance?: CaptureProvenanceV1;
  attributionConfidence?: number;
  attributionReason?: string;
} = {}) {
  if (ctx.dataEpoch !== privateDataEpoch) return;
  ctx.seq += 1;
  ctx.lastActivity = Date.now();
  ctx.speaker = speaker;
  const turnSeq = ctx.seq;
  const now = new Date().toISOString();
  ctx.guidance.cancel("new_transcript_turn");

  // Keep a bounded prompt context and a private, local session record.
  ctx.conversationHistory.push({ speaker, text });
  if (ctx.conversationHistory.length > 24) {
    ctx.conversationHistory = ctx.conversationHistory.slice(-24);
  }
  void trackPrivateDataTask(ctx.dataEpoch, () => appendSessionTurn({
      sessionId: ctx.sessionId,
      speaker,
      text,
      at: now,
      mode: ctx.profile.mode,
      ...attribution
    }))
    .catch(() => {});
  scheduleConversationLearning(ctx);

  if (speaker === "rep" && ctx.activePlaybookStageId) {
    if (!ctx.completedPlaybookStageIds.includes(ctx.activePlaybookStageId)) {
      ctx.completedPlaybookStageIds.push(ctx.activePlaybookStageId);
    }
  }

  // ── 1. Build product-aware domain keywords ──
  const baseKeywords = ["security", "soc2", "crm", "integration"];
  const pc = ctx.productContext;
  if (pc) {
    if (pc.productName) baseKeywords.push(...pc.productName.toLowerCase().split(/\s+/));
    if (pc.differentiators) baseKeywords.push(...pc.differentiators.toLowerCase().split(/[,;\n]+/).map(s => s.trim()).filter(Boolean).slice(0, 10));
    if (pc.competitors) baseKeywords.push(...pc.competitors.toLowerCase().split(/[,;\n]+/).map(s => s.trim()).filter(Boolean).slice(0, 5));
    if (pc.targetIndustry) baseKeywords.push(...pc.targetIndustry.toLowerCase().split(/[,;\s]+/).filter(Boolean).slice(0, 3));
  }
  baseKeywords.push(
    ...[ctx.profile.targetRole, ctx.profile.company]
      .filter((value): value is string => Boolean(value))
      .flatMap((value) => value.toLowerCase().split(/[,;\s]+/).filter(Boolean).slice(0, 8))
  );

  // ── 2. Run arbitration (sync template fallback always computed) ──
  const decision = arbitrateV1({
    text,
    controls: ctx.controls,
    domainKeywords: baseKeywords,
    speaker
  });

  const transcriptHash = decision.trace.transcriptHash;

  // ── 3. Fire-and-forget: log receipt ──
  emitLog({
    tenantId: ctx.tenantId,
    repId: ctx.repId,
    session_id: ctx.sessionId,
    service: "server",
    eventType: "transcript_final_received",
    data: {
      transcriptHash,
      transcriptLen: text.length,
      speaker,
      ...attribution,
      mode: ctx.profile.mode,
      latencyMs: decision.trace.latencyMs,
      cacheHit: decision.trace.cacheHit,
      aiEnabled: isAiCoachEnabled()
    }
  });

  broadcast(ctx.sessionId, {
    type: "transcript_final",
    session_id: ctx.sessionId,
    seq: turnSeq,
    at: now,
    text,
    speaker,
    source: speaker,
    ...attribution
  });

  if (speaker === "rep") {
    const styleSource = recordDeliveryStyleObservation(ctx, text, turnSeq, now);
    void trackPrivateDataTask(ctx.dataEpoch, () => slowStyleLearner.observe({
      sessionId: ctx.sessionId,
      turnId: `turn-${turnSeq}`,
      text,
      source: styleSource
    })).catch((error: unknown) => {
      emitLog({
        tenantId: ctx.tenantId,
        repId: ctx.repId,
        session_id: ctx.sessionId,
        service: "slow_style_learning",
        eventType: "slow_style_observation_error",
        level: "WARN",
        data: safeLearningErrorData(error)
      });
    });
  }

  // Speaker identity is fail-closed: owner and unknown turns never trigger
  // coaching. `lead` comes from a dedicated remote track, an explicit manual
  // correction, or repeated calibrated direction in two-person acoustic mode.
  if (!shouldCoachSpeaker(speaker)) return;
  ctx.latestLeadSeq = turnSeq;
  if (guidanceIsDisabled(ctx)) return;

  const playbookStage = selectNextPlaybookStageV1(ctx.profile, {
    transcript: text,
    completedStageIds: ctx.completedPlaybookStageIds
  });
  const playbookFallback = exactPlaybookLine(playbookStage.say);
  const deterministicFallback = selectDeterministicGuidance(
    decision.items,
    playbookFallback
  );
  const guidanceLease = ctx.guidance.beginTurn(
    `turn-${turnSeq}`,
    CONFIG.coachingFinalDeadlineMs
  );
  const guidanceId = guidanceLease.guidanceId;

  // Give the user a deterministic line immediately while contextual coaching is
  // generated. This bypasses coalescing by design.
  sendCoachingPatch(ctx, getDeterministicCushion(ctx.profile.mode), now, guidanceId, {
    phase: "cushion",
    aiGenerated: false,
    category: "cushion",
    latencyMs: 0,
    memoryFactIds: []
  });

  let aiResult: Awaited<ReturnType<typeof getAiCoaching>> = null;
  const aiEnabled = isAiCoachEnabled();
  let provisionalTimer: ReturnType<typeof setTimeout> | undefined;

  if (aiEnabled) {
    provisionalTimer = setTimeout(() => {
      if (
        ctx.latestLeadSeq !== turnSeq ||
        !guidanceLease.canPublish() ||
        ctx.controls.guidanceMuted ||
        ctx.controls.guidanceMode === "off"
      ) return;
      sendCoachingPatch(
        ctx,
        deterministicFallback,
        new Date().toISOString(),
        guidanceId,
        {
          phase: "provisional",
          aiGenerated: false,
          category: "general",
          latencyMs: CONFIG.coachingProvisionalDelayMs,
          memoryFactIds: [],
          playbookStageId: playbookStage.id
        }
      );
    }, CONFIG.coachingProvisionalDelayMs);

    try {
      const coachingQuery = [
        text,
        ctx.profile.targetRole,
        ctx.profile.company,
        ctx.profile.goal,
        ...ctx.conversationHistory.slice(-5).map((turn) => turn.text)
      ].filter((value): value is string => Boolean(value)).join(" ");
      const [memoryFacts, coaching] = await Promise.all([
        retrieveMemoryFacts({
          query: coachingQuery,
          profile: ctx.profile
        }),
        coachingCorpusState
      ]);
      const coachingContext = coaching.examples.length
        ? buildStyleAwareCoachingContext(coaching.examples, {
          query: coachingQuery,
          domain: coachingDomainForMode(ctx.profile.mode),
          limit: CONFIG.coachingMaxPromptExamples,
          userStyleFacts: memoryFacts
            .filter((fact) => fact.category === "communication_style")
            .map((fact) => fact.fact)
        })
        : undefined;

      aiResult = await getAiCoaching({
        currentText: text,
        speaker,
        conversationHistory: ctx.conversationHistory.slice(0, -1),
        profile: ctx.profile,
        memoryFacts,
        coachingContext,
        productContext: ctx.productContext,
        tenantId: ctx.tenantId,
        repId: ctx.repId,
        sessionId: ctx.sessionId,
        signal: guidanceLease.signal
      });
    } catch (error: unknown) {
      emitLog({
        tenantId: ctx.tenantId,
        repId: ctx.repId,
        session_id: ctx.sessionId,
        service: "server",
        eventType: "memory_or_coaching_error",
        level: "WARN",
        data: { error: error instanceof Error ? error.message.slice(0, 200) : "unknown" }
      });
    }
  }

  if (provisionalTimer) clearTimeout(provisionalTimer);
  const guidanceStatus = guidanceLease.status();
  const staleOrCancelled =
    ctx.latestLeadSeq !== turnSeq ||
    guidanceStatus === "cancelled" ||
    guidanceStatus === "superseded";
  // Do not let slow or explicitly cancelled work replace current guidance.
  if (staleOrCancelled) {
    emitLog({
      tenantId: ctx.tenantId,
      repId: ctx.repId,
      session_id: ctx.sessionId,
      service: "server",
      eventType: "stale_coaching_dropped",
      data: { turnSeq, latestLeadSeq: ctx.latestLeadSeq, guidanceStatus }
    });
    return;
  }
  if (guidanceIsDisabled(ctx)) {
    ctx.guidance.cancel("guidance_disabled");
    return;
  }

  const finalAt = new Date().toISOString();
  if (guidanceStatus === "expired") {
    sendCoachingPatch(ctx, deterministicFallback, finalAt, guidanceId, {
      phase: "final",
      aiGenerated: false,
      category: "general",
      latencyMs: CONFIG.coachingFinalDeadlineMs,
      memoryFactIds: [],
      playbookStageId: playbookStage.id
    });
    emitLog({
      tenantId: ctx.tenantId,
      repId: ctx.repId,
      session_id: ctx.sessionId,
      service: "server",
      eventType: "guidance_deadline_fallback",
      data: { turnSeq, deadlineMs: CONFIG.coachingFinalDeadlineMs }
    });
    return;
  }

  const delivered = sendCoachingPatch(
    ctx,
    aiResult?.coaching ?? deterministicFallback,
    finalAt,
    guidanceId,
    {
      phase: "final",
      aiGenerated: Boolean(aiResult),
      category: aiResult?.category ?? "general",
      confidence: aiResult?.confidence,
      latencyMs: aiResult?.latencyMs ?? decision.trace.latencyMs,
      memoryFactIds: aiResult?.usedMemoryIds ?? [],
      playbookStageId: playbookStage.id
    }
  );
  if (delivered) ctx.guidance.complete(guidanceLease);
  else ctx.guidance.cancel("final_patch_rejected");
}

function startSttMock(ctx: SessionCtx) {
  if (!CONFIG.sttMock || ctx.mockStarted) return;
  ctx.mockStarted = true;
  const lines = [
    "Can you walk me through your decision process?",
    "We're concerned about SOC2 and data retention.",
    "Honestly this feels a bit expensive compared to what we have.",
    "Do you integrate with Salesforce and SSO?",
    "We already use a competitor — why switch?",
    "What are the next steps and who should be on the call?"
  ];
  let i = 0;
  const interval = setInterval(() => {
    if (!sessions.has(ctx.sessionId)) { clearInterval(interval); return; }
    const line = lines[i++ % lines.length];
    void trackPrivateDataTask(ctx.dataEpoch, () => onTranscriptFinal(ctx, line, "lead"))
      .catch(() => {});
  }, CONFIG.sttMockIntervalMs);
}

const WsStartInput = z.object({
  type: z.literal("start"),
  session_id: z.string().min(1).max(200),
  tenantId: z.string().min(1).max(100),
  repId: z.string().min(1).max(100),
  token: z.string().max(10_000).optional(),
  deviceRole: z.enum(["audio_host", "companion"]).optional().default("audio_host"),
  profile: SessionProfileInput.optional()
}).passthrough();

wss.on("connection", (ws, request) => {
  const forwarded = CONFIG.trustProxy ? request.headers["x-forwarded-for"] : undefined;
  const remoteIp = (Array.isArray(forwarded) ? forwarded[0] : forwarded?.split(",")[0])?.trim()
    || request.socket.remoteAddress
    || "unknown";
  totalWsConnections++;
  wsConnectionsByIp.set(remoteIp, (wsConnectionsByIp.get(remoteIp) ?? 0) + 1);

  // ── Connection limit guard ──
  if (
    totalWsConnections > CONFIG.maxWsConnections ||
    (wsConnectionsByIp.get(remoteIp) ?? 0) > CONFIG.maxWsConnectionsPerIp
  ) {
    ws.close(1013, "server_at_capacity");
    totalWsConnections--;
    const remaining = (wsConnectionsByIp.get(remoteIp) ?? 1) - 1;
    if (remaining > 0) wsConnectionsByIp.set(remoteIp, remaining);
    else wsConnectionsByIp.delete(remoteIp);
    return;
  }

  let started = false;
  let tokenExpiryTimer: ReturnType<typeof setTimeout> | undefined;
  const startDeadline = setTimeout(() => {
    if (!started) ws.close(1008, "authenticated_start_required");
  }, 5_000);

  ws.on("message", async (buf) => {
    const raw = safeJsonParse(String(buf));
    if (!raw || typeof raw.type !== "string") {
      if (!started) ws.close(1008, "invalid_start_message");
      return;
    }

    const type = raw.type as WsClientMessageV1["type"];

    if (!started && type !== "start") {
      ws.send(JSON.stringify({
        type: "error",
        at: new Date().toISOString(),
        message: "authenticated_start_required",
        code: "missing_auth_token"
      } satisfies WsServerMessageV1));
      ws.close(1008, "authenticated_start_required");
      return;
    }

    if (started && type === "start") {
      ws.close(1008, "duplicate_start");
      return;
    }

    if (type === "start") {
      if (privateDataPurgeActive) {
        ws.send(JSON.stringify({
          type: "error",
          at: new Date().toISOString(),
          message: "private_data_purge_in_progress",
          code: "forbidden"
        } satisfies WsServerMessageV1));
        ws.close(1013, "private_data_purge_in_progress");
        return;
      }
      const parsed = WsStartInput.safeParse(raw);
      if (!parsed.success) {
        ws.send(JSON.stringify({
          type: "error",
          at: new Date().toISOString(),
          message: "invalid_start_message",
          code: "validation_error"
        } satisfies WsServerMessageV1));
        ws.close(1008, "invalid_start_message");
        return;
      }
      const {
        session_id: sessionId,
        tenantId: requestedTenantId,
        repId: requestedRepId,
        token = "",
        deviceRole,
        profile
      } = parsed.data;

      const authAdmission = authorizeWebSocketStart({
        policy: currentAuthRuntimePolicy(),
        requestedTenantId,
        requestedRepId,
        token
      });
      if (!authAdmission.ok) {
        ws.send(JSON.stringify({
          type: "error",
          at: new Date().toISOString(),
          message: authAdmission.code,
          code: authAdmission.code
        } satisfies WsServerMessageV1));
        ws.close();
        return;
      }
      const { tenantId, repId } = authAdmission.identity;
      if (authAdmission.identity.exp) {
        const delay = authAdmission.identity.exp * 1000 - Date.now();
        tokenExpiryTimer = setTimeout(
          () => ws.close(1008, "auth_token_expired"),
          Math.max(1, Math.min(delay, 2_147_000_000))
        );
      }

      const existing = sessions.get(sessionId);
      if (existing && existing.tenantId !== tenantId) {
        ws.send(JSON.stringify({
          type: "error",
          at: new Date().toISOString(),
          session_id: sessionId,
          message: "session_identity_mismatch",
          code: "forbidden"
        } satisfies WsServerMessageV1));
        ws.close();
        return;
      }

      const ctx: SessionCtx = existing ?? {
        dataEpoch: privateDataEpoch,
        sessionId,
        tenantId,
        repId,
        controls: { ...DEFAULT_CONTROLS },
        seq: 0,
        speaker: "unknown",
        profile: { ...DEFAULT_SESSION_PROFILE_V1 },
        lastActivity: Date.now(),
        conversationHistory: [],
        runtimeState: initialConversationStateV2(sessionId),
        latestLeadSeq: 0,
        mockStarted: false,
        learningInFlight: false,
        lastLearnedSeq: 0,
        learningPending: false,
        learningPendingForce: false,
        completedPlaybookStageIds: [],
        guidance: new SessionGuidanceV2(),
        deliveryStyleObservations: []
      };
      // A companion joins the live session's existing brief; it must not replace
      // the audio host's mode/company/goal with stale phone-local defaults.
      if (!existing || deviceRole === "audio_host") {
        ctx.profile = mergeSessionProfile(ctx.profile, profile);
      }
      ctx.lastActivity = Date.now();

      sessions.set(sessionId, ctx);
      if (!socketsBySession.has(sessionId)) socketsBySession.set(sessionId, new Set());
      socketsBySession.get(sessionId)!.add(ws);
      started = true;
      clearTimeout(startDeadline);

      // Send ready + settings IMMEDIATELY — before any DB calls
      ws.send(JSON.stringify({
        type: "ready",
        session_id: sessionId,
        at: new Date().toISOString(),
        deviceRole: deviceRole as DeviceRoleV1,
        profile: ctx.profile
      } satisfies WsServerMessageV1));

      const settings: OverlayMessageV1 = { type: "settings", settings: { controls: ctx.controls } };
      ws.send(JSON.stringify({ type: "overlay_message", session_id: sessionId, at: new Date().toISOString(), message: settings } satisfies WsServerMessageV1));

      if (!existing) {
        const greeting = getInitialPlaybookStageV1(ctx.profile);
        sendCoachingPatch(
          ctx,
          exactPlaybookLine(greeting.say),
          new Date().toISOString(),
          `guidance-${randomUUID()}`,
          {
            phase: "final",
            aiGenerated: false,
            category: "opening",
            latencyMs: 0,
            memoryFactIds: [],
            playbookStageId: greeting.id
          }
        );
      } else if (ctx.lastCoachingMessage) {
        // A phone companion that joins mid-call should immediately see the same
        // exact line as the audio host instead of waiting for another turn.
        ws.send(JSON.stringify(ctx.lastCoachingMessage));
      }

      // Fire-and-forget: DB writes happen in background (never block the client)
      if (!existing) {
        void trackPrivateDataTask(
          ctx.dataEpoch,
          () => upsertSession({ sessionId, tenantId, repId })
        ).catch(() => {});
      }
      emitLog({
        tenantId,
        repId,
        session_id: sessionId,
        service: "server",
        eventType: existing ? "session_device_joined" : "session_started",
        data: {
          arbitrationLocus: ARBITRATION_LOCUS,
          deviceRole,
          mode: ctx.profile.mode
        }
      });

      startSttMock(ctx);
      return;
    }

    if (type === "ping") {
      ws.send(JSON.stringify({ type: "pong", at: Number(raw.at ?? Date.now()) } satisfies WsServerMessageV1));
      return;
    }

    if (type === "flush") {
      const sessionId = String(raw.session_id ?? "");
      if (!socketsBySession.get(sessionId)?.has(ws)) {
        ws.send(JSON.stringify({
          type: "error",
          at: new Date().toISOString(),
          message: "session_not_authorized",
          code: "forbidden"
        } satisfies WsServerMessageV1));
        ws.close();
        return;
      }
      const ctx = sessions.get(sessionId);
      if (ctx) {
        scheduleConversationLearning(ctx, { force: true });
      }
      return;
    }

    if (type === "stop") {
      const sessionId = String(raw.session_id ?? "");
      if (!socketsBySession.get(sessionId)?.has(ws)) {
        ws.send(JSON.stringify({
          type: "error",
          at: new Date().toISOString(),
          message: "session_not_authorized",
          code: "forbidden"
        } satisfies WsServerMessageV1));
        ws.close();
        return;
      }
      const ctx = sessions.get(sessionId);
      if (ctx) {
        ctx.guidance.cancel("session_stopped");
        scheduleConversationLearning(ctx, { force: true });
      }
      sessions.delete(sessionId);
      socketsBySession.get(sessionId)?.delete(ws);
      clearSessionRateLimit(sessionId);
      guidanceFeedbackStore.clearSession(sessionId);
      await trackPrivateDataTask(
        ctx?.dataEpoch ?? privateDataEpoch,
        () => endSession(sessionId)
      ).catch((error: unknown) => {
        emitLog({
          tenantId: ctx?.tenantId ?? "personal",
          repId: ctx?.repId ?? "owner",
          session_id: sessionId,
          service: "server",
          eventType: "session_end_metadata_error",
          level: "WARN",
          data: safeLearningErrorData(error)
        });
      });
      ws.close();
      return;
    }

  });

  /* ── Server-side heartbeat: ping every 25s, timeout at 35s ─── */
  let heartbeatAlive = true;
  const pingInterval = setInterval(() => {
    if (ws.readyState !== ws.OPEN) return;
    if (!heartbeatAlive) {
      ws.terminate();
      return;
    }
    heartbeatAlive = false;
    ws.ping();
  }, 25_000);

  ws.on("pong", () => { heartbeatAlive = true; });

  ws.on("close", () => {
    totalWsConnections--;
    const remaining = (wsConnectionsByIp.get(remoteIp) ?? 1) - 1;
    if (remaining > 0) wsConnectionsByIp.set(remoteIp, remaining);
    else wsConnectionsByIp.delete(remoteIp);
    clearTimeout(startDeadline);
    if (tokenExpiryTimer) clearTimeout(tokenExpiryTimer);
    clearInterval(pingInterval);
    // Clean up socket from all session sets
    for (const [sid, socks] of socketsBySession.entries()) {
      socks.delete(ws);
      if (socks.size === 0) {
        const ctx = sessions.get(sid);
        if (ctx) {
          ctx.guidance.cancel("all_clients_disconnected");
          scheduleConversationLearning(ctx, { force: true });
        }
        socketsBySession.delete(sid);
      }
    }
  });
});

/* ── Health metrics endpoint (Step 15) ──────────────────────── */
app.get("/api/health/metrics", requireAuth, (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const activeSessions = sessions.size;
  const activeConnections = [...socketsBySession.values()].reduce((sum, s) => sum + s.size, 0);
  sendOk(res, {
    activeSessions,
    activeConnections,
    uptime: process.uptime(),
    memoryMB: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
    arbitrationLocus: ARBITRATION_LOCUS,
    aiCoachEnabled: isAiCoachEnabled(),
    aiModel: CONFIG.openaiModel
  });
});

/* ── AI status endpoint ────────────────────────────────────── */
app.get("/api/ai-status", requireAuth, (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  sendOk(res, {
    aiCoachEnabled: isAiCoachEnabled(),
    model: isAiCoachEnabled() ? CONFIG.openaiModel : null,
    deepModel: isAiCoachEnabled() ? CONFIG.openaiDeepModel : null,
    transcriptionModel: isAiCoachEnabled() ? CONFIG.openaiTranscriptionModel : null,
    mode: isAiCoachEnabled() ? "ai" : "deterministic"
  });
});

/* ── Token usage endpoint (per-tenant billing/audit) ──────── */
app.get("/api/admin/usage", requireAuth, (req, res) => {
  const tenantId = req.auth?.tenantId;
  if (!tenantId) return sendErr(res, 400, "no_tenant");

  if (req.query.all === "true") {
    if (req.auth?.role !== "admin") return sendErr(res, 403, "admin_only");
    return sendOk(res, { usage: getAllTenantUsage() });
  }

  return sendOk(res, { usage: getTenantUsageSummary(tenantId) });
});

/* ── Rate limit stats (admin monitoring) ──────────────────── */
app.get("/api/admin/rate-limits", requireAuth, (req, res) => {
  if (req.auth?.role !== "admin") return sendErr(res, 403, "admin_only");
  return sendOk(res, { stats: getRateLimitStats() });
});

/* Serve the installable web client from the same origin in production builds. */
if (existsSync(CONFIG.webDistPath)) {
  app.use(express.static(CONFIG.webDistPath, {
    index: false,
    setHeaders: (res, filePath) => {
      const name = path.basename(filePath);
      if (name === "sw.js" || name === "index.html" || name.endsWith(".webmanifest")) {
        res.setHeader("Cache-Control", "no-cache");
      } else if (filePath.includes(`${path.sep}assets${path.sep}`)) {
        res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      }
    }
  }));

  app.get("*", (req, res, next) => {
    if (req.path === "/health" || req.path.startsWith("/api/")) return next();
    return res.sendFile(path.join(CONFIG.webDistPath, "index.html"), (error) => {
      if (error) next(error);
    });
  });
}

app.use((_req, res) => {
  sendErr(res, 404, "not_found");
});

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (err instanceof GoogleOAuthError) {
    const clientError = ["invalid_callback", "invalid_oauth_state", "oauth_not_pending"].includes(err.code);
    return sendErr(res, err.status ?? (clientError ? 400 : 502), err.code, err.message);
  }
  const shaped = err && typeof err === "object" ? err as Record<string, unknown> : {};
  if (shaped.type === "entity.too.large" || shaped.status === 413) {
    return sendErr(res, 413, "payload_too_large");
  }
  const message = err instanceof Error ? err.message : "unknown_error";
  return sendErr(res, 500, "internal_error", process.env.NODE_ENV === "development" ? message : undefined);
});

/* ── Session timeout cleanup (every 60s, reap inactive sessions) ── */
const SESSION_CLEANUP_INTERVAL = 60_000;
const sessionCleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const [sid, ctx] of sessions.entries()) {
    if (now - ctx.lastActivity > CONFIG.sessionTimeoutMs) {
      ctx.guidance.cancel("session_timeout");
      scheduleConversationLearning(ctx, { force: true });
      sessions.delete(sid);
      const socks = socketsBySession.get(sid);
      if (socks) {
        for (const ws of socks) {
          try { ws.close(1000, "session_timeout"); } catch { /* ignore */ }
        }
        socketsBySession.delete(sid);
      }
      clearSessionRateLimit(sid);
      guidanceFeedbackStore.clearSession(sid);
      void trackPrivateDataTask(ctx.dataEpoch, () => endSession(sid)).catch(() => {});
      emitLog({
        tenantId: ctx.tenantId, repId: ctx.repId, session_id: ctx.sessionId,
        service: "server", eventType: "session_timeout",
        data: { inactiveMs: now - ctx.lastActivity }
      });
    }
  }
}, SESSION_CLEANUP_INTERVAL);
sessionCleanupTimer.unref();

/* ── Graceful shutdown ────────────────────────────────────────── */
let shuttingDown = false;

async function gracefulShutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  // eslint-disable-next-line no-console
  console.log(`[server] ${signal} received — shutting down gracefully…`);

  // Start final learning snapshots without delaying shutdown on a deep-model call.
  for (const ctx of sessions.values()) {
    scheduleConversationLearning(ctx, { force: true });
  }
  googleSync?.stopBackgroundSync();

  // 1. Stop accepting new connections
  server.close(() => {
    // eslint-disable-next-line no-console
    console.log("[server] HTTP server closed");
  });

  // 2. Close all WebSocket connections
  for (const [, socks] of socketsBySession.entries()) {
    for (const ws of socks) {
      try { ws.close(1001, "server_shutting_down"); } catch { /* ignore */ }
    }
  }

  // 3. End all active sessions in DB
  const endPromises = [...sessions.keys()].map((sid) => endSession(sid).catch(() => {}));
  await Promise.allSettled(endPromises);

  // 4. Drain DB connection pool
  await pool.end().catch(() => {});

  // eslint-disable-next-line no-console
  console.log("[server] Shutdown complete");
  process.exit(0);
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

server.listen(CONFIG.port, CONFIG.host, () => {
  // eslint-disable-next-line no-console
  console.log(`[server] listening on http://${CONFIG.host}:${CONFIG.port}`);
  // eslint-disable-next-line no-console
  console.log(`[server] WebSocket path: ${CONFIG.wsPath} | AI: ${isAiCoachEnabled() ? CONFIG.openaiModel : "deterministic"} | Locus: ${ARBITRATION_LOCUS}`);
  googleSync?.startBackgroundSync({
    onError: (error) => {
      emitLog({
        tenantId: "personal",
        repId: "owner",
        session_id: "google_background_sync",
        service: "google_memory_sync",
        eventType: "google_background_sync_error",
        level: "WARN",
        data: safeLearningErrorData(error)
      });
    }
  });
});
