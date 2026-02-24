import crypto from "crypto";

export function signPayload(payload: unknown, secret?: string): string | undefined {
  if (!secret) return undefined;
  const body = JSON.stringify(payload ?? {});
  return crypto.createHmac("sha256", secret).update(body).digest("hex");
}
