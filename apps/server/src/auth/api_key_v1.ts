import type { Request, Response, NextFunction } from "express";

function getKey(): string {
  return (process.env.OVERLAY_API_KEY || "").trim();
}

/**
 * Protects /api/* endpoints with X-Overlay-Key (or ?key=...)
 * If OVERLAY_API_KEY is unset, auth is disabled (dev/demo friendly).
 */
export function requireApiKeyForApiV1(req: Request, res: Response, next: NextFunction) {
  const key = getKey();
  if (!key) return next();

  const hdr = (req.header("x-overlay-key") || "").trim();
  const q = (typeof req.query.key === "string" ? req.query.key : "").trim();
  const got = hdr || q;

  if (got === key) return next();
  return res.status(401).json({ ok: false, error: "unauthorized" });
}

/**
 * Protects WebSocket "start" message by requiring apiKey in the payload.
 * If OVERLAY_API_KEY is unset, auth is disabled.
 */
export function checkApiKeyForWsStartV1(raw: any, ws: any): boolean {
  const key = getKey();
  if (!key) return true;

  const got = (raw?.apiKey ?? raw?.api_key ?? "").toString().trim();
  if (got === key) return true;

  try { ws.close(1008, "unauthorized"); } catch {}
  return false;
}
