const API_KEY = (import.meta as any).env?.VITE_OVERLAY_API_KEY as string | undefined;
export async function postUiEvent(e: {
  tenantId: string;
  repId: string;
  sessionId: string;
  eventType: string;
  data?: Record<string, unknown>;
}) {
  await fetch("http://localhost:8080/api/ui-event", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(API_KEY ? { "x-overlay-key": API_KEY } : {}) },
    body: JSON.stringify(e)
  });
}