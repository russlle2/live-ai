import http from "http";
import express from "express";
import cors from "cors";
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
import { emitLog } from "./obs/emitLog";
import { arbitrateV1 } from "./arbitration/arbitration_v1";
import { writeSalesforceNote } from "./integrations/salesforce_stub";
import { writeHubspotNote } from "./integrations/hubspot_stub";

type Speaker = "rep" | "lead" | "unknown";

type ProductContext = {
  productName?: string;
  differentiators?: string;
  competitors?: string;
  targetIndustry?: string;
  commonObjections?: string;
};

type SessionCtx = {
  sessionId: string;
  tenantId: string;
  repId: string;
  controls: GuidanceControls;
  seq: number;
  speaker: Speaker;
  lastActivity: number;
  productContext?: ProductContext;
};

const DEFAULT_CONTROLS: GuidanceControls = {
  guidanceMode: "assist",
  guidanceMuted: false,
  aiDepth: "P0",
  showLowConfidence: false
};

const app = express();
app.use(express.json({ limit: "256kb" }));
app.use(cors({ origin: CONFIG.webOrigin === "*" ? true : CONFIG.webOrigin, credentials: true }));

app.get("/health", (_req, res) => res.json({ ok: true, arbitrationLocus: ARBITRATION_LOCUS }));

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
});

app.post("/api/demo/transcript_final", async (req, res) => {
  const parsed = TranscriptFinalInput.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ ok: false, error: parsed.error.flatten() });

  const { session_id, text, speaker, productContext } = parsed.data;
  const ctx = sessions.get(session_id);
  if (!ctx) return res.status(404).json({ ok: false, error: "unknown_session" });

  ctx.speaker = speaker ?? ctx.speaker;
  if (productContext) ctx.productContext = productContext;
  onTranscriptFinal(ctx, text);
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

const IntegrationInput = z.object({
  tenantId: z.string().min(1),
  integration: z.enum(["salesforce", "hubspot"]),
  idempotencyKey: z.string().min(8),
  payload: z.record(z.any())
});

app.post("/api/integrations/write-note", async (req, res) => {
  const parsed = IntegrationInput.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ ok: false, error: parsed.error.flatten() });
  const body = parsed.data;

  const req0 = { tenantId: body.tenantId, integration: body.integration, idempotencyKey: body.idempotencyKey, payload: body.payload };

  const result = body.integration === "salesforce" ? await writeSalesforceNote(req0) : await writeHubspotNote(req0);
  return res.json({ ok: true, result });
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: CONFIG.wsPath });

const sessions = new Map<string, SessionCtx>();
const socketsBySession = new Map<string, Set<any>>();

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
 * ZERO awaits on the critical path:
 *   1. arbitrateV1() is synchronous (regex + template lookup, ≈0.1ms)
 *   2. sanitizePatch_v1() is synchronous (≈0.01ms)
 *   3. broadcast() is synchronous (ws.send is non-blocking)
 *   4. emitLog() is fire-and-forget (buffered, flushed every 50ms)
 *
 * The SHA-256 hash is computed once inside arbitrateV1 and reused
 * from the decision trace — no duplicate hashing.
 */
function onTranscriptFinal(ctx: SessionCtx, text: string) {
  ctx.seq += 1;
  ctx.lastActivity = Date.now();
  const now = new Date().toISOString();

  // ── 1. Build product-aware domain keywords ──
  const baseKeywords = ["security", "soc2", "crm", "integration"];
  const pc = ctx.productContext;
  if (pc) {
    if (pc.productName) baseKeywords.push(...pc.productName.toLowerCase().split(/\s+/));
    if (pc.differentiators) baseKeywords.push(...pc.differentiators.toLowerCase().split(/[,;\n]+/).map(s => s.trim()).filter(Boolean).slice(0, 10));
    if (pc.competitors) baseKeywords.push(...pc.competitors.toLowerCase().split(/[,;\n]+/).map(s => s.trim()).filter(Boolean).slice(0, 5));
    if (pc.targetIndustry) baseKeywords.push(...pc.targetIndustry.toLowerCase().split(/[,;\s]+/).filter(Boolean).slice(0, 3));
  }

  // ── 2. Run arbitration (synchronous, cached) ──
  const decision = arbitrateV1({
    text,
    controls: ctx.controls,
    domainKeywords: baseKeywords,
    speaker: ctx.speaker
  });

  // Reuse the transcript hash from the arbitration trace (no double SHA-256)
  const transcriptHash = decision.trace.transcriptHash;

  // ── 2. Fire-and-forget: log receipt (non-blocking) ──
  emitLog({
    tenantId: ctx.tenantId,
    repId: ctx.repId,
    session_id: ctx.sessionId,
    service: "server",
    eventType: "transcript_final_received",
    data: { transcriptHash, transcriptLen: text.length, latencyMs: decision.trace.latencyMs, cacheHit: decision.trace.cacheHit }
  });

  // ── 3. Broadcast transcript back (synchronous) ──
  broadcast(ctx.sessionId, { type: "transcript_final", session_id: ctx.sessionId, seq: ctx.seq, at: now, text });

  // ── 4. Build patch (synchronous) ──
  const suggestionText = (decision.items?.[0]?.text ?? "").toString();
  const rawPatch = {
    text: suggestionText.length
      ? suggestionText
      : "Say: \"That\u2019s a great point \u2014 tell me more about that. What would the ideal solution look like for your team?\""
  };

  const s = sanitizePatch_v1(rawPatch);
  if (!s.ok) {
    // Fire-and-forget: log rejection (non-blocking)
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

  // ── 5. Fire-and-forget: log success (non-blocking) ──
  emitLog({
    tenantId: ctx.tenantId,
    repId: ctx.repId,
    session_id: ctx.sessionId,
    service: "server",
    eventType: "patch_received",
    data: { bytes: (s as any).bytes, latencyMs: decision.trace.latencyMs }
  });

  // ── 6. Broadcast guidance to client (synchronous) ──
  const overlayMsg: OverlayMessageV1 = { type: "patch", patch: (s as any).patch };
  broadcast(ctx.sessionId, { type: "overlay_message", session_id: ctx.sessionId, at: now, message: overlayMsg });
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
  ws.on("message", async (buf) => {
    const raw = safeJsonParse(String(buf));
    if (!raw || typeof raw.type !== "string") return;

    const type = raw.type as WsClientMessageV1["type"];

    if (type === "start") {
      const sessionId = String(raw.session_id ?? "");
      const tenantId = String(raw.tenantId ?? "");
      const repId = String(raw.repId ?? "");
      if (!sessionId || !tenantId || !repId) return;

      const ctx: SessionCtx = { sessionId, tenantId, repId, controls: { ...DEFAULT_CONTROLS }, seq: 0, speaker: "unknown", lastActivity: Date.now() };

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
  res.json({
    ok: true,
    activeSessions,
    activeConnections,
    uptime: process.uptime(),
    memoryMB: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
    arbitrationLocus: ARBITRATION_LOCUS
  });
});

server.listen(CONFIG.port, () => {
  // eslint-disable-next-line no-console
  console.log(`[server] listening on http://localhost:${CONFIG.port}`);
});
