import type { IntegrationWriteRequest, IntegrationWriteResult } from "./integration_interface";
import { recordIdempotentWrite } from "./idempotency";
import { emitLog } from "../obs/emitLog";

export async function writeSalesforceNote(req: IntegrationWriteRequest): Promise<IntegrationWriteResult> {
  const res: IntegrationWriteResult = {
    status: "ok",
    externalId: `sf_stub_${Date.now()}`,
    message: "Stubbed Salesforce Note created"
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
      integration: "salesforce",
      idempotencyKey: req.idempotencyKey,
      status: res.status,
      externalId: res.externalId
    }
  });

  return res;
}
