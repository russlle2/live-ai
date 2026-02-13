export async function postUiEvent(e: {
  tenantId: string;
  repId: string;
  sessionId: string;
  eventType: string;
  data?: Record<string, unknown>;
}) {
  await fetch("http://localhost:8080/api/ui-event", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(e)
  });
}
