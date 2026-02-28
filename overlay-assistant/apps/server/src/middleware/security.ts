import type { Request, Response, NextFunction } from "express";
import { randomUUID } from "node:crypto";
import { CONFIG } from "../config";

const SECURITY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(self), geolocation=(), usb=(), payment=()",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-site"
};

function buildCsp(): string {
  const webOrigin = CONFIG.webOrigin === "*" ? "'self'" : CONFIG.webOrigin;
  return [
    "default-src 'self'",
    `connect-src 'self' ${webOrigin} ws: wss:`,
    "img-src 'self' data:",
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
  const requestId = String(req.headers["x-request-id"] ?? randomUUID());
  res.setHeader("X-Request-Id", requestId);
  (req as Request & { requestId?: string }).requestId = requestId;
  next();
}
