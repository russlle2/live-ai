import { insertObsEvent, insertObsEvents } from "../db/queries.js";
import { opaqueLogIdentifier } from "./identifiers.js";

export { opaqueLogIdentifier } from "./identifiers.js";

export type LogLevel = "DEBUG" | "INFO" | "WARN" | "ERROR";

export type LogEnvelopeV1 = {
  schema: "obs_log_v1";
  at: string;
  level: LogLevel;
  traceId?: string;
  spanId?: string;
  parentSpanId?: string;
  session_id?: string;
  tenantId: string;
  repId: string;
  service: string;
  eventType: string;
  data: unknown;
};

const MAX_BYTES = 4096;

/* ── Write buffer for fire-and-forget batching ────────────────────── */
type PendingEvent = Parameters<typeof insertObsEvent>[0];
let writeBuffer: PendingEvent[] = [];
let flushScheduled = false;
let persistencePaused = false;
const activePersistence = new Set<Promise<void>>();
const FLUSH_INTERVAL_MS = 50;       // flush every 50ms — imperceptible delay
const FLUSH_BATCH_MAX = 64;         // flush immediately if buffer hits this

function trackPersistence(write: Promise<void>): Promise<void> {
  activePersistence.add(write);
  void write.then(
    () => activePersistence.delete(write),
    () => activePersistence.delete(write)
  );
  return write;
}

async function flushBuffer() {
  flushScheduled = false;
  if (writeBuffer.length === 0) return;
  const batch = writeBuffer.splice(0, FLUSH_BATCH_MAX);
  try {
    await trackPersistence(insertObsEventBatch(batch));
  } catch {
    // Telemetry should never crash the hot path
  }
  // If more items remain, schedule another flush
  if (writeBuffer.length > 0) scheduleFlush();
}

function scheduleFlush() {
  if (flushScheduled) return;
  flushScheduled = true;
  setTimeout(flushBuffer, FLUSH_INTERVAL_MS);
}

/** Drop not-yet-persisted telemetry before an explicit owner data purge. */
export function discardPendingObsEvents(): number {
  const discarded = writeBuffer.length;
  writeBuffer = [];
  return discarded;
}

/** Pause persistence, discard queued rows, and drain writes already handed to PostgreSQL. */
export async function beginObsDataPurge(): Promise<number> {
  persistencePaused = true;
  const discarded = discardPendingObsEvents();
  while (activePersistence.size > 0) {
    await Promise.allSettled([...activePersistence]);
  }
  return discarded;
}

/** Resume persistence only after the owner deletion transaction has completed. */
export function endObsDataPurge(): void {
  persistencePaused = false;
}

/** Batch-insert multiple obs events in one DB round trip */
async function insertObsEventBatch(events: PendingEvent[]): Promise<void> {
  if (events.length === 0) return;
  if (events.length === 1) {
    await insertObsEvent(events[0]);
    return;
  }
  await insertObsEvents(events);
}

const SENSITIVE_KEY_PATTERN = /(token|secret|password|authorization|cookie|api[_-]?key|auth[_-]?tag|iv|encrypted)/i;
const SAFE_NUMERIC_METRIC_KEYS = new Set([
  "promptTokens",
  "completionTokens",
  "totalTokens",
  "cachedTokens",
  "tokensUsed"
]);
const SECRET_VALUE_PATTERN = /\b(?:sk|sk-proj)-[a-z0-9_-]{12,}\b|\b(?:bearer|basic)\s+[a-z0-9._~+\/-]+=*|\b(?:password|passcode|api[ _-]?key|access[ _-]?token|refresh[ _-]?token|client[ _-]?secret|private[ _-]?key|one[ -]?time code|otp)\b\s*(?:is|was|:|=)?\s*[^\s,;]{3,}/gi;
const EMAIL_VALUE_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const PHONE_VALUE_PATTERN = /\b(?:\+?1[ .-]?)?\(?\d{3}\)?[ .-]\d{3}[ .-]\d{4}\b/g;
const QUERY_SECRET_PATTERN = /([?&](?:token|code|key|secret|signature|sig|auth|credential)=)[^&#\s]+/gi;
function redactStringValue(value: string): string {
  return value
    .replace(QUERY_SECRET_PATTERN, "$1[redacted]")
    .replace(SECRET_VALUE_PATTERN, "[redacted credential]")
    .replace(EMAIL_VALUE_PATTERN, "[redacted email]")
    .replace(PHONE_VALUE_PATTERN, "[redacted phone]");
}

function clampString(s: unknown, max = 200): string {
  const str = typeof s === "string" ? s : String(s ?? "");
  const noCtl = redactStringValue(str).replace(/[\u0000-\u001F\u007F]/g, "");
  return noCtl.length > max ? noCtl.slice(0, max) : noCtl;
}

/** Exported for privacy regression tests; every nested string takes the same redaction path. */
export function sanitizeLogData(value: unknown): unknown {
  return clampJson(value);
}

function clampJson(x: any, depth = 0): any {
  if (depth > 6) return "[depth_cap]";
  if (x == null) return x;
  if (typeof x === "string") return clampString(x, 600);
  if (typeof x === "number" || typeof x === "boolean") return x;
  if (Array.isArray(x)) return x.slice(0, 50).map((v) => clampJson(v, depth + 1));
  if (typeof x === "object") {
    const out: any = {};
    for (const k of Object.keys(x).slice(0, 50)) {
      const safeKey = clampString(k, 80);
      const rawValue = (x as any)[k];
      const safeNumericMetric =
        SAFE_NUMERIC_METRIC_KEYS.has(safeKey) &&
        typeof rawValue === "number" &&
        Number.isFinite(rawValue);
      out[safeKey] = SENSITIVE_KEY_PATTERN.test(safeKey) && !safeNumericMetric
        ? "[redacted]"
        : clampJson(rawValue, depth + 1);
    }
    return out;
  }
  return clampString(x, 120);
}

function bytesLen(obj: any): number {
  try {
    return new TextEncoder().encode(JSON.stringify(obj)).length;
  } catch {
    return 999999;
  }
}

/**
 * emitLog — **fire-and-forget by default**.
 * Logs are buffered and flushed in batches every 50ms.
 * The caller is never blocked by a DB write.
 *
 * Pass `{ blocking: true }` only when you need the write to complete
 * before continuing (e.g. session_started where ordering matters).
 */
export function emitLog(
  base: Omit<LogEnvelopeV1, "schema" | "at" | "level" | "data"> & {
    level?: LogLevel;
    at?: string;
    data?: unknown;
    blocking?: boolean;
  }
): void | Promise<void> {
  const env: LogEnvelopeV1 = {
    schema: "obs_log_v1",
    at: base.at ?? new Date().toISOString(),
    level: base.level ?? "INFO",
    traceId: base.traceId,
    spanId: base.spanId,
    parentSpanId: base.parentSpanId,
    session_id: opaqueLogIdentifier("session", base.session_id),
    tenantId: opaqueLogIdentifier("tenant", base.tenantId) ?? "tenant_unknown",
    repId: opaqueLogIdentifier("rep", base.repId) ?? "rep_unknown",
    service: clampString(base.service, 100),
    eventType: clampString(base.eventType, 120),
    data: sanitizeLogData(base.data ?? {})
  };

  if (bytesLen(env) > MAX_BYTES) {
    env.data = { truncated: true, eventType: env.eventType };
  }

  // stdout log (always synchronous, always fast)
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(env));

  const event: PendingEvent = {
    tenantId: env.tenantId,
    repId: env.repId,
    sessionId: env.session_id,
    service: env.service,
    eventType: env.eventType,
    data: env.data,
    at: env.at
  };

  if (persistencePaused) return base.blocking ? Promise.resolve() : undefined;

  if (base.blocking) {
    return trackPersistence(insertObsEvent(event));
  }

  // Fire-and-forget: buffer the write
  writeBuffer.push(event);
  if (writeBuffer.length >= FLUSH_BATCH_MAX) {
    flushBuffer();
  } else {
    scheduleFlush();
  }
}
