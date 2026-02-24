import type { IntegrationWriteRequest, IntegrationWriteResult } from "./integration_interface";
import { recordIdempotentWrite } from "./idempotency";
import { connectorEnvFor } from "./connector_config";
import { signPayload } from "./webhook_signing";
import { postJsonOutbound } from "./outbound_http";

export async function writeServerWebhookEvent(req: IntegrationWriteRequest): Promise<IntegrationWriteResult> {
  const cfg = connectorEnvFor("server_webhook");
  let res: IntegrationWriteResult;

  if (!cfg?.endpoint) {
    res = {
      status: "retryable_error",
      externalId: `webhook_cfg_missing_${Date.now()}`,
      message: "SERVER_WEBHOOK_URL is not configured"
    };
  } else {
    const outbound = await postJsonOutbound({
      url: cfg.endpoint,
      payload: req.payload,
      bearerToken: cfg.token,
      signature: signPayload(req.payload, cfg.signingSecret)
    });
    res = outbound.ok
      ? {
          status: "ok",
          externalId: `webhook_${Date.now()}`,
          message: `Webhook dispatched (${outbound.status})`
        }
      : {
          status: outbound.status >= 500 || outbound.status === 599 ? "retryable_error" : "fatal_error",
          externalId: `webhook_err_${Date.now()}`,
          message: `Webhook failed (${outbound.status}): ${outbound.bodyText}`
        };
  }

  await recordIdempotentWrite({
    tenantId: req.tenantId,
    integration: req.integration,
    idempotencyKey: req.idempotencyKey,
    status: res.status,
    request: req,
    response: res
  });

  return res;
}
