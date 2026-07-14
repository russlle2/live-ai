import { withClient } from "../db/pool.js";

export async function recordIdempotentWrite(params: {
  tenantId: string;
  integration: string;
  idempotencyKey: string;
  status: string;
  request: unknown;
  response: unknown;
}): Promise<void> {
  await withClient(async (c) => {
    await c.query(
      `INSERT INTO crm_write_events(tenant_id, integration, idempotency_key, status, request, response)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb)
       ON CONFLICT (tenant_id, integration, idempotency_key)
       DO UPDATE SET status=EXCLUDED.status, response=EXCLUDED.response`,
      [
        params.tenantId,
        params.integration,
        params.idempotencyKey,
        params.status,
        JSON.stringify(params.request ?? {}),
        JSON.stringify(params.response ?? {})
      ]
    );
  });
}
