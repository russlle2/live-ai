import { API_BASE, apiHeaders } from "./config";

export async function postUiEvent(e: {
  tenantId: string;
  repId: string;
  sessionId: string;
  eventType: string;
  data?: Record<string, unknown>;
}) {
  await fetch(`${API_BASE}/api/ui-event`, {
    method: "POST",
    headers: apiHeaders(),
    body: JSON.stringify(e)
  });
}