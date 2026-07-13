import type { IntegrationWriteRequest, IntegrationWriteResult } from "./integration_interface.js";
import { recordIdempotentWrite } from "./idempotency.js";
import { emitLog } from "../obs/emitLog.js";

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

  emitLog({
    tenantId: req.tenantId,
    repId: "",
    service: "integration",
    eventType: "integration_write_completed",
    data: {
      integration: "hubspot",
      idempotencyKey: req.idempotencyKey,
      status: res.status,
      externalId: res.externalId
    }
  });

  return res;
}
