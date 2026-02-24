import { CONNECTOR_CONFIG, assertAllowedHost } from "./connector_config";

export async function postJsonOutbound(args: {
  url: string;
  payload: unknown;
  bearerToken?: string;
  signature?: string;
}): Promise<{ ok: boolean; status: number; bodyText: string }> {
  const hostCheck = assertAllowedHost(args.url);
  if (!hostCheck.ok) {
    return { ok: false, status: 400, bodyText: hostCheck.reason };
  }

  const ac = new AbortController();
  const timeout = setTimeout(() => ac.abort(), Math.max(1000, CONNECTOR_CONFIG.requestTimeoutMs));

  try {
    const headers: Record<string, string> = {
      "content-type": "application/json"
    };
    if (args.bearerToken) headers.authorization = `Bearer ${args.bearerToken}`;
    if (args.signature) headers["x-overlay-signature"] = args.signature;

    const res = await fetch(args.url, {
      method: "POST",
      headers,
      body: JSON.stringify(args.payload ?? {}),
      signal: ac.signal
    });

    const bodyText = await res.text();
    return { ok: res.ok, status: res.status, bodyText: bodyText.slice(0, 2000) };
  } catch (e: any) {
    return { ok: false, status: 599, bodyText: String(e?.message ?? "outbound_request_failed") };
  } finally {
    clearTimeout(timeout);
  }
}
