/**
 * Token Usage Logger
 *
 * Tracks OpenAI token consumption per tenant for:
 *   - Cost monitoring and billing
 *   - Usage-based pricing tiers
 *   - Abuse detection
 *
 * Stores usage in the obs_events table with event_type = "ai_token_usage"
 * and provides aggregation queries for dashboards.
 */

import { emitLog } from "../obs/emitLog.js";

export type TokenUsageRecord = {
  tenantId: string;
  repId: string;
  sessionId: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  latencyMs: number;
  cached: boolean;
  service?: string;
};

// ── In-memory aggregates for fast dashboard queries ──
type TenantUsage = {
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalRequests: number;
  totalLatencyMs: number;
  firstSeen: number;
  lastSeen: number;
};

const tenantUsage = new Map<string, TenantUsage>();

/** Clear in-memory token/request/timestamp aggregates during owner deletion. */
export function clearAllTokenUsage(): number {
  const removed = tenantUsage.size;
  tenantUsage.clear();
  return removed;
}

/**
 * Log a single OpenAI API call's token usage.
 * Called after every successful AI coaching response.
 */
export async function logTokenUsage(record: TokenUsageRecord): Promise<void> {
  // ── 1. Persist to obs_events (DB) ──
  await emitLog({
    tenantId: record.tenantId,
    repId: record.repId,
    session_id: record.sessionId,
    service: record.service ?? "ai_coach",
    eventType: "ai_token_usage",
    data: {
      model: record.model,
      promptTokens: record.promptTokens,
      completionTokens: record.completionTokens,
      totalTokens: record.totalTokens,
      latencyMs: record.latencyMs,
      cached: record.cached
    }
  });

  // ── 2. Update in-memory aggregates ──
  const now = Date.now();
  const existing = tenantUsage.get(record.tenantId);
  if (existing) {
    existing.totalPromptTokens += record.promptTokens;
    existing.totalCompletionTokens += record.completionTokens;
    existing.totalRequests += 1;
    existing.totalLatencyMs += record.latencyMs;
    existing.lastSeen = now;
  } else {
    tenantUsage.set(record.tenantId, {
      totalPromptTokens: record.promptTokens,
      totalCompletionTokens: record.completionTokens,
      totalRequests: 1,
      totalLatencyMs: record.latencyMs,
      firstSeen: now,
      lastSeen: now
    });
  }
}

/**
 * Get usage summary for a specific tenant.
 */
export function getTenantUsageSummary(tenantId: string) {
  const usage = tenantUsage.get(tenantId);
  if (!usage) {
    return {
      tenantId,
      totalRequests: 0,
      totalTokens: 0,
      costEstimateStatus: "unavailable_incomplete_metering" as const,
      avgLatencyMs: 0
    };
  }

  const totalTokens = usage.totalPromptTokens + usage.totalCompletionTokens;
  return {
    tenantId,
    totalRequests: usage.totalRequests,
    totalTokens,
    promptTokens: usage.totalPromptTokens,
    completionTokens: usage.totalCompletionTokens,
    costEstimateStatus: "unavailable_incomplete_metering" as const,
    avgLatencyMs: Math.round(usage.totalLatencyMs / usage.totalRequests),
    firstSeen: new Date(usage.firstSeen).toISOString(),
    lastSeen: new Date(usage.lastSeen).toISOString()
  };
}

/**
 * Get usage summaries for all tenants (admin dashboard).
 */
export function getAllTenantUsage() {
  const result: ReturnType<typeof getTenantUsageSummary>[] = [];
  for (const tenantId of tenantUsage.keys()) {
    result.push(getTenantUsageSummary(tenantId));
  }
  return result.sort((a, b) => b.totalTokens - a.totalTokens);
}
