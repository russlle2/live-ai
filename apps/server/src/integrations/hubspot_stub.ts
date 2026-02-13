import type { IntegrationWriteRequest, IntegrationWriteResult } from "./integration_interface";
import { recordIdempotentWrite } from "./idempotency";

export async function writeHubspotNote(req: IntegrationWriteRequest): Promise<IntegrationWriteResult> {
  const res: IntegrationWriteResult = {
    status: "ok",
    externalId: `hs_stub_${Date.now()}`,
    message: "Stubbed HubSpot Note created"
  };

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
