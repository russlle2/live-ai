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
