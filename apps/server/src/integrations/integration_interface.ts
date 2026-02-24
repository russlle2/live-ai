export type IntegrationName =
  | "salesforce"
  | "hubspot"
  | "zoom"
  | "google_meet"
  | "google_workspace"
  | "bluetooth_bridge"
  | "server_webhook";

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
