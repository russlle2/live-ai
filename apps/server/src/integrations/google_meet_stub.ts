import type { IntegrationWriteRequest, IntegrationWriteResult } from "./integration_interface";
import { recordIdempotentWrite } from "./idempotency";
import { connectorEnvFor, resolveBearerTokenForIntegration } from "./connector_config";
import { signPayload } from "./webhook_signing";
import { postJsonOutbound } from "./outbound_http";

export async function writeGoogleMeetEvent(req: IntegrationWriteRequest): Promise<IntegrationWriteResult> {
  const cfg = connectorEnvFor("google_meet");
  let res: IntegrationWriteResult;

  if (!cfg?.endpoint) {
    res = {
      status: "retryable_error",
      externalId: `gmeet_cfg_missing_${Date.now()}`,
      message: "GOOGLE_MEET_WEBHOOK_URL is not configured"
    };
  } else {
    const outbound = await postJsonOutbound({
      url: cfg.endpoint,
      payload: req.payload,
      bearerToken: await resolveBearerTokenForIntegration({ tenantId: req.tenantId, integration: req.integration, staticToken: cfg.token }),
      signature: signPayload(req.payload, cfg.signingSecret)
    });
    res = outbound.ok
      ? { status: "ok", externalId: `gmeet_${Date.now()}`, message: `Google Meet connector dispatched (${outbound.status})` }
      : {
          status: outbound.status >= 500 || outbound.status === 599 ? "retryable_error" : "fatal_error",
          externalId: `gmeet_err_${Date.now()}`,
          message: `Google Meet connector failed (${outbound.status}): ${outbound.bodyText}`
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
