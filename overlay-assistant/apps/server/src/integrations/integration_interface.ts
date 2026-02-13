export type IntegrationName = "salesforce" | "hubspot";

export type IntegrationWriteRequest = {
  tenantId: string;
  integration: IntegrationName;
  idempotencyKey: string;
  payload: Record<string, unknown>;
};

export type IntegrationWriteResult = {
  status: "ok" | "retryable_error" | "fatal_error";
  externalId?: string;
  message?: string;
};
