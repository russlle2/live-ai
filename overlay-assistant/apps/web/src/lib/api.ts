export async function postUiEvent(
  e: {
    tenantId: string;
    repId: string;
    sessionId: string;
    eventType: string;
    data?: Record<string, unknown>;
  },
  httpBase?: string
) {
  const base = httpBase || "http://localhost:8080";
  try {
    await fetch(`${base}/api/ui-event`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(e),
    });
  } catch {
    // Silently fail — telemetry should never break the UX
    console.warn("[api] Failed to send UI event:", e.eventType);
  }
}

export type CrmWriteResult = {
  ok: boolean;
  result?: { status: string; externalId?: string; message?: string };
  error?: unknown;
};

export async function postCrmNote(
  params: {
    tenantId: string;
    integration: "salesforce" | "hubspot";
    idempotencyKey: string;
    payload: Record<string, unknown>;
  },
  httpBase?: string
): Promise<CrmWriteResult> {
  const base = httpBase || "http://localhost:8080";
  try {
    const res = await fetch(`${base}/api/integrations/write-note`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
    });
    return await res.json();
  } catch (err) {
    console.warn("[api] Failed to write CRM note:", err);
    return { ok: false, error: "network_error" };
  }
}
