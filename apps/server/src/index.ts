import http from "http";
import crypto from "crypto";
import express from "express";
import { maybeBuildOfftopicBridgePatchV1 } from "./arbitration/pro/offtopic_bridge_v1";
import cors from "cors";
import { WebSocketServer } from "ws";
import { z } from "zod";

import {
  sanitizePatch_v1,
  type WsClientMessageV1,
  type WsServerMessageV1,
  type OverlayMessageV1,
  type GuidanceControls,
  type ClientDeviceType,
  type ClientRoleV1,
  type CoachControlActionV1,
  type CoachCorrectionMetaV1
} from "@overlay-assistant/shared";

import { CONFIG, ARBITRATION_LOCUS } from "./config";
import { requireApiKeyForApiV1, checkApiKeyForWsStartV1 } from "./auth/api_key_v1";
import { upsertSession, endSession, getTrustSummaryForTenant, getPrivacyControls, upsertPrivacyControls, deleteSessionArtifacts, insertConversationTimelineEvent, getConversationTimeline, enforceRetentionPolicies } from "./db/queries";
import { emitLog } from "./obs/emitLog";
import { arbitrateV1 } from "./arbitration/arbitration_v1";
import { dispatchIntegrationEvent } from "./integrations/universal_dispatch";
import { buildOauthAuthorizeUrl, exchangeOauthCode } from "./integrations/oauth_client";
import { createOauthState, consumeOauthState, upsertOauthTokens, type OAuthProvider, getOauthAccessToken } from "./integrations/oauth_store";
import { analyzeConversationV1 } from "./conversation/ci_v1";
import { createSessionMemory, updateTranscript } from "./arbitration/session_memory_v1";
import { detectMomentV1 } from "./arbitration/moment_detector_v1";
import { pickPlaybookV1 } from "./arbitration/playbooks_v1";
import { inferStageV1 } from "./arbitration/stage_detector_v1";
import { buildCoachOverlayPatchV1 } from "./arbitration/coach_engine_pro_v1";

type SessionCtx = {
  sessionId: string;
  tenantId: string;
  repId: string;
  controls: GuidanceControls;
  seq: number;
  memory: ReturnType<typeof createSessionMemory>;
  connectedDevices: Map<string, { id: string; type: ClientDeviceType; role: ClientRoleV1; name?: string }>;
  lastGuidance?: { stage?: string; moment?: string; lineHash?: string };
  pendingCorrectionReason?: CoachCorrectionMetaV1["reason"];
  learning: { helpful: number; unhelpful: number; ignored: number };
  sttMockStarted?: boolean;
  /** Live product context — set by the user per session */
  productContext?: SessionProductContext;
  /** History of guidance dashboard snapshots for the session */
  guidanceHistory: GuidanceDashboardSnapshot[];
};

/** Product/service context the user provides per session */
export type SessionProductContext = {
  productName: string;
  oneLiner: string;
  valueProps: string[];
  pricing: string;
  commonObjections: Array<{ objection: string; response: string }>;
  targetAudience: string;
  competitors: string;
  additionalNotes: string;
};

/** A snapshot of the multi-panel guidance dashboard */
export type GuidanceDashboardSnapshot = {
  timestamp: string;
  primary: { text: string; title: string; confidence: number; confidenceBand: string } | null;
  alternatives: Array<{ text: string; strategy: string }>;
  stage: string;
  momentum: { level: string; score: number };
  buyerSentiment: { tone: string; engagement: string; urgency: string };
  objectionsDetected: Array<{ key: string; score: number; suggestedResponse: string }>;
  talkingPoints: string[];
  riskAlerts: Array<{ type: string; message: string; severity: string }>;
  dealScore: number;
  nextMoves: string[];
};

const DEFAULT_CONTROLS: GuidanceControls = {
  guidanceMode: "assist",
  guidanceMuted: false,
  aiDepth: "P0",
  showLowConfidence: false
};

let lastRetentionPruneState: {
  at: string;
  mode: "manual" | "scheduled";
  result?: unknown;
  error?: string;
} | null = null;

const app = express();
app.use(express.json({ limit: "256kb" }));
app.use(cors({ origin: true, credentials: true }));
app.use("/api", requireApiKeyForApiV1);

app.get("/health", (_req, res) => res.json({ ok: true, arbitrationLocus: ARBITRATION_LOCUS }));

const TranscriptFinalInput = z.object({
  session_id: z.string().min(1),
  text: z.string().min(1).max(2000)
});

app.post("/api/demo/transcript_final", async (req, res) => {
  const parsed = TranscriptFinalInput.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ ok: false, error: parsed.error.flatten() });

  const { session_id, text } = parsed.data;

  let ctx = sessions.get(session_id) as any;
  if (!ctx) {
    // Demo convenience: auto-create a session context when missing
    ctx = {
      tenantId: "tenant_demo",
      repId: "rep_demo",
      sessionId: session_id,
      seq: 0,
      controls: CONFIG.defaultControls,
      memory: createSessionMemory(),
      connectedDevices: new Map(),
      learning: { helpful: 0, unhelpful: 0, ignored: 0 },
      guidanceHistory: []
    } as any;

    sessions.set(session_id, ctx as any);
    await emitLog({
      tenantId: ctx.tenantId,
      repId: ctx.repId,
      session_id: ctx.sessionId,
      service: "server",
      eventType: "session_autocreated",
      data: { via: "api/demo/transcript_final" }
    });
  }

  await onTranscriptFinal(ctx, text);
  return res.json({ ok: true });
});

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
});

app.post("/api/ui-event", async (req, res) => {
  const parsed = UiEventInput.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ ok: false, error: parsed.error.flatten() });

  const e = parsed.data;

  // Hard guard: block obvious transcript leakage fields
  const dataStr = JSON.stringify(e.data ?? {});
  if (/transcript|utterance|raw_text|full_text/i.test(dataStr)) {
    return res.status(400).json({ ok: false, error: "ui_event_contains_disallowed_fields" });
  }

  await emitLog({
    tenantId: e.tenantId,
    repId: e.repId,
    session_id: e.sessionId,
    service: "web",
    eventType: e.eventType,
    data: e.data ?? {}
  });

  return res.json({ ok: true });
});

app.get("/api/trust/summary", async (req, res) => {
  const tenantId = String(req.query.tenantId ?? "");
  if (!tenantId) return res.status(400).json({ ok: false, error: "tenantId_required" });
  const summary = await getTrustSummaryForTenant(tenantId);
  return res.json({ ok: true, summary });
});

app.get("/api/privacy/controls", async (req, res) => {
  const tenantId = String(req.query.tenantId ?? "");
  if (!tenantId) return res.status(400).json({ ok: false, error: "tenantId_required" });
  const controls = await getPrivacyControls(tenantId);
  return res.json({ ok: true, controls });
});

app.post("/api/privacy/controls", async (req, res) => {
  const parsed = PrivacyControlsInput.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ ok: false, error: parsed.error.flatten() });
  const body = parsed.data;
  await upsertPrivacyControls(body);
  await emitLog({
    tenantId: body.tenantId,
    repId: "system",
    session_id: "privacy",
    service: "server",
    eventType: "privacy_controls_updated",
    data: { transcriptOptOut: body.transcriptOptOut, encryptTranscriptFields: body.encryptTranscriptFields, retentionDays: body.retentionDays }
  });
  return res.json({ ok: true });
});

app.post("/api/privacy/delete-session", async (req, res) => {
  const parsed = DeleteSessionInput.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ ok: false, error: parsed.error.flatten() });
  const body = parsed.data;

  const result = await deleteSessionArtifacts({ tenantId: body.tenantId, sessionId: body.sessionId });
  await emitLog({
    tenantId: body.tenantId,
    repId: "system",
    session_id: body.sessionId,
    service: "server",
    eventType: "privacy_delete_session",
    data: result
  });
  return res.json({ ok: true, result });
});

app.post("/api/privacy/prune-retention", async (req, res) => {
  const parsed = RetentionPruneInput.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ ok: false, error: parsed.error.flatten() });
  const body = parsed.data;

  const result = await enforceRetentionPolicies({ tenantId: body.tenantId });
  lastRetentionPruneState = {
    at: new Date().toISOString(),
    mode: "manual",
    result
  };
  await emitLog({
    tenantId: body.tenantId ?? "system",
    repId: "system",
    session_id: "retention",
    service: "server",
    eventType: "retention_prune_run",
    data: result
  });

  return res.json({ ok: true, result });
});

app.get("/api/privacy/retention-status", async (req, res) => {
  const tenantId = String(req.query.tenantId ?? "");
  let tenantControls: any = null;
  if (tenantId) {
    tenantControls = await getPrivacyControls(tenantId);
  }

  return res.json({
    ok: true,
    scheduler: {
      enabled: CONFIG.retentionPruneEnabled,
      intervalMs: CONFIG.retentionPruneIntervalMs,
      lastRun: lastRetentionPruneState
    },
    tenantControls
  });
});

app.post("/api/live/audio_frame", async (req, res) => {
  const parsed = LiveAudioFrameInput.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ ok: false, error: parsed.error.flatten() });
  const body = parsed.data;

  const isSpeaking = body.frameEnergy >= 0.32 || Boolean(body.partialText?.trim());
  const finalText = (body.finalText ?? "").trim();
  const privacy = await getPrivacyControls(body.tenantId);

  const intel = finalText ? analyzeConversationV1(finalText) : { entities: [], moments: ["neutral"], complianceRisks: [], confidence: 0.3 };
  const objections = (intel.entities || []).filter((e: any) => e?.type === "objection_type").map((e: any) => String(e?.value ?? ""));

  if (finalText) {
    const inserted = await insertConversationTimelineEvent({
      tenantId: body.tenantId,
      sessionId: body.sessionId,
      source: "audio_frame",
      textExcerpt: privacy.transcriptOptOut ? "" : finalText,
      entities: intel.entities as any,
      moments: (intel.moments as any[]).map((m) => String(m)),
      objections,
      complianceRisks: intel.complianceRisks as any,
      confidence: Number(intel.confidence ?? 0)
    });

    broadcastTimelineEvent(body.sessionId, inserted as any);
  }

  if (finalText && !privacy.transcriptOptOut) {
    let ctx = sessions.get(body.sessionId) as any;
    if (!ctx) {
      ctx = {
        tenantId: body.tenantId,
        repId: body.repId,
        sessionId: body.sessionId,
        seq: 0,
        controls: CONFIG.defaultControls,
        memory: createSessionMemory(),
        connectedDevices: new Map(),
        learning: { helpful: 0, unhelpful: 0, ignored: 0 },
        guidanceHistory: []
      } as any;
      sessions.set(body.sessionId, ctx as any);
    }
    await onTranscriptFinal(ctx, finalText);
  }

  await emitLog({
    tenantId: body.tenantId,
    repId: body.repId,
    session_id: body.sessionId,
    service: "server",
    eventType: "audio_frame_processed",
    data: {
      vadSpeaking: isSpeaking,
      hasFinalText: Boolean(finalText),
      transcriptOptOut: privacy.transcriptOptOut,
      complianceRiskCount: intel.complianceRisks.length,
      confidence: intel.confidence
    }
  });

  return res.json({
    ok: true,
    vad: { isSpeaking, frameEnergy: body.frameEnergy },
    stt: { partialText: body.partialText ?? "", finalText: privacy.transcriptOptOut ? "" : finalText },
    intelligence: intel,
    privacy: {
      transcriptOptOut: privacy.transcriptOptOut,
      encryptTranscriptFields: privacy.encryptTranscriptFields,
      retentionDays: privacy.retentionDays
    }
  });
});

app.post("/api/conversation/intel", async (req, res) => {
  const parsed = ConversationIntelInput.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ ok: false, error: parsed.error.flatten() });
  const body = parsed.data;
  const intel = analyzeConversationV1(body.text);
  const objections = (intel.entities || []).filter((e: any) => e?.type === "objection_type").map((e: any) => String(e?.value ?? ""));

  const privacy = await getPrivacyControls(body.tenantId);
  const inserted = await insertConversationTimelineEvent({
    tenantId: body.tenantId,
    sessionId: body.sessionId,
    source: "conversation_intel",
    textExcerpt: privacy.transcriptOptOut ? "" : body.text,
    entities: intel.entities as any,
    moments: (intel.moments as any[]).map((m) => String(m)),
    objections,
    complianceRisks: intel.complianceRisks as any,
    confidence: Number(intel.confidence ?? 0)
  });

  broadcastTimelineEvent(body.sessionId, inserted as any);

  await emitLog({
    tenantId: body.tenantId,
    repId: "system",
    session_id: body.sessionId,
    service: "server",
    eventType: "conversation_intel_generated",
    data: { entityCount: intel.entities.length, momentCount: intel.moments.length, complianceRiskCount: intel.complianceRisks.length, confidence: intel.confidence }
  });
  return res.json({ ok: true, intelligence: intel });
});

// ─── Product Context (per-session) ───────────────────────────────────────────
const ProductContextInput = z.object({
  sessionId: z.string().min(1),
  tenantId: z.string().min(1),
  productName: z.string().max(200).default(""),
  oneLiner: z.string().max(500).default(""),
  valueProps: z.array(z.string().max(300)).max(20).default([]),
  pricing: z.string().max(500).default(""),
  commonObjections: z.array(z.object({ objection: z.string().max(300), response: z.string().max(500) })).max(20).default([]),
  targetAudience: z.string().max(500).default(""),
  competitors: z.string().max(500).default(""),
  additionalNotes: z.string().max(2000).default("")
});

app.post("/api/session/product_context", async (req, res) => {
  const parsed = ProductContextInput.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ ok: false, error: parsed.error.flatten() });
  const body = parsed.data;

  let ctx = sessions.get(body.sessionId) as any;
  if (!ctx) {
    ctx = {
      tenantId: body.tenantId,
      repId: "rep_demo",
      sessionId: body.sessionId,
      seq: 0,
      controls: CONFIG.defaultControls,
      memory: createSessionMemory(),
      connectedDevices: new Map(),
      learning: { helpful: 0, unhelpful: 0, ignored: 0 },
      guidanceHistory: []
    } as any;
    sessions.set(body.sessionId, ctx as any);
  }

  ctx.productContext = {
    productName: body.productName,
    oneLiner: body.oneLiner,
    valueProps: body.valueProps,
    pricing: body.pricing,
    commonObjections: body.commonObjections,
    targetAudience: body.targetAudience,
    competitors: body.competitors,
    additionalNotes: body.additionalNotes
  };

  await emitLog({
    tenantId: body.tenantId,
    repId: "system",
    session_id: body.sessionId,
    service: "server",
    eventType: "product_context_set",
    data: { productName: body.productName, valuePropCount: body.valueProps.length, objectionCount: body.commonObjections.length }
  });

  return res.json({ ok: true });
});

app.get("/api/session/product_context", async (req, res) => {
  const sessionId = String(req.query.sessionId ?? "");
  if (!sessionId) return res.status(400).json({ ok: false, error: "sessionId_required" });
  const ctx = sessions.get(sessionId) as any;
  return res.json({ ok: true, productContext: ctx?.productContext ?? null });
});

app.get("/api/session/guidance_dashboard", async (req, res) => {
  const sessionId = String(req.query.sessionId ?? "");
  if (!sessionId) return res.status(400).json({ ok: false, error: "sessionId_required" });
  const ctx = sessions.get(sessionId) as any;
  const history = ctx?.guidanceHistory ?? [];
  const latest = history.length > 0 ? history[history.length - 1] : null;
  return res.json({ ok: true, latest, historyCount: history.length });
});

app.get("/api/conversation/timeline", async (req, res) => {
  const tenantId = String(req.query.tenantId ?? "");
  const sessionId = String(req.query.sessionId ?? "");
  const limit = Number(req.query.limit ?? 80);
  const sinceId = Number(req.query.sinceId ?? 0);
  if (!tenantId) return res.status(400).json({ ok: false, error: "tenantId_required" });
  if (!sessionId) return res.status(400).json({ ok: false, error: "sessionId_required" });

  const items = await getConversationTimeline({
    tenantId,
    sessionId,
    limit,
    sinceId: Number.isFinite(sinceId) && sinceId > 0 ? sinceId : undefined
  });
  const nextSinceId = items.reduce((mx, item: any) => Math.max(mx, Number(item?.id ?? 0)), Math.max(0, Number.isFinite(sinceId) ? sinceId : 0));
  return res.json({ ok: true, items, nextSinceId });
});

const IntegrationInput = z.object({
  tenantId: z.string().min(1),
  integration: z.enum(["salesforce", "hubspot", "zoom", "google_meet", "google_workspace", "bluetooth_bridge", "server_webhook"]),
  idempotencyKey: z.string().min(8),
  payload: z.record(z.any())
});

const OAuthStartInput = z.object({
  tenantId: z.string().min(1),
  provider: z.enum(["zoom", "google"]),
  redirectUri: z.string().url()
});

const OAuthCallbackInput = z.object({
  tenantId: z.string().min(1),
  provider: z.enum(["zoom", "google"]),
  code: z.string().min(1),
  state: z.string().min(4),
  redirectUri: z.string().url()
});

const LiveAudioFrameInput = z.object({
  tenantId: z.string().min(1),
  repId: z.string().min(1),
  sessionId: z.string().min(1),
  frameEnergy: z.number().min(0).max(1),
  partialText: z.string().max(300).optional(),
  finalText: z.string().max(2000).optional(),
  language: z.string().max(20).optional()
});

const ConversationIntelInput = z.object({
  tenantId: z.string().min(1),
  sessionId: z.string().min(1),
  text: z.string().min(1).max(4000)
});

const PrivacyControlsInput = z.object({
  tenantId: z.string().min(1),
  transcriptOptOut: z.boolean(),
  encryptTranscriptFields: z.boolean(),
  retentionDays: z.number().int().min(1).max(3650)
});

const DeleteSessionInput = z.object({
  tenantId: z.string().min(1),
  sessionId: z.string().min(1)
});

const RetentionPruneInput = z.object({
  tenantId: z.string().min(1).optional()
});

app.post("/api/integrations/oauth/start", async (req, res) => {
  const parsed = OAuthStartInput.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ ok: false, error: parsed.error.flatten() });
  const body = parsed.data;

  const state = await createOauthState({
    tenantId: body.tenantId,
    provider: body.provider as OAuthProvider,
    redirectUri: body.redirectUri
  });

  let authUrl = "";
  try {
    authUrl = buildOauthAuthorizeUrl({
      provider: body.provider as OAuthProvider,
      redirectUri: body.redirectUri,
      stateToken: state.stateToken,
      tenantId: body.tenantId
    });
  } catch (e: any) {
    return res.status(400).json({ ok: false, error: String(e?.message ?? "oauth_provider_not_configured") });
  }

  await emitLog({
    tenantId: body.tenantId,
    repId: "system",
    session_id: "oauth",
    service: "server",
    eventType: "oauth_start",
    data: { provider: body.provider }
  });

  return res.json({ ok: true, authUrl, state: `${body.tenantId}:${state.stateToken}`, expiresAt: state.expiresAtIso });
});

app.post("/api/integrations/oauth/callback", async (req, res) => {
  const parsed = OAuthCallbackInput.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ ok: false, error: parsed.error.flatten() });
  const body = parsed.data;

  const [tenantFromState, stateToken] = String(body.state).split(":", 2);
  if (!tenantFromState || !stateToken || tenantFromState !== body.tenantId) {
    return res.status(400).json({ ok: false, error: "oauth_state_invalid" });
  }

  const consumed = await consumeOauthState({
    tenantId: body.tenantId,
    provider: body.provider as OAuthProvider,
    stateToken,
    redirectUri: body.redirectUri
  });
  if (!consumed) return res.status(400).json({ ok: false, error: "oauth_state_expired_or_used" });

  let exchanged;
  try {
    exchanged = await exchangeOauthCode({
      provider: body.provider as OAuthProvider,
      code: body.code,
      redirectUri: body.redirectUri
    });
  } catch (e: any) {
    return res.status(400).json({ ok: false, error: String(e?.message ?? "oauth_exchange_failed") });
  }

  await upsertOauthTokens({
    tenantId: body.tenantId,
    provider: body.provider as OAuthProvider,
    subjectId: exchanged.subjectId,
    accessToken: exchanged.accessToken,
    refreshToken: exchanged.refreshToken,
    tokenType: exchanged.tokenType,
    scope: exchanged.scope,
    expiresInSec: exchanged.expiresInSec,
    metadata: { provider: body.provider }
  });

  await emitLog({
    tenantId: body.tenantId,
    repId: "system",
    session_id: "oauth",
    service: "server",
    eventType: "oauth_connected",
    data: { provider: body.provider }
  });

  return res.json({ ok: true, connected: true, provider: body.provider });
});

app.get("/api/integrations/oauth/status", async (req, res) => {
  const tenantId = String(req.query.tenantId ?? "");
  const provider = String(req.query.provider ?? "") as OAuthProvider;
  if (!tenantId) return res.status(400).json({ ok: false, error: "tenantId_required" });
  if (provider !== "zoom" && provider !== "google") return res.status(400).json({ ok: false, error: "provider_invalid" });

  const token = await getOauthAccessToken({ tenantId, provider });
  return res.json({ ok: true, connected: Boolean(token), provider });
});

app.post("/api/integrations/write-note", async (req, res) => {
  const parsed = IntegrationInput.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ ok: false, error: parsed.error.flatten() });
  const body = parsed.data;

  const req0 = { tenantId: body.tenantId, integration: body.integration, idempotencyKey: body.idempotencyKey, payload: body.payload };

  const result = await dispatchIntegrationEvent(req0);
  return res.json({ ok: true, result });
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: CONFIG.wsPath });

const sessions = new Map<string, SessionCtx>();
const socketsBySession = new Map<string, Set<any>>();
const socketSessionMeta = new Map<any, { sessionId: string; deviceId: string; role: ClientRoleV1; lastControlAtMs: number; controlBurst: number }>();

const CONTROL_ACTIONS_BY_ROLE: Record<ClientRoleV1, Set<CoachControlActionV1>> = {
  host: new Set(["toggle_mute", "set_guidance_mode", "set_ai_depth", "accept_current", "dismiss_current", "request_reframe", "mark_helpful", "mark_unhelpful"]),
  controller: new Set(["toggle_mute", "set_guidance_mode", "set_ai_depth", "accept_current", "dismiss_current", "request_reframe", "mark_helpful", "mark_unhelpful"]),
  viewer: new Set(["accept_current", "dismiss_current", "mark_helpful", "mark_unhelpful"])
};

function safeJsonParse(s: string): any | null {
  try { return JSON.parse(s); } catch { return null; }
}

function broadcast(sessionId: string, msg: WsServerMessageV1) {
  const set = socketsBySession.get(sessionId);
  if (!set) return;
  for (const ws of set) {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
  }
}

function toLineHash(line: string): string {
  return crypto.createHash("sha256").update(line.trim().toLowerCase()).digest("hex");
}

function emitSessionState(sessionId: string) {
  const ctx = sessions.get(sessionId);
  if (!ctx) return;
  const devices = Array.from(ctx.connectedDevices.values()).map((d) => ({ id: d.id, type: d.type, role: d.role, name: d.name }));
  broadcast(sessionId, {
    type: "session_state",
    session_id: sessionId,
    at: new Date().toISOString(),
    state: {
      controls: ctx.controls,
      connectedDevices: devices
    }
  });
}

function broadcastTimelineEvent(sessionId: string, event: {
  id: number;
  createdAt: string;
  source: string;
  textExcerpt: string;
  entities: Array<{ type: string; value: string; confidence?: number }>;
  moments: string[];
  objections: string[];
  complianceRisks: Array<{ type: string; severity: string; phrase: string }>;
  confidence: number;
}) {
  broadcast(sessionId, {
    type: "timeline_event",
    session_id: sessionId,
    at: new Date().toISOString(),
    event
  });
}

function canRunControl(role: ClientRoleV1, action: CoachControlActionV1): boolean {
  return CONTROL_ACTIONS_BY_ROLE[role]?.has(action) ?? false;
}

function tooManyControls(meta: { lastControlAtMs: number; controlBurst: number }): boolean {
  const now = Date.now();
  if (now - meta.lastControlAtMs > 3000) {
    meta.lastControlAtMs = now;
    meta.controlBurst = 1;
    return false;
  }
  meta.controlBurst += 1;
  meta.lastControlAtMs = now;
  return meta.controlBurst > 12;
}

async function applyControlCommand(ctx: SessionCtx, action: CoachControlActionV1, value: unknown, source: ClientDeviceType) {
  if (action === "toggle_mute") {
    ctx.controls = { ...ctx.controls, guidanceMuted: !ctx.controls.guidanceMuted };
  }
  if (action === "set_guidance_mode" && (value === "assist" || value === "auto" || value === "off")) {
    ctx.controls = { ...ctx.controls, guidanceMode: value };
  }
  if (action === "set_ai_depth" && (value === "P0" || value === "P1" || value === "P2" || value === "P3")) {
    ctx.controls = { ...ctx.controls, aiDepth: value };
  }
  if (action === "request_reframe") {
    ctx.pendingCorrectionReason = "user_reframe_request";
    const last = ctx.memory?.transcriptWindow?.[ctx.memory.transcriptWindow.length - 1];
    if (typeof last === "string" && last.trim()) {
      await onTranscriptFinal(ctx, last);
    }
  }

  await emitLog({
    tenantId: ctx.tenantId,
    repId: ctx.repId,
    session_id: ctx.sessionId,
    service: "server",
    eventType: "coach_control",
    data: { action, source, hasValue: value !== undefined && value !== null }
  });

  emitSessionState(ctx.sessionId);
  const settings: OverlayMessageV1 = { type: "settings", settings: { controls: ctx.controls } };
  broadcast(ctx.sessionId, { type: "overlay_message", session_id: ctx.sessionId, at: new Date().toISOString(), message: settings });
}

function applyLearningSignal(ctx: SessionCtx, outcome: "helpful" | "unhelpful" | "ignored") {
  if (outcome === "helpful") ctx.learning.helpful += 1;
  if (outcome === "unhelpful") ctx.learning.unhelpful += 1;
  if (outcome === "ignored") ctx.learning.ignored += 1;

  if (ctx.learning.helpful >= 3 && ctx.learning.helpful > ctx.learning.unhelpful) {
    if (ctx.controls.aiDepth === "P0") ctx.controls = { ...ctx.controls, aiDepth: "P1" };
    else if (ctx.controls.aiDepth === "P1") ctx.controls = { ...ctx.controls, aiDepth: "P2" };
  }

  if (ctx.learning.unhelpful >= 2 && ctx.learning.unhelpful >= ctx.learning.helpful) {
    if (ctx.controls.aiDepth === "P3") ctx.controls = { ...ctx.controls, aiDepth: "P2" };
    else if (ctx.controls.aiDepth === "P2") ctx.controls = { ...ctx.controls, aiDepth: "P1" };
  }
}

async function onTranscriptFinal(ctx: SessionCtx, text: string) {
  const privacy = await getPrivacyControls(ctx.tenantId);
  if (privacy.transcriptOptOut) {
    await emitLog({
      tenantId: ctx.tenantId,
      repId: ctx.repId,
      session_id: ctx.sessionId,
      service: "server",
      eventType: "transcript_skipped_opt_out",
      data: { textLen: text.length }
    });
    return;
  }

  ctx.seq += 1;

  // Safety: ensure memory exists (demo routes may call onTranscriptFinal without WS ctx init)
  if (!ctx.memory) ctx.memory = createSessionMemory();

  // Safety: ensure memory exists (demo routes may call onTranscriptFinal without WS ctx init)
  if (!ctx.memory) ctx.memory = createSessionMemory();

  // Throttle: no more than 1 suggestion per 800ms per session (fast enough for live coaching)
  const now = Date.now();
  if (ctx.memory.lastSuggestionAt && now - ctx.memory.lastSuggestionAt < 800) {
    return;
  }
  ctx.memory.lastSuggestionAt = now;

  const transcriptHash = crypto.createHash("sha256").update(text.toLowerCase()).digest("hex");
  await emitLog({
    tenantId: ctx.tenantId,
    repId: ctx.repId,
    session_id: ctx.sessionId,
    service: "server",
    eventType: "transcript_final_received",
    data: { transcriptHash, transcriptLen: text.length }
  });

  const intel = analyzeConversationV1(text);
  await emitLog({
    tenantId: ctx.tenantId,
    repId: ctx.repId,
    session_id: ctx.sessionId,
    service: "server",
    eventType: "conversation_intel",
    data: {
      entityCount: intel.entities.length,
      moments: intel.moments,
      complianceRiskCount: intel.complianceRisks.length,
      confidence: intel.confidence
    }
  });

  broadcast(ctx.sessionId, { type: "transcript_final", session_id: ctx.sessionId, seq: ctx.seq, at: new Date().toISOString(), text });

  // Coach engine (Path A): stage + moment + micro-goal + product packs + confidence + guidance items
  let built = await buildCoachOverlayPatchV1({
    tenantId: ctx.tenantId,
    repId: ctx.repId,
    sessionId: ctx.sessionId,
    controls: ctx.controls,
    memory: ctx.memory,
    text
  });

  // Track last primary sales moment for off-topic bridges (integration/price/security/etc.)
  const m0 = (built as any)?.meta?.moment;
  if (m0 && m0 !== "unknown" && m0 !== "offtopic") (ctx.memory as any).lastPrimaryMoment = m0;

  // Rare behavior: if the buyer drifts into small-talk/off-topic, acknowledge briefly then pivot back.
  const off = maybeBuildOfftopicBridgePatchV1({
    text,
    stage: (built as any)?.meta?.stage,
    moment: m0,
    memory: ctx.memory as any,
  });
  if (off) {
    built = { ...(built as any), suppressed: false, patch: off.patch, meta: off.meta, decision: { ...(built as any)?.decision, offtopic: off.note } };
    await emitLog({ tenantId: ctx.tenantId, repId: ctx.repId, session_id: ctx.sessionId, service: "server", eventType: "offtopic_bridge_applied", data: { category: off.note.category, anchorMoment: off.note.anchorMoment ?? null, offScore: off.note.offScore, salesScore: off.note.salesScore } });
  }


  if (built.suppressed) {
    await emitLog({ tenantId: ctx.tenantId, repId: ctx.repId, session_id: ctx.sessionId, service: "server", eventType: "suggestion_suppressed", data: built.meta });
    return;
  }

  await emitLog({ tenantId: ctx.tenantId, repId: ctx.repId, session_id: ctx.sessionId, service: "server", eventType: "coach_decision", data: built.meta });

  const rawPatch = (built as any).patch ?? (built as any).rawPatch;

  const s = sanitizePatch_v1(rawPatch);
  if (!s.ok) {
    await emitLog({
      tenantId: ctx.tenantId,
      repId: ctx.repId,
      session_id: ctx.sessionId,
      service: "server",
      eventType: "patch_rejected",
      data: { reason: (s as any).reason, detailSafe: (s as any).detailSafe, bytes: (s as any).bytes }
    });

    const fail: OverlayMessageV1 = { type: "settings", settings: { controls: ctx.controls, status: { failureCode: "patch_rejected" } } };
    broadcast(ctx.sessionId, { type: "overlay_message", session_id: ctx.sessionId, at: new Date().toISOString(), message: fail });
    return;
  }

  await emitLog({ tenantId: ctx.tenantId, repId: ctx.repId, session_id: ctx.sessionId, service: "server", eventType: "patch_received", data: { bytes: (s as any).bytes } });

  const patch = (s as any).patch as any;
  const patchLine = typeof patch?.text === "string" && patch.text.trim()
    ? patch.text.trim()
    : (typeof patch?.guidance?.items?.[0]?.text === "string" ? patch.guidance.items[0].text : "");
  const nextStage = typeof (built as any)?.meta?.stage === "string" ? (built as any).meta.stage : undefined;
  const nextMoment = typeof (built as any)?.meta?.moment === "string" ? (built as any).meta.moment : undefined;
  const nextLineHash = patchLine ? toLineHash(patchLine) : undefined;

  const prev = ctx.lastGuidance;
  const interpretationShift = Boolean(
    prev
    && nextLineHash
    && prev.lineHash
    && prev.lineHash !== nextLineHash
    && ((prev.stage && nextStage && prev.stage !== nextStage) || (prev.moment && nextMoment && prev.moment !== nextMoment))
  );

  if ((interpretationShift || ctx.pendingCorrectionReason === "user_reframe_request") && nextLineHash) {
    const correction: CoachCorrectionMetaV1 = {
      reason: ctx.pendingCorrectionReason ?? "interpretation_shift",
      from: prev,
      to: { stage: nextStage, moment: nextMoment, lineHash: nextLineHash },
      note: ctx.pendingCorrectionReason === "user_reframe_request"
        ? "Reframed guidance based on live user request."
        : "Adjusted guidance after new context shifted interpretation."
    };
    broadcast(ctx.sessionId, {
      type: "correction",
      session_id: ctx.sessionId,
      at: new Date().toISOString(),
      correction
    });
    await emitLog({
      tenantId: ctx.tenantId,
      repId: ctx.repId,
      session_id: ctx.sessionId,
      service: "server",
      eventType: "coach_correction",
      data: correction
    });
  }

  ctx.pendingCorrectionReason = undefined;
  if (nextLineHash) {
    ctx.lastGuidance = { stage: nextStage, moment: nextMoment, lineHash: nextLineHash };
  }

  const overlayMsg: OverlayMessageV1 = { type: "patch", patch };
  broadcast(ctx.sessionId, { type: "overlay_message", session_id: ctx.sessionId, at: new Date().toISOString(), message: overlayMsg });

  // ─── Generate multi-panel guidance dashboard ───────────────────────────
  const dashboard = buildGuidanceDashboard(ctx, text, built, intel, patch);
  if (!ctx.guidanceHistory) ctx.guidanceHistory = [];
  ctx.guidanceHistory.push(dashboard);
  if (ctx.guidanceHistory.length > 50) ctx.guidanceHistory = ctx.guidanceHistory.slice(-50);

  broadcast(ctx.sessionId, {
    type: "guidance_dashboard",
    session_id: ctx.sessionId,
    at: new Date().toISOString(),
    dashboard: dashboard as unknown as Record<string, unknown>
  });
}

/** Build a rich multi-panel guidance dashboard from coach result + context */
function buildGuidanceDashboard(ctx: SessionCtx, text: string, built: any, intel: any, patch: any): GuidanceDashboardSnapshot {
  const meta = (built as any)?.meta ?? {};
  const pCtx = ctx.productContext;
  const transcript = ctx.memory?.transcriptWindow ?? [];

  // Primary suggestion
  const primaryText = typeof patch?.text === "string" ? patch.text : (patch?.guidance?.items?.[0]?.text ?? "");
  const primaryTitle = patch?.guidance?.items?.[0]?.title ?? "Next best line";
  const primaryConf = patch?.guidance?.items?.[0]?.confidence ?? meta?.confidence ?? 0.5;
  const primaryBand = patch?.guidance?.items?.[0]?.confidenceBand ?? meta?.confidenceBand ?? "medium";

  // Stage
  const stage = meta?.stage ?? "discovery";

  // Momentum
  const momentum = {
    level: meta?.momentum?.level ?? "medium",
    score: typeof meta?.momentum?.score === "number" ? meta.momentum.score : 50
  };

  // Buyer sentiment (infer from transcript + tone meta)
  const toneRaw = meta?.tone ?? {};
  const lastTexts = transcript.slice(-4).join(" ").toLowerCase();
  const engagement = /\?|tell me|how|can you|show|explain/i.test(lastTexts) ? "high"
    : /okay|sure|maybe|i guess/i.test(lastTexts) ? "medium" : "low";
  const urgency = /today|asap|need|deadline|hurry|rush|fast|quick/i.test(lastTexts) ? "high"
    : /soon|this week|next week|timeline/i.test(lastTexts) ? "medium" : "low";
  const buyerSentiment = {
    tone: toneRaw?.detected ?? (toneRaw?.style ?? "neutral"),
    engagement,
    urgency
  };

  // Objections detected (with suggested responses from product context)
  const detectedObjections = (meta?.objectionsTop ?? []).map((obj: any) => {
    const key = obj?.key ?? "unknown";
    const score = obj?.score ?? 0;
    // Try to find matching response from product context
    let suggestedResponse = "";
    if (pCtx?.commonObjections?.length) {
      const match = pCtx.commonObjections.find(o => 
        o.objection.toLowerCase().includes(key) || key.includes(o.objection.toLowerCase().split(" ")[0])
      );
      if (match) suggestedResponse = match.response;
    }
    if (!suggestedResponse) {
      // Generic fallback
      if (key === "price") suggestedResponse = "Reframe to ROI — what's the cost of NOT solving this?";
      else if (key === "competitor") suggestedResponse = "Acknowledge their option, then highlight your unique differentiator.";
      else if (key === "timeline") suggestedResponse = "Show a quick-start path — what's the smallest first step?";
      else suggestedResponse = "Acknowledge the concern, ask what would make them comfortable.";
    }
    return { key, score, suggestedResponse };
  });

  // Alternative approaches (generate 2-3 based on stage/moment)
  const alternatives = generateAlternativeApproaches(stage, meta?.moment ?? "unknown", text, pCtx);

  // Talking points from product context
  const talkingPoints: string[] = [];
  if (pCtx?.productName) talkingPoints.push(`Product: ${pCtx.productName} — ${pCtx.oneLiner}`);
  if (pCtx?.valueProps?.length) {
    // Surface value props relevant to the current conversation
    const relevant = pCtx.valueProps.filter(vp => {
      const vpLower = vp.toLowerCase();
      return lastTexts.split(/\s+/).some(w => w.length > 3 && vpLower.includes(w));
    });
    if (relevant.length) talkingPoints.push(...relevant.map(r => `✦ ${r}`));
    else talkingPoints.push(...pCtx.valueProps.slice(0, 3).map(r => `✦ ${r}`));
  }
  if (pCtx?.pricing) talkingPoints.push(`Pricing: ${pCtx.pricing}`);
  if (pCtx?.targetAudience) talkingPoints.push(`Target: ${pCtx.targetAudience}`);

  // Risk alerts
  const riskAlerts: Array<{ type: string; message: string; severity: string }> = [];
  if (intel?.complianceRisks?.length) {
    for (const risk of intel.complianceRisks) {
      riskAlerts.push({ type: risk.type, message: risk.phrase || "Compliance pattern detected", severity: risk.severity });
    }
  }
  if (buyerSentiment.engagement === "low" && transcript.length > 4) {
    riskAlerts.push({ type: "engagement_drop", message: "Buyer engagement appears low — consider asking an open-ended question", severity: "medium" });
  }
  if (momentum.level === "low" && stage !== "discovery") {
    riskAlerts.push({ type: "stalled_deal", message: "Momentum is low — consider suggesting a concrete next step", severity: "medium" });
  }

  // Deal score (0-100)
  const dealScore = computeDealScore(stage, momentum, buyerSentiment, detectedObjections.length, transcript.length);

  // Next moves (predictive)
  const nextMoves = predictNextMoves(stage, meta?.moment, buyerSentiment, pCtx);

  return {
    timestamp: new Date().toISOString(),
    primary: primaryText ? { text: primaryText, title: primaryTitle, confidence: primaryConf, confidenceBand: primaryBand } : null,
    alternatives,
    stage,
    momentum,
    buyerSentiment,
    objectionsDetected: detectedObjections,
    talkingPoints,
    riskAlerts,
    dealScore,
    nextMoves
  };
}

function generateAlternativeApproaches(stage: string, moment: string, text: string, pCtx?: SessionProductContext | null): Array<{ text: string; strategy: string }> {
  const alts: Array<{ text: string; strategy: string }> = [];
  const tNorm = text.toLowerCase();

  if (moment === "price" || /price|cost|expensive|budget/i.test(tNorm)) {
    alts.push({ strategy: "Value Reframe", text: "Instead of discussing price, redirect: 'What would solving this problem be worth to your team over the next year?'" });
    alts.push({ strategy: "Anchor High", text: "Start with the premium option: 'Most teams in your situation go with [top tier] because...' — then the mid-tier feels like a deal." });
    if (pCtx?.pricing) alts.push({ strategy: "Transparent Pricing", text: `Be direct: '${pCtx.pricing}. Want me to scope something that fits your budget specifically?'` });
  } else if (moment === "competitor" || /competitor|alternative|other option|compared to/i.test(tNorm)) {
    alts.push({ strategy: "Acknowledge & Differentiate", text: "Say: 'They're solid. The difference teams tell us is [unique value]. What matters most to you?'" });
    alts.push({ strategy: "Win Story", text: "Share: 'A company like yours evaluated [competitor] and chose us because [reason]. Want the details?'" });
  } else if (moment === "integration" || /\b(api|integrate|connect|sso|crm)\b/i.test(tNorm)) {
    alts.push({ strategy: "Discovery First", text: "'What's your current stack? I'll map exactly which integrations apply and which don't — no guessing.'" });
    alts.push({ strategy: "Proof Point", text: "'We have [X] live integrations. Most teams are live in under [time]. Want to see a sandbox?'" });
  } else if (stage === "discovery") {
    alts.push({ strategy: "Deep Discovery", text: "'What triggered you to look at this now? Understanding the 'why now' helps me skip the generic pitch.'" });
    alts.push({ strategy: "Pain Mapping", text: "'On a scale of 1-10, how painful is this problem today? What would a 10 look like?'" });
  } else if (stage === "evaluation") {
    alts.push({ strategy: "Requirements Map", text: "'Let's build a quick requirements checklist — what are your top 3 must-haves?'" });
    alts.push({ strategy: "Proof of Value", text: "'Would a 15-minute focused demo on your #1 use case be more valuable than a full walkthrough?'" });
  } else if (stage === "negotiation" || stage === "closing") {
    alts.push({ strategy: "Assumptive Close", text: "'Based on what you've told me, here's what I'd recommend. Should I send over the agreement?'" });
    alts.push({ strategy: "Urgency Lever", text: "'If we get this moving by [date], I can [incentive]. What's your internal timeline?'" });
  } else {
    alts.push({ strategy: "Open-Ended Probe", text: "'Tell me more about that — what does success look like for you?'" });
    alts.push({ strategy: "Empathy Bridge", text: "'I hear you. A lot of teams feel the same way at this stage. Here's what usually helps...'" });
  }

  return alts.slice(0, 3);
}

function computeDealScore(stage: string, momentum: { level: string; score: number }, sentiment: { engagement: string; urgency: string }, objectionCount: number, transcriptLen: number): number {
  let score = 30; // base

  // Stage bonus
  if (stage === "evaluation") score += 15;
  else if (stage === "negotiation") score += 30;
  else if (stage === "closing") score += 45;

  // Momentum
  if (momentum.level === "high") score += 15;
  else if (momentum.level === "medium") score += 8;

  // Engagement
  if (sentiment.engagement === "high") score += 10;
  else if (sentiment.engagement === "low") score -= 10;

  // Urgency
  if (sentiment.urgency === "high") score += 10;
  else if (sentiment.urgency === "medium") score += 5;

  // Objections penalty (but not too harsh — objections mean engagement)
  if (objectionCount >= 3) score -= 5;
  else if (objectionCount >= 1) score += 2; // engaged enough to object

  // Conversation depth bonus
  if (transcriptLen >= 8) score += 5;

  return Math.max(5, Math.min(95, score));
}

function predictNextMoves(stage: string, moment: string | undefined, sentiment: { engagement: string; urgency: string }, pCtx?: SessionProductContext | null): string[] {
  const moves: string[] = [];

  if (stage === "discovery") {
    moves.push("Uncover the core pain point before pitching solutions");
    moves.push("Ask: 'Who else is affected by this problem?'");
    if (sentiment.engagement === "high") moves.push("Buyer is engaged — transition to showing relevant capabilities");
  } else if (stage === "evaluation") {
    moves.push("Connect your capabilities directly to their stated requirements");
    if (sentiment.urgency === "high") moves.push("Urgency detected — propose a fast-track evaluation path");
    moves.push("Offer a focused demo on their #1 pain point");
  } else if (stage === "negotiation") {
    moves.push("Identify all decision makers — 'Who besides you needs to sign off?'");
    moves.push("Prepare mutual action plan with clear dates");
    if (pCtx?.pricing) moves.push("Have pricing breakdown ready to share");
  } else if (stage === "closing") {
    moves.push("Summarize agreed value and ask for the commitment");
    moves.push("Remove friction: 'What's the one thing that could slow this down?'");
    moves.push("Propose a specific next step with a date");
  }

  if (moment === "price") moves.push("Have ROI calculation ready");
  if (moment === "competitor") moves.push("Prepare differentiation talking points");

  return moves.slice(0, 4);
}

function startSttMock(ctx: SessionCtx) {
  if (!CONFIG.sttMock) return;
  if (ctx.sttMockStarted) return;
  ctx.sttMockStarted = true;
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
    onTranscriptFinal(ctx, line).catch(() => undefined);
  }, CONFIG.sttMockIntervalMs);
}

wss.on("connection", (ws) => {
  ws.on("close", () => {
    const meta = socketSessionMeta.get(ws);
    if (!meta) return;
    socketSessionMeta.delete(ws);
    socketsBySession.get(meta.sessionId)?.delete(ws);
    const ctx = sessions.get(meta.sessionId);
    if (ctx) {
      ctx.connectedDevices.delete(meta.deviceId);
      emitSessionState(meta.sessionId);
    }
  });

  ws.on("message", async (buf) => {
    const raw = safeJsonParse(String(buf));
    if (!raw || typeof raw.type !== "string") return;

    const type = raw.type as WsClientMessageV1["type"];

    if (type === "start") {
      if (!checkApiKeyForWsStartV1(raw, ws)) return;
      const sessionId = String(raw.session_id ?? "");
      const tenantId = String(raw.tenantId ?? "");
      const repId = String(raw.repId ?? "");
      if (!sessionId || !tenantId || !repId) return;

      const deviceType: ClientDeviceType = raw.deviceType === "mobile" || raw.deviceType === "bluetooth_remote" ? raw.deviceType : "desktop";
      const clientName = typeof raw.clientName === "string" ? raw.clientName.slice(0, 80) : undefined;
      const role: ClientRoleV1 = raw.role === "viewer" || raw.role === "controller" || raw.role === "host"
        ? raw.role
        : (deviceType === "desktop" ? "host" : "controller");

      const ctx: SessionCtx = sessions.get(sessionId) ?? {
        sessionId,
        tenantId,
        repId,
        controls: { ...DEFAULT_CONTROLS },
        seq: 0,
        memory: createSessionMemory(),
        connectedDevices: new Map(),
        learning: { helpful: 0, unhelpful: 0, ignored: 0 },
        guidanceHistory: []
      };

      if (ctx.tenantId !== tenantId || ctx.repId !== repId) {
        ws.send(JSON.stringify({ type: "error", at: new Date().toISOString(), code: "session_identity_mismatch", message: "session already bound to different tenant/rep", session_id: sessionId } satisfies WsServerMessageV1));
        try { ws.close(1008, "session_identity_mismatch"); } catch {}
        return;
      }

      sessions.set(sessionId, ctx);
      if (!socketsBySession.has(sessionId)) socketsBySession.set(sessionId, new Set());
      socketsBySession.get(sessionId)!.add(ws);

      const deviceId = `${deviceType}_${Math.random().toString(16).slice(2, 10)}`;
      ctx.connectedDevices.set(deviceId, { id: deviceId, type: deviceType, role, name: clientName });
      socketSessionMeta.set(ws, { sessionId, deviceId, role, lastControlAtMs: 0, controlBurst: 0 });

      await upsertSession({ sessionId, tenantId, repId });

      await emitLog({ tenantId, repId, session_id: sessionId, service: "server", eventType: "session_started", data: { arbitrationLocus: ARBITRATION_LOCUS } });

      ws.send(JSON.stringify({ type: "ready", session_id: sessionId, at: new Date().toISOString() } satisfies WsServerMessageV1));

      const settings: OverlayMessageV1 = { type: "settings", settings: { controls: ctx.controls } };
      ws.send(JSON.stringify({ type: "overlay_message", session_id: sessionId, at: new Date().toISOString(), message: settings } satisfies WsServerMessageV1));

      emitSessionState(sessionId);

      startSttMock(ctx);
      return;
    }

    if (type === "ping") {
      ws.send(JSON.stringify({ type: "pong", at: Number(raw.at ?? Date.now()) } satisfies WsServerMessageV1));
      return;
    }

    if (type === "stop") {
      const sessionId = String(raw.session_id ?? "");
      sessions.delete(sessionId);
      socketsBySession.get(sessionId)?.delete(ws);
      socketSessionMeta.delete(ws);
      await endSession(sessionId);
      ws.close();
      return;
    }

    if (type === "control") {
      const meta = socketSessionMeta.get(ws);
      const sessionId = String(raw.session_id ?? meta?.sessionId ?? "");
      const ctx = sessions.get(sessionId);
      if (!ctx) return;

      if (!meta || meta.sessionId !== sessionId) {
        ws.send(JSON.stringify({ type: "error", at: new Date().toISOString(), code: "invalid_session", message: "control requires active joined session", session_id: sessionId } satisfies WsServerMessageV1));
        return;
      }

      if (tooManyControls(meta)) {
        ws.send(JSON.stringify({ type: "error", at: new Date().toISOString(), code: "rate_limited", message: "too many control commands", session_id: sessionId } satisfies WsServerMessageV1));
        return;
      }

      const source: ClientDeviceType = raw.source === "mobile" || raw.source === "bluetooth_remote" ? raw.source : "desktop";
      const action = raw.action as CoachControlActionV1;
      if (!canRunControl(meta.role, action)) {
        ws.send(JSON.stringify({ type: "error", at: new Date().toISOString(), code: "forbidden_action", message: "device role cannot run this action", session_id: sessionId } satisfies WsServerMessageV1));
        return;
      }
      await applyControlCommand(ctx, action, (raw as any).value, source);
      return;
    }

    if (type === "learning_signal") {
      const meta = socketSessionMeta.get(ws);
      const sessionId = String(raw.session_id ?? meta?.sessionId ?? "");
      const ctx = sessions.get(sessionId);
      if (!ctx) return;
      if (!meta || meta.sessionId !== sessionId) return;
      const outcome = raw.outcome === "helpful" || raw.outcome === "unhelpful" ? raw.outcome : "ignored";
      applyLearningSignal(ctx, outcome);
      await emitLog({
        tenantId: ctx.tenantId,
        repId: ctx.repId,
        session_id: ctx.sessionId,
        service: "server",
        eventType: "learning_signal",
        data: { outcome, source: raw.source }
      });
      emitSessionState(ctx.sessionId);
      return;
    }

    // flush: noop in this demo
  });
});

server.listen(CONFIG.port, () => {
  // eslint-disable-next-line no-console
  console.log(`[server] listening on http://localhost:${CONFIG.port}`);

  if (CONFIG.retentionPruneEnabled) {
    const runPrune = async () => {
      try {
        const result = await enforceRetentionPolicies();
        lastRetentionPruneState = {
          at: new Date().toISOString(),
          mode: "scheduled",
          result
        };
        await emitLog({
          tenantId: "system",
          repId: "system",
          session_id: "retention",
          service: "server",
          eventType: "retention_prune_tick",
          data: result
        });
      } catch (e: any) {
        lastRetentionPruneState = {
          at: new Date().toISOString(),
          mode: "scheduled",
          error: String(e?.message ?? e)
        };
        await emitLog({
          tenantId: "system",
          repId: "system",
          session_id: "retention",
          service: "server",
          eventType: "retention_prune_error",
          data: { message: String(e?.message ?? e) }
        });
      }
    };

    runPrune().catch(() => undefined);
    setInterval(() => {
      runPrune().catch(() => undefined);
    }, CONFIG.retentionPruneIntervalMs);
  }
});