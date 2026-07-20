import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(scriptDir, "..");
const overlayRoot = path.resolve(serverRoot, "../..");
const port = Number(process.env.SMOKE_PORT ?? 18081);
const baseUrl = `http://127.0.0.1:${port}`;
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "live-ai-runtime-smoke-"));
const output = [];
const smokeAccessCode = "runtime-smoke-access-code";

const server = spawn(process.execPath, ["dist/index.js"], {
  cwd: serverRoot,
  env: {
    ...process.env,
    PORT: String(port),
    NODE_ENV: "test",
    ALLOW_INSECURE_DEMO_AUTH: "0",
    JWT_SECRET: "runtime-smoke-only-jwt-secret-at-least-32-characters",
    PERSONAL_ACCESS_CODE: smokeAccessCode,
    PRIVATE_STORAGE_ENCRYPTION_KEY: "runtime-smoke-private-storage-key-at-least-32-characters",
    OPENAI_API_KEY: "",
    GOOGLE_CLIENT_ID: "",
    GOOGLE_CLIENT_SECRET: "",
    DATABASE_REQUIRED: "0",
    DATABASE_URL: "postgres://smoke:smoke@127.0.0.1:1/smoke",
    SPEAKER_SERVICE_URL: "http://127.0.0.1:1",
    STT_MOCK: "0",
    PERSONAL_MEMORY_PATH: path.join(temporary, "personal-memory.json"),
    SESSION_LOG_DIR: temporary,
    WEB_DIST_PATH: path.join(overlayRoot, "apps/web/dist")
  },
  stdio: ["ignore", "pipe", "pipe"]
});

for (const stream of [server.stdout, server.stderr]) {
  stream.setEncoding("utf8");
  stream.on("data", (chunk) => {
    output.push(String(chunk));
    if (output.length > 40) output.shift();
  });
}

async function fetchJson(route, token) {
  const response = await fetch(`${baseUrl}${route}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    signal: AbortSignal.timeout(2_000)
  });
  assert.equal(response.ok, true, `${route} returned ${response.status}`);
  return response.json();
}

async function login() {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ accessCode: smokeAccessCode }),
    signal: AbortSignal.timeout(2_000)
  });
  assert.equal(response.ok, true, `/api/auth/login returned ${response.status}`);
  const payload = await response.json();
  assert.equal(typeof payload.token, "string");
  return payload.token;
}

async function waitForServer() {
  let lastError;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (server.exitCode !== null) throw new Error(`server exited early with ${server.exitCode}`);
    try {
      return await fetchJson("/health");
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw lastError ?? new Error("server did not become ready");
}

async function checkWebSocket(token) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  const messages = [];
  const guidanceId = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("websocket smoke timed out")), 5_000);
    ws.on("open", () => {
      ws.send(JSON.stringify({
        type: "start",
        session_id: "runtime-smoke-session",
        tenantId: "personal",
        repId: "owner",
        token,
        deviceRole: "audio_host",
        profile: {
          mode: "interview",
          targetRole: "Support representative",
          company: "Example employer",
          goal: "Complete a truthful interview"
        }
      }));
    });
    ws.on("message", (data) => {
      const message = JSON.parse(String(data));
      messages.push(message);
      const ready = messages.some((item) => item.type === "ready");
      const greeting = messages.find((item) =>
        item.type === "overlay_message" &&
        item.coaching?.playbookStageId === "greeting" &&
        item.coaching?.phase === "final" &&
        typeof item.coaching?.guidanceId === "string" &&
        item.message?.type === "patch" &&
        typeof item.message?.patch?.text === "string" &&
        item.message.patch.text.startsWith("Say:")
      );
      if (ready && greeting) {
        clearTimeout(timeout);
        resolve(greeting.coaching.guidanceId);
      }
    });
    ws.on("error", reject);
  });
  assert.match(String(guidanceId), /^guidance-/);
  const feedback = await fetch(`${baseUrl}/api/ui-event`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      tenantId: "personal",
      repId: "owner",
      sessionId: "runtime-smoke-session",
      eventType: "suggestion_applied",
      data: { guidanceId }
    }),
    signal: AbortSignal.timeout(2_000)
  });
  assert.equal(feedback.ok, true, `guidance feedback returned ${feedback.status}`);

  const interruptionMessage = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("interruption event timed out")), 2_000);
    const onMessage = (data) => {
      const message = JSON.parse(String(data));
      if (message.type !== "interruption_detected") return;
      clearTimeout(timeout);
      ws.off("message", onMessage);
      resolve(message);
    };
    ws.on("message", onMessage);
  });
  const runtimeEvent = (eventId, sourceId, speaker, turnId) => ({
    protocolVersion: 2,
    eventId,
    sessionId: "runtime-smoke-session",
    sourceId,
    sequence: 1,
    capturedAtMonotonicMs: 100,
    capturedAt: "2026-07-20T18:00:00.000Z",
    receivedAt: "2026-07-20T18:00:00.000Z",
    privacyClass: "private",
    provenance: "separated_channel",
    confidence: 1,
    payload: { type: "speech.started", turnId, speaker }
  });
  for (const event of [
    runtimeEvent("event-owner", "owner-mic", "owner", "turn-owner"),
    runtimeEvent("event-remote", "remote-tab", "remote", "turn-remote")
  ]) {
    const response = await fetch(`${baseUrl}/api/runtime/events`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(event),
      signal: AbortSignal.timeout(2_000)
    });
    assert.equal(response.ok, true, `runtime event returned ${response.status}`);
  }
  assert.deepEqual(await interruptionMessage, {
    type: "interruption_detected",
    session_id: "runtime-smoke-session",
    at: "2026-07-20T18:00:00.000Z",
    interruptedTurnId: "turn-owner",
    interruptingTurnId: "turn-remote"
  });
  await checkSecondAudioHostRejected(token);
  ws.send(JSON.stringify({ type: "stop", session_id: "runtime-smoke-session" }));
  ws.close();
}

async function checkSecondAudioHostRejected(token) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("second audio-host rejection timed out")),
      2_000
    );
    ws.on("open", () => {
      ws.send(JSON.stringify({
        type: "start",
        session_id: "runtime-smoke-session",
        tenantId: "personal",
        repId: "owner",
        deviceRole: "audio_host",
        token
      }));
    });
    ws.on("message", (data) => {
      const message = JSON.parse(String(data));
      if (message.message !== "audio_host_already_connected") return;
      clearTimeout(timeout);
      resolve();
    });
    ws.on("error", reject);
  });
  ws.close();
}

async function checkPreStartWebSocketDenied() {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  const result = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("pre-start websocket was not closed")), 3_000);
    let sawError = false;
    ws.on("open", () => ws.send(JSON.stringify({ type: "ping", at: Date.now() })));
    ws.on("message", (data) => {
      const message = JSON.parse(String(data));
      if (message.code === "missing_auth_token") sawError = true;
    });
    ws.on("close", (code) => {
      clearTimeout(timeout);
      resolve({ code, sawError });
    });
    ws.on("error", reject);
  });
  assert.deepEqual(result, { code: 1008, sawError: true });
}

try {
  const health = await waitForServer();
  assert.equal(health.ok, true);
  assert.equal(health.status, "degraded");
  const unauthenticatedAiStatus = await fetch(`${baseUrl}/api/ai-status`, {
    signal: AbortSignal.timeout(2_000)
  });
  assert.equal(unauthenticatedAiStatus.status, 401);
  const token = await login();

  const runtime = await fetchJson("/api/runtime/status", token);
  assert.equal(runtime.automation.apiKey.configured, false);
  assert.equal(runtime.automation.coachingKnowledge.loaded, true);
  assert.equal(runtime.automation.coachingKnowledge.total, 96);
  assert.equal(runtime.automation.coachingKnowledge.separateFromPersonalMemory, true);
  assert.deepEqual(runtime.automation.coachingKnowledge.byDomain, {
    interview: 16,
    insurance_sales: 16,
    it_support: 16,
    inbound_service: 16,
    negotiation: 16,
    professional_growth: 16
  });

  const aiStatus = await fetchJson("/api/ai-status", token);
  assert.equal(aiStatus.aiCoachEnabled, false);
  assert.equal(aiStatus.mode, "deterministic");
  const metrics = await fetchJson("/api/health/metrics", token);
  assert.equal(typeof metrics.uptime, "number");
  await checkWebSocket(token);
  await checkPreStartWebSocketDenied();

  process.stdout.write(JSON.stringify({
    ok: true,
    health: health.status,
    coachingExamples: runtime.automation.coachingKnowledge.total,
    websocket: "ready_greeting_and_prestart_denial"
  }) + "\n");
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  if (output.length) process.stderr.write(`server output:\n${output.join("").slice(-4_000)}\n`);
  process.exitCode = 1;
} finally {
  if (server.exitCode === null) server.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => server.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 2_000))
  ]);
  if (server.exitCode === null) server.kill("SIGKILL");
  await fs.rm(temporary, { recursive: true, force: true });
}
