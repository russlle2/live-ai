import http from "http";
import express from "express";
import cors from "cors";
import compression from "compression";
import { WebSocketServer } from "ws";
import { z } from "zod";

import {
  sanitizePatch_v1,
  type WsClientMessageV1,
  type WsServerMessageV1,
  type OverlayMessageV1,
  type GuidanceControls
} from "@overlay-assistant/shared";

import { CONFIG, ARBITRATION_LOCUS } from "./config";
import { upsertSession, endSession, getTrustSummaryForTenant } from "./db/queries";
import { pool, pingDb } from "./db/pool";
import { emitLog } from "./obs/emitLog";
import { arbitrateV1 } from "./arbitration/arbitration_v1";
import { getAiCoaching, isAiCoachEnabled } from "./arbitration/ai_coach_v1";
import { writeSalesforceNote } from "./integrations/salesforce_stub";
import { writeHubspotNote } from "./integrations/hubspot_stub";
import { withRetry } from "./integrations/retry";
import { decodeAuthToken, requireAuth, signToken } from "./middleware/auth";
import { rateLimitCoaching, clearSessionRateLimit, createRouteRateLimit, getRateLimitStats } from "./middleware/rate_limit";
import { getTenantUsageSummary, getAllTenantUsage } from "./middleware/token_usage";
import { applySecurityHeaders, requestContext } from "./middleware/security";

type Speaker = "rep" | "lead" | "unknown";

type ProductContext = {
  productName?: string;
  differentiators?: string;
  competitors?: string;
  targetIndustry?: string;
  commonObjections?: string;
};

type ConversationTurn = { speaker: Speaker; text: string };

type SessionCtx = {
  sessionId: string;
  tenantId: string;
  repId: string;
  controls: GuidanceControls;
  seq: number;
  speaker: Speaker;
  lastActivity: number;
  productContext?: ProductContext;
  conversationHistory: ConversationTurn[];
};

const DEFAULT_CONTROLS: GuidanceControls = {
  guidanceMode: "assist",
  guidanceMuted: false,
  aiDepth: "P0",
  showLowConfidence: false
};

const app = express();
app.disable("x-powered-by");
if (CONFIG.trustProxy) app.set("trust proxy", 1);
app.use(requestContext);
app.use(applySecurityHeaders);
if (CONFIG.compressionEnabled) app.use(compression());
app.use(express.json({ limit: "256kb" }));
app.use(cors({
  origin: CONFIG.webOrigin === "*" ? true : CONFIG.webOrigin,
  credentials: true,
  maxAge: 86400 // cache preflight for 24h
}));

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
  if (req.auth.role === "admin") return true;
  return req.auth.tenantId === tenantId;
}

function asyncRoute<T extends express.Request>(
  fn: (req: T, res: express.Response) => Promise<unknown>
) {
  return (req: T, res: express.Response, next: express.NextFunction) => {
    Promise.resolve(fn(req, res)).catch(next);
  };
}

app.get("/health", asyncRoute(async (_req, res) => {
  const dbOk = await pingDb();
  const status = dbOk ? 200 : 503;
  return res.status(status).json({
    ok: dbOk,
    arbitrationLocus: ARBITRATION_LOCUS,
    db: dbOk ? "connected" : "unreachable",
    uptime: Math.round(process.uptime()),
    timestamp: new Date().toISOString()
  });
}));

const TranscriptFinalInput = z.object({
  session_id: z.string().min(1),
  text: z.string().min(1).max(2000),
  speaker: z.enum(["rep", "lead", "unknown"]).optional().default("unknown"),
  productContext: z.object({
    productName: z.string().max(200).optional(),
    differentiators: z.string().max(2000).optional(),
    competitors: z.string().max(1000).optional(),
    targetIndustry: z.string().max(200).optional(),
    commonObjections: z.string().max(2000).optional(),
  }).optional()
}).strict();

/* ── Auth: login endpoint (returns JWT for SaaS users) ──────── */
const LoginInput = z.object({
  tenantId: z.string().min(1).max(100),
  repId: z.string().min(1).max(100),
  role: z.enum(["rep", "admin", "viewer"]).optional().default("rep")
}).strict();

app.post("/api/auth/login", authRateLimit, (req, res) => {
  const parsed = LoginInput.safeParse(req.body);
  if (!parsed.success) return sendErr(res, 400, "validation_error", "Invalid login request", parsed.error.flatten());
  if (!CONFIG.jwtSecret) {
    if (process.env.NODE_ENV === "production" && !CONFIG.allowInsecureDemoAuth) {
      return sendErr(res, 503, "auth_not_configured", "JWT auth must be configured in production");
    }
    return sendOk(res, { token: "demo-mode", mode: "demo", expiresIn: CONFIG.authTokenTtl });
  }
  const token = signToken({ tenantId: parsed.data.tenantId, repId: parsed.data.repId, role: parsed.data.role });
  return sendOk(res, { token, mode: "jwt", expiresIn: CONFIG.authTokenTtl });
});

app.post("/api/demo/transcript_final", requireAuth, rateLimitCoaching, asyncRoute(async (req, res) => {
  const parsed = TranscriptFinalInput.safeParse(req.body);
  if (!parsed.success) return sendErr(res, 400, "validation_error", "Invalid transcript payload", parsed.error.flatten());

  const { session_id, text, speaker, productContext } = parsed.data;
  const ctx = sessions.get(session_id);
  if (!ctx) return sendErr(res, 404, "unknown_session");
  if (!assertTenantAccess(req, ctx.tenantId)) return sendErr(res, 403, "forbidden", "Tenant mismatch");

  ctx.speaker = speaker ?? ctx.speaker;
  if (productContext) ctx.productContext = productContext;
  onTranscriptFinal(ctx, text);
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

app.post("/api/ui-event", requireAuth, telemetryRateLimit, asyncRoute(async (req, res) => {
  const parsed = UiEventInput.safeParse(req.body);
  if (!parsed.success) return sendErr(res, 400, "validation_error", "Invalid UI event payload", parsed.error.flatten());

  const e = parsed.data;
  if (!assertTenantAccess(req, e.tenantId)) return sendErr(res, 403, "forbidden", "Tenant mismatch");

  // Hard guard: block obvious transcript leakage fields
  const dataStr = JSON.stringify(e.data ?? {});
  if (/transcript|utterance|raw_text|full_text/i.test(dataStr)) {
    return sendErr(res, 400, "ui_event_contains_disallowed_fields");
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

const IntegrationInput = z.object({
  tenantId: z.string().min(1),
  integration: z.enum(["salesforce", "hubspot"]),
  idempotencyKey: z.string().min(8),
  payload: z.record(z.any())
}).strict();

app.post("/api/integrations/write-note", requireAuth, asyncRoute(async (req, res) => {
  const parsed = IntegrationInput.safeParse(req.body);
  if (!parsed.success) return sendErr(res, 400, "validation_error", "Invalid integration payload", parsed.error.flatten());
  const body = parsed.data;
  if (!assertTenantAccess(req, body.tenantId)) return sendErr(res, 403, "forbidden", "Tenant mismatch");

  const req0 = { tenantId: body.tenantId, integration: body.integration, idempotencyKey: body.idempotencyKey, payload: body.payload };

  const writeFn = body.integration === "salesforce" ? writeSalesforceNote : writeHubspotNote;
  const result = await withRetry(writeFn, req0);
  return sendOk(res, { result });
}));

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: CONFIG.wsPath, maxPayload: 64 * 1024 });

const sessions = new Map<string, SessionCtx>();
const socketsBySession = new Map<string, Set<any>>();
let totalWsConnections = 0;

/* ── Patch coalescer: prevent patch spam ───────────────────────── */
const COALESCE_WINDOW_MS = 500;
const pendingPatch = new Map<string, { timer: ReturnType<typeof setTimeout>; patch: any; at: string; ctx: SessionCtx }>();

function coalescePatch(sessionId: string, ctx: SessionCtx, overlayMsg: OverlayMessageV1, at: string, bytes: number, latencyMs?: number) {
  const existing = pendingPatch.get(sessionId);
  if (existing) {
    clearTimeout(existing.timer);
    emitLog({
      tenantId: ctx.tenantId, repId: ctx.repId, session_id: ctx.sessionId,
      service: "server", eventType: "patch_coalesced",
      data: { reason: "superseded_within_window" }
    });
  }
  const timer = setTimeout(() => {
    pendingPatch.delete(sessionId);
    emitLog({
      tenantId: ctx.tenantId, repId: ctx.repId, session_id: ctx.sessionId,
      service: "server", eventType: "patch_received",
      data: { bytes, latencyMs }
    });
    broadcast(sessionId, { type: "overlay_message", session_id: sessionId, at, message: overlayMsg });
  }, COALESCE_WINDOW_MS);
  pendingPatch.set(sessionId, { timer, patch: overlayMsg, at, ctx });
}

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

/**
 * onTranscriptFinal — the HOT PATH.
 *
 * When OPENAI_API_KEY is set:
 *   → Uses GPT for contextual, specific coaching (async, ~200–800ms)
 *   → Falls back to templates if API fails
 *
 * When no API key:
 *   → Uses regex + template matching (synchronous, <1ms)
 */
async function onTranscriptFinal(ctx: SessionCtx, text: string) {
  ctx.seq += 1;
  ctx.lastActivity = Date.now();
  const now = new Date().toISOString();

  // ── Store in conversation history (keep last 20 turns) ──
  ctx.conversationHistory.push({ speaker: ctx.speaker, text });
  if (ctx.conversationHistory.length > 20) {
    ctx.conversationHistory = ctx.conversationHistory.slice(-20);
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

  // ── 2. Run arbitration (sync template fallback always computed) ──
  const decision = arbitrateV1({
    text,
    controls: ctx.controls,
    domainKeywords: baseKeywords,
    speaker: ctx.speaker
  });

  const transcriptHash = decision.trace.transcriptHash;

  // ── 3. Fire-and-forget: log receipt ──
  emitLog({
    tenantId: ctx.tenantId,
    repId: ctx.repId,
    session_id: ctx.sessionId,
    service: "server",
    eventType: "transcript_final_received",
    data: { transcriptHash, transcriptLen: text.length, latencyMs: decision.trace.latencyMs, cacheHit: decision.trace.cacheHit, aiEnabled: isAiCoachEnabled() }
  });

  // ── 4. Broadcast transcript back ──
  broadcast(ctx.sessionId, { type: "transcript_final", session_id: ctx.sessionId, seq: ctx.seq, at: now, text });

  // ── 5. Get coaching — AI if available, else templates ──
  let coachingText: string;
  let aiGenerated = false;

  if (isAiCoachEnabled()) {
    const aiResult = await getAiCoaching({
      currentText: text,
      speaker: ctx.speaker,
      conversationHistory: ctx.conversationHistory.slice(0, -1), // exclude current (already in prompt)
      productContext: ctx.productContext,
      tenantId: ctx.tenantId,
      repId: ctx.repId,
      sessionId: ctx.sessionId
    });

    if (aiResult) {
      coachingText = aiResult.coaching;
      aiGenerated = true;
    } else {
      // Fallback to templates
      coachingText = (decision.items?.[0]?.text ?? "").toString();
    }
  } else {
    coachingText = (decision.items?.[0]?.text ?? "").toString();
  }

  // Final fallback
  if (!coachingText) {
    coachingText = "Say: \"That\u2019s a great point \u2014 tell me more about that. What would the ideal solution look like for your team?\"";
  }

  const rawPatch = { text: coachingText };

  const s = sanitizePatch_v1(rawPatch);
  if (!s.ok) {
    emitLog({
      tenantId: ctx.tenantId,
      repId: ctx.repId,
      session_id: ctx.sessionId,
      service: "server",
      eventType: "patch_rejected",
      data: { reason: (s as any).reason, detailSafe: (s as any).detailSafe, bytes: (s as any).bytes }
    });
    const fail: OverlayMessageV1 = { type: "settings", settings: { controls: ctx.controls, status: { failureCode: "patch_rejected" } } };
    broadcast(ctx.sessionId, { type: "overlay_message", session_id: ctx.sessionId, at: now, message: fail });
    return;
  }

  // ── 6. Coalesce and send ──
  const overlayMsg: OverlayMessageV1 = { type: "patch", patch: (s as any).patch };
  coalescePatch(ctx.sessionId, ctx, overlayMsg, now, (s as any).bytes, decision.trace.latencyMs);
}

function startSttMock(ctx: SessionCtx) {
  if (!CONFIG.sttMock) return;
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
    onTranscriptFinal(ctx, line);
  }, CONFIG.sttMockIntervalMs);
}

wss.on("connection", (ws) => {
  totalWsConnections++;

  // ── Connection limit guard ──
  if (totalWsConnections > CONFIG.maxWsConnections) {
    ws.close(1013, "server_at_capacity");
    totalWsConnections--;
    return;
  }

  ws.on("message", async (buf) => {
    const raw = safeJsonParse(String(buf));
    if (!raw || typeof raw.type !== "string") return;

    const type = raw.type as WsClientMessageV1["type"];

    if (type === "start") {
      const sessionId = String(raw.session_id ?? "");
      const tenantId = String(raw.tenantId ?? "");
      const repId = String(raw.repId ?? "");
      const token = String(raw.token ?? "");
      if (!sessionId || !tenantId || !repId) return;

      if (CONFIG.jwtSecret) {
        if (!token) {
          ws.send(JSON.stringify({ type: "error", at: new Date().toISOString(), message: "missing_auth_token", code: "missing_auth_token" } satisfies WsServerMessageV1));
          ws.close();
          return;
        }
        const payload = decodeAuthToken(token);
        if (!payload || (payload.role !== "admin" && payload.tenantId !== tenantId)) {
          ws.send(JSON.stringify({ type: "error", at: new Date().toISOString(), message: "invalid_auth_token", code: "invalid_auth_token" } satisfies WsServerMessageV1));
          ws.close();
          return;
        }
      }

      const ctx: SessionCtx = { sessionId, tenantId, repId, controls: { ...DEFAULT_CONTROLS }, seq: 0, speaker: "unknown", lastActivity: Date.now(), conversationHistory: [] };

      sessions.set(sessionId, ctx);
      if (!socketsBySession.has(sessionId)) socketsBySession.set(sessionId, new Set());
      socketsBySession.get(sessionId)!.add(ws);

      // Send ready + settings IMMEDIATELY — before any DB calls
      ws.send(JSON.stringify({ type: "ready", session_id: sessionId, at: new Date().toISOString() } satisfies WsServerMessageV1));

      const settings: OverlayMessageV1 = { type: "settings", settings: { controls: ctx.controls } };
      ws.send(JSON.stringify({ type: "overlay_message", session_id: sessionId, at: new Date().toISOString(), message: settings } satisfies WsServerMessageV1));

      // Fire-and-forget: DB writes happen in background (never block the client)
      upsertSession({ sessionId, tenantId, repId }).catch(() => {});
      emitLog({ tenantId, repId, session_id: sessionId, service: "server", eventType: "session_started", data: { arbitrationLocus: ARBITRATION_LOCUS } });

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
      clearSessionRateLimit(sessionId);
      await endSession(sessionId);
      ws.close();
      return;
    }

    // flush: noop in this demo
  });

  /* ── Server-side heartbeat: ping every 25s, timeout at 35s ─── */
  const pingInterval = setInterval(() => {
    if (ws.readyState === ws.OPEN) {
      ws.ping();
    }
  }, 25_000);

  ws.on("pong", () => { /* client is alive */ });

  ws.on("close", () => {
    totalWsConnections--;
    clearInterval(pingInterval);
    // Clean up socket from all session sets
    for (const [sid, socks] of socketsBySession.entries()) {
      socks.delete(ws);
      if (socks.size === 0) socketsBySession.delete(sid);
    }
  });
});

/* ── Health metrics endpoint (Step 15) ──────────────────────── */
app.get("/api/health/metrics", (_req, res) => {
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
app.get("/api/ai-status", (_req, res) => {
  sendOk(res, {
    aiCoachEnabled: isAiCoachEnabled(),
    model: isAiCoachEnabled() ? CONFIG.openaiModel : null,
    mode: isAiCoachEnabled() ? "ai" : "templates"
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

app.use((_req, res) => {
  sendErr(res, 404, "not_found");
});

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const message = err instanceof Error ? err.message : "unknown_error";
  return sendErr(res, 500, "internal_error", process.env.NODE_ENV === "development" ? message : undefined);
});

/* ── Session timeout cleanup (every 60s, reap inactive sessions) ── */
const SESSION_CLEANUP_INTERVAL = 60_000;
const sessionCleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const [sid, ctx] of sessions.entries()) {
    if (now - ctx.lastActivity > CONFIG.sessionTimeoutMs) {
      sessions.delete(sid);
      const socks = socketsBySession.get(sid);
      if (socks) {
        for (const ws of socks) {
          try { ws.close(1000, "session_timeout"); } catch { /* ignore */ }
        }
        socketsBySession.delete(sid);
      }
      clearSessionRateLimit(sid);
      endSession(sid).catch(() => {});
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

server.listen(CONFIG.port, () => {
  // eslint-disable-next-line no-console
  console.log(`[server] listening on http://localhost:${CONFIG.port}`);
  // eslint-disable-next-line no-console
  console.log(`[server] WebSocket path: ${CONFIG.wsPath} | AI: ${isAiCoachEnabled() ? CONFIG.openaiModel : "templates"} | Locus: ${ARBITRATION_LOCUS}`);
});
