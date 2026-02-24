import type { IntegrationWriteRequest, IntegrationWriteResult } from "./integration_interface";
import { recordIdempotentWrite } from "./idempotency";

export async function writeBluetoothBridgeEvent(req: IntegrationWriteRequest): Promise<IntegrationWriteResult> {
  const res: IntegrationWriteResult = {
    status: "ok",
    externalId: `ble_stub_${Date.now()}`,
    message: "Stubbed Bluetooth bridge event dispatched"
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
