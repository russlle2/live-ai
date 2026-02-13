import { insertObsEvent } from "../db/queries";

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

function clampString(s: unknown, max = 200): string {
  const str = typeof s === "string" ? s : String(s ?? "");
  const noCtl = str.replace(/[\u0000-\u001F\u007F]/g, "");
  return noCtl.length > max ? noCtl.slice(0, max) : noCtl;
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
      out[clampString(k, 80)] = clampJson((x as any)[k], depth + 1);
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

export async function emitLog(base: Omit<LogEnvelopeV1, "schema" | "at" | "level" | "data"> & { level?: LogLevel; at?: string; data?: unknown }): Promise<void> {
  const env: LogEnvelopeV1 = {
    schema: "obs_log_v1",
    at: base.at ?? new Date().toISOString(),
    level: base.level ?? "INFO",
    traceId: base.traceId,
    spanId: base.spanId,
    parentSpanId: base.parentSpanId,
    session_id: base.session_id,
    tenantId: base.tenantId,
    repId: base.repId,
    service: base.service,
    eventType: clampString(base.eventType, 120),
    data: clampJson(base.data ?? {})
  };

  if (bytesLen(env) > MAX_BYTES) {
    env.data = { truncated: true, eventType: env.eventType };
  }

  // eslint-disable-next-line no-console
  console.log(JSON.stringify(env));

  await insertObsEvent({
    tenantId: env.tenantId,
    repId: env.repId,
    sessionId: env.session_id,
    service: env.service,
    eventType: env.eventType,
    data: env.data,
    at: env.at
  });
}
