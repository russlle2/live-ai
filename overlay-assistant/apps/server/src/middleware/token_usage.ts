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

import { emitLog } from "../obs/emitLog";

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
    service: "ai_coach",
    eventType: "ai_token_usage",
    data: {
      model: record.model,
      promptTokens: record.promptTokens,
      completionTokens: record.completionTokens,
      totalTokens: record.totalTokens,
      latencyMs: record.latencyMs,
      cached: record.cached,
      // Estimated cost (gpt-4o-mini pricing: $0.15/1M input, $0.60/1M output)
      estimatedCostUsd: estimateCost(record.model, record.promptTokens, record.completionTokens)
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
 * Estimate USD cost for a given model + token counts.
 * Prices as of 2025 — update when OpenAI changes pricing.
 */
function estimateCost(model: string, promptTokens: number, completionTokens: number): number {
  const pricing: Record<string, { input: number; output: number }> = {
    "gpt-4o-mini":    { input: 0.15 / 1_000_000,  output: 0.60 / 1_000_000 },
    "gpt-4o":         { input: 2.50 / 1_000_000,   output: 10.00 / 1_000_000 },
    "gpt-4-turbo":    { input: 10.00 / 1_000_000,  output: 30.00 / 1_000_000 },
    "gpt-3.5-turbo":  { input: 0.50 / 1_000_000,   output: 1.50 / 1_000_000 },
  };

  const p = pricing[model] ?? pricing["gpt-4o-mini"];
  return promptTokens * p.input + completionTokens * p.output;
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
      estimatedCostUsd: 0,
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
    estimatedCostUsd: estimateCost("gpt-4o-mini", usage.totalPromptTokens, usage.totalCompletionTokens),
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
