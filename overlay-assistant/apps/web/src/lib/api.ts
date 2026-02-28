type RequestOptions = {
  method?: "GET" | "POST";
  body?: Record<string, unknown>;
  token?: string | null;
};

async function requestJson<T>(path: string, httpBase?: string, options: RequestOptions = {}): Promise<T> {
  const base = httpBase || "http://localhost:8080";
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (options.token) headers.Authorization = `Bearer ${options.token}`;

  const res = await fetch(`${base}${path}`, {
    method: options.method ?? "GET",
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((json as any)?.message || (json as any)?.error || `request_failed_${res.status}`);
  }
  return json as T;
}

export async function postUiEvent(
  e: {
    tenantId: string;
    repId: string;
    sessionId: string;
    eventType: string;
    data?: Record<string, unknown>;
  },
  httpBase?: string,
  token?: string | null
) {
  try {
    await requestJson("/api/ui-event", httpBase, { method: "POST", body: e, token });
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
  httpBase?: string,
  token?: string | null
): Promise<CrmWriteResult> {
  try {
    return await requestJson<CrmWriteResult>("/api/integrations/write-note", httpBase, {
      method: "POST",
      body: params,
      token
    });
  } catch (err) {
    console.warn("[api] Failed to write CRM note:", err);
    return { ok: false, error: "network_error" };
  }
}

export async function login(
  credentials: { tenantId: string; repId: string; role?: "rep" | "admin" | "viewer" },
  httpBase?: string
): Promise<{ token: string; mode: "demo" | "jwt" }> {
  const data = await requestJson<{ ok: true; token: string; mode: "demo" | "jwt" }>("/api/auth/login", httpBase, {
    method: "POST",
    body: credentials
  });
  return { token: data.token, mode: data.mode };
}
