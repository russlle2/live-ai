import type { IntegrationWriteRequest, IntegrationWriteResult } from "./integration_interface";
import { recordIdempotentWrite } from "./idempotency";
import { connectorEnvFor, resolveBearerTokenForIntegration } from "./connector_config";
import { signPayload } from "./webhook_signing";
import { postJsonOutbound } from "./outbound_http";

export async function writeGoogleWorkspaceEvent(req: IntegrationWriteRequest): Promise<IntegrationWriteResult> {
  const cfg = connectorEnvFor("google_workspace");
  let res: IntegrationWriteResult;

  if (!cfg?.endpoint) {
    res = {
      status: "retryable_error",
      externalId: `gws_cfg_missing_${Date.now()}`,
      message: "GOOGLE_WORKSPACE_WEBHOOK_URL is not configured"
    };
  } else {
    const outbound = await postJsonOutbound({
      url: cfg.endpoint,
      payload: req.payload,
      bearerToken: await resolveBearerTokenForIntegration({ tenantId: req.tenantId, integration: req.integration, staticToken: cfg.token }),
      signature: signPayload(req.payload, cfg.signingSecret)
    });
    res = outbound.ok
      ? { status: "ok", externalId: `gws_${Date.now()}`, message: `Google Workspace connector dispatched (${outbound.status})` }
      : {
          status: outbound.status >= 500 || outbound.status === 599 ? "retryable_error" : "fatal_error",
          externalId: `gws_err_${Date.now()}`,
          message: `Google Workspace connector failed (${outbound.status}): ${outbound.bodyText}`
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
