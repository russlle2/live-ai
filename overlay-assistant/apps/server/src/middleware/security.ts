import type { Request, Response, NextFunction } from "express";
import { randomUUID } from "node:crypto";
import { CONFIG } from "../config.js";

const SECURITY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(self), display-capture=(self), geolocation=(), usb=(), payment=()",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-site",
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
  "Pragma": "no-cache"
};
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

export function safeRequestId(
  value: unknown,
  fallback: () => string = randomUUID
): string {
  if (typeof value === "string" && REQUEST_ID_PATTERN.test(value)) return value;
  const generated = fallback();
  if (!REQUEST_ID_PATTERN.test(generated)) {
    throw new Error("Request ID generator returned an invalid identifier");
  }
  return generated;
}

function buildCsp(): string {
  const webOrigin = CONFIG.webOrigin === "*" ? "'self'" : CONFIG.webOrigin;
  return [
    "default-src 'self'",
    `connect-src 'self' ${webOrigin} ws: wss: https://api.openai.com https://huggingface.co https://*.huggingface.co`,
    "img-src 'self' data:",
    "media-src 'self' blob:",
    "worker-src 'self' blob:",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "script-src 'self'",
    "base-uri 'self'",
    "frame-ancestors 'none'"
  ].join("; ");
}

export function applySecurityHeaders(req: Request, res: Response, next: NextFunction): void {
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) {
    res.setHeader(k, v);
  }

  res.setHeader("Content-Security-Policy", buildCsp());

  if (req.secure || req.headers["x-forwarded-proto"] === "https") {
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }

  next();
}

export function requestContext(req: Request, res: Response, next: NextFunction): void {
  const requestId = safeRequestId(req.headers["x-request-id"]);
  res.setHeader("X-Request-Id", requestId);
  (req as Request & { requestId?: string }).requestId = requestId;
  next();
}
