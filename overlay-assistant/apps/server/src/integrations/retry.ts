import type { IntegrationWriteRequest, IntegrationWriteResult } from "./integration_interface.js";
import { emitLog } from "../obs/emitLog.js";

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 500;

/**
 * Deterministic exponential backoff with jitter.
 * Wraps any integration write function with retry logic + observability.
 */
export async function withRetry(
  writeFn: (req: IntegrationWriteRequest) => Promise<IntegrationWriteResult>,
  req: IntegrationWriteRequest
): Promise<IntegrationWriteResult> {
  let attempt = 0;
  let lastResult: IntegrationWriteResult | undefined;

  while (attempt < MAX_RETRIES) {
    attempt += 1;
    const startMs = Date.now();

    try {
      lastResult = await writeFn(req);
    } catch (err: any) {
      lastResult = {
        status: "retryable_error",
        message: err?.message ?? "unknown_error"
      };
    }

    const latencyMs = Date.now() - startMs;

    // Emit observability event for every attempt
    emitLog({
      tenantId: req.tenantId,
      repId: "",
      service: "integration",
      eventType: "integration_write_attempt",
      data: {
        integration: req.integration,
        idempotencyKey: req.idempotencyKey,
        attempt,
        status: lastResult.status,
        latencyMs,
        message: lastResult.message
      }
    });

    if (lastResult.status === "ok" || lastResult.status === "fatal_error") {
      return lastResult;
    }

    // Exponential backoff with jitter for retryable errors
    const delay = BASE_DELAY_MS * Math.pow(2, attempt - 1) + Math.random() * 200;
    await new Promise((resolve) => setTimeout(resolve, delay));
  }

  // All retries exhausted
  emitLog({
    tenantId: req.tenantId,
    repId: "",
    service: "integration",
    eventType: "integration_write_exhausted",
    data: {
      integration: req.integration,
      idempotencyKey: req.idempotencyKey,
      attempts: attempt,
      lastStatus: lastResult?.status
    }
  });

  return lastResult ?? { status: "fatal_error", message: "all_retries_exhausted" };
}
