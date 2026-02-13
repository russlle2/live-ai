import http from "http";
import crypto from "crypto";
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

type SessionCtx = {
  sessionId: string;
  tenantId: string;
  repId: string;
  controls: GuidanceControls;
  seq: number;
};

const DEFAULT_CONTROLS: GuidanceControls = {
  guidanceMode: "assist",
  guidanceMuted: false,
  aiDepth: "P0",
  showLowConfidence: false
};

const app = express();
app.use(express.json({ limit: "256kb" }));
app.use(cors({ origin: CONFIG.webOrigin, credentials: true }));

app.get("/health", (_req, res) => res.json({ ok: true, arbitrationLocus: ARBITRATION_LOCUS }));

const TranscriptFinalInput = z.object({
  session_id: z.string().min(1),
  text: z.string().min(1).max(2000)
});

app.post("/api/demo/transcript_final", async (req, res) => {
  const parsed = TranscriptFinalInput.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ ok: false, error: parsed.error.flatten() });

  const { session_id, text } = parsed.data;
  const ctx = sessions.get(session_id);
  if (!ctx) return res.status(404).json({ ok: false, error: "unknown_session" });

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
  for (const ws of set) {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
  }
}

async function onTranscriptFinal(ctx: SessionCtx, text: string) {
  ctx.seq += 1;

  const transcriptHash = crypto.createHash("sha256").update(text.toLowerCase()).digest("hex");
  await emitLog({
    tenantId: ctx.tenantId,
    repId: ctx.repId,
    session_id: ctx.sessionId,
    service: "server",
    eventType: "transcript_final_received",
    data: { transcriptHash, transcriptLen: text.length }
  });

  broadcast(ctx.sessionId, { type: "transcript_final", session_id: ctx.sessionId, seq: ctx.seq, at: new Date().toISOString(), text });

  const decision = arbitrateV1({ text, controls: ctx.controls, domainKeywords: ["security", "soc2", "crm", "integration"] });

  // v1 strict: we patch the overlay text directly (guidance patching can be enabled later once schemas align).
  const suggestionText = ((decision as any)?.items?.[0]?.suggestedText ?? (decision as any)?.items?.[0]?.text ?? "").toString();
  const rawPatch = { text: suggestionText.length ? suggestionText : "Ask a clarifying question and reflect their concern." };

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

  const overlayMsg: OverlayMessageV1 = { type: "patch", patch: (s as any).patch };
  broadcast(ctx.sessionId, { type: "overlay_message", session_id: ctx.sessionId, at: new Date().toISOString(), message: overlayMsg });
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
    onTranscriptFinal(ctx, line).catch(() => undefined);
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

      const ctx: SessionCtx = { sessionId, tenantId, repId, controls: { ...DEFAULT_CONTROLS }, seq: 0 };

      sessions.set(sessionId, ctx);
      if (!socketsBySession.has(sessionId)) socketsBySession.set(sessionId, new Set());
      socketsBySession.get(sessionId)!.add(ws);

      await upsertSession({ sessionId, tenantId, repId });

      await emitLog({ tenantId, repId, session_id: sessionId, service: "server", eventType: "session_started", data: { arbitrationLocus: ARBITRATION_LOCUS } });

      ws.send(JSON.stringify({ type: "ready", session_id: sessionId, at: new Date().toISOString() } satisfies WsServerMessageV1));

      const settings: OverlayMessageV1 = { type: "settings", settings: { controls: ctx.controls } };
      ws.send(JSON.stringify({ type: "overlay_message", session_id: sessionId, at: new Date().toISOString(), message: settings } satisfies WsServerMessageV1));

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
});

server.listen(CONFIG.port, () => {
  // eslint-disable-next-line no-console
  console.log(`[server] listening on http://localhost:${CONFIG.port}`);
});
