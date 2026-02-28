/**
 * Per-Tenant Rate Limiter
 *
 * Sliding-window rate limiting keyed by tenant ID.
 * Prevents any single tenant from burning excessive OpenAI tokens
 * or abusing the coaching endpoint.
 *
 * Limits:
 *   - 60 coaching requests per session (per transcript_final route)
 *   - 200 requests per tenant per hour
 *   - 20 requests per tenant per minute (burst protection)
 *
 * All limits are configurable via environment variables.
 */

import type { Request, Response, NextFunction } from "express";
import { emitLog } from "../obs/emitLog";

type WindowEntry = { timestamps: number[]; blocked: number };

// ── Per-tenant hourly window ──
const tenantHourly = new Map<string, WindowEntry>();
// ── Per-tenant per-minute burst window ──
const tenantMinute = new Map<string, WindowEntry>();
// ── Per-session lifetime counter ──
const sessionCounter = new Map<string, { count: number; blocked: number }>();

const HOUR_MS = 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

// Configurable limits (env vars or defaults)
const MAX_PER_SESSION = Number(process.env.RATE_LIMIT_PER_SESSION ?? 60);
const MAX_PER_TENANT_HOUR = Number(process.env.RATE_LIMIT_PER_TENANT_HOUR ?? 200);
const MAX_PER_TENANT_MINUTE = Number(process.env.RATE_LIMIT_PER_TENANT_MINUTE ?? 20);

/**
 * Prune timestamps older than the window.
 */
function pruneWindow(entry: WindowEntry, windowMs: number, now: number): void {
  const cutoff = now - windowMs;
  while (entry.timestamps.length > 0 && entry.timestamps[0] < cutoff) {
    entry.timestamps.shift();
  }
}

/**
 * Clean up stale entries periodically (every 10 minutes).
 */
const cleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const [k, v] of tenantHourly) {
    pruneWindow(v, HOUR_MS, now);
    if (v.timestamps.length === 0) tenantHourly.delete(k);
  }
  for (const [k, v] of tenantMinute) {
    pruneWindow(v, MINUTE_MS, now);
    if (v.timestamps.length === 0) tenantMinute.delete(k);
  }
  // Session counters are cleaned up when sessions end — no action needed here
}, 10 * MINUTE_MS);

cleanupTimer.unref();

/**
 * rateLimitCoaching — Express middleware for the transcript_final route.
 *
 * Checks three limits:
 *   1. Per-session lifetime (prevents a single session from running up cost)
 *   2. Per-tenant per-minute (burst protection)
 *   3. Per-tenant per-hour (sustained abuse protection)
 *
 * Returns 429 with Retry-After header if limit is exceeded.
 */
export function rateLimitCoaching(req: Request, res: Response, next: NextFunction): void {
  const tenantId = req.auth?.tenantId || req.body?.tenantId || "unknown";
  const sessionId = req.body?.session_id || "unknown";
  const now = Date.now();

  // ── 1. Per-session limit ──
  if (!sessionCounter.has(sessionId)) {
    sessionCounter.set(sessionId, { count: 0, blocked: 0 });
  }
  const sess = sessionCounter.get(sessionId)!;
  if (sess.count >= MAX_PER_SESSION) {
    sess.blocked++;
    logRateLimited(tenantId, sessionId, "session_limit", MAX_PER_SESSION);
    res.status(429).json({
      ok: false,
      error: "rate_limited",
      detail: `Session limit reached (${MAX_PER_SESSION} coaching requests per session)`,
      retryAfter: "Start a new session"
    });
    return;
  }

  // ── 2. Per-tenant per-minute burst limit ──
  if (!tenantMinute.has(tenantId)) {
    tenantMinute.set(tenantId, { timestamps: [], blocked: 0 });
  }
  const minuteEntry = tenantMinute.get(tenantId)!;
  pruneWindow(minuteEntry, MINUTE_MS, now);
  if (minuteEntry.timestamps.length >= MAX_PER_TENANT_MINUTE) {
    minuteEntry.blocked++;
    logRateLimited(tenantId, sessionId, "minute_burst", MAX_PER_TENANT_MINUTE);
    const retryMs = Math.ceil((minuteEntry.timestamps[0] + MINUTE_MS - now) / 1000);
    res.set("Retry-After", String(retryMs));
    res.status(429).json({
      ok: false,
      error: "rate_limited",
      detail: `Too many requests (${MAX_PER_TENANT_MINUTE}/min limit)`,
      retryAfter: `${retryMs}s`
    });
    return;
  }

  // ── 3. Per-tenant per-hour sustained limit ──
  if (!tenantHourly.has(tenantId)) {
    tenantHourly.set(tenantId, { timestamps: [], blocked: 0 });
  }
  const hourEntry = tenantHourly.get(tenantId)!;
  pruneWindow(hourEntry, HOUR_MS, now);
  if (hourEntry.timestamps.length >= MAX_PER_TENANT_HOUR) {
    hourEntry.blocked++;
    logRateLimited(tenantId, sessionId, "hourly_limit", MAX_PER_TENANT_HOUR);
    const retryMs = Math.ceil((hourEntry.timestamps[0] + HOUR_MS - now) / 1000);
    res.set("Retry-After", String(retryMs));
    res.status(429).json({
      ok: false,
      error: "rate_limited",
      detail: `Hourly limit reached (${MAX_PER_TENANT_HOUR}/hour)`,
      retryAfter: `${retryMs}s`
    });
    return;
  }

  // ── All checks passed — record the request ──
  sess.count++;
  minuteEntry.timestamps.push(now);
  hourEntry.timestamps.push(now);
  next();
}

/**
 * Clean up session counter when a session ends.
 */
export function clearSessionRateLimit(sessionId: string): void {
  sessionCounter.delete(sessionId);
}

/**
 * Get rate limit stats for monitoring/admin.
 */
export function getRateLimitStats() {
  return {
    activeTenants: tenantHourly.size,
    activeSessions: sessionCounter.size,
    limits: {
      perSession: MAX_PER_SESSION,
      perTenantMinute: MAX_PER_TENANT_MINUTE,
      perTenantHour: MAX_PER_TENANT_HOUR
    }
  };
}

function logRateLimited(tenantId: string, sessionId: string, limitType: string, limit: number): void {
  emitLog({
    tenantId,
    repId: "system",
    session_id: sessionId,
    service: "server",
    eventType: "rate_limited",
    data: { limitType, limit }
  });
}

type RouteWindow = { timestamps: number[] };

export function createRouteRateLimit(options: {
  key: string;
  max: number;
  windowMs: number;
  keySelector: (req: Request) => string;
}) {
  const buckets = new Map<string, RouteWindow>();

  return function routeRateLimit(req: Request, res: Response, next: NextFunction): void {
    const now = Date.now();
    const key = `${options.key}:${options.keySelector(req) || "anonymous"}`;
    const bucket = buckets.get(key) ?? { timestamps: [] };
    pruneWindow(bucket as WindowEntry, options.windowMs, now);

    if (bucket.timestamps.length >= options.max) {
      const retryMs = Math.ceil((bucket.timestamps[0] + options.windowMs - now) / 1000);
      res.set("Retry-After", String(Math.max(1, retryMs)));
      res.status(429).json({
        ok: false,
        error: "rate_limited",
        detail: `Too many requests for ${options.key}`,
        retryAfter: `${Math.max(1, retryMs)}s`
      });
      return;
    }

    bucket.timestamps.push(now);
    buckets.set(key, bucket);
    next();
  };
}
