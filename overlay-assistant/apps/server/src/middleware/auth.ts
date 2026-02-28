/**
 * JWT Authentication Middleware
 *
 * Validates Bearer tokens on protected routes.
 * In demo/dev mode (JWT_SECRET not set), creates a pass-through
 * identity from query params or defaults so developers can test
 * without setting up auth infrastructure.
 */

import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { CONFIG } from "../config";

export type AuthPayload = {
  tenantId: string;
  repId: string;
  role: "rep" | "admin" | "viewer";
  iat?: number;
  exp?: number;
};

declare global {
  namespace Express {
    interface Request {
      auth?: AuthPayload;
    }
  }
}

/**
 * Sign a JWT for a tenant + rep. Used by the login/register endpoint.
 */
export function signToken(payload: Omit<AuthPayload, "iat" | "exp">): string {
  if (!CONFIG.jwtSecret) throw new Error("JWT_SECRET is not configured");
  return jwt.sign(payload, CONFIG.jwtSecret, { expiresIn: CONFIG.authTokenTtl as jwt.SignOptions["expiresIn"] });
}

/**
 * Verify and decode a JWT.
 */
function verifyToken(token: string): AuthPayload | null {
  try {
    return jwt.verify(token, CONFIG.jwtSecret) as AuthPayload;
  } catch {
    return null;
  }
}

export function decodeAuthToken(token: string): AuthPayload | null {
  if (!CONFIG.jwtSecret) return null;
  return verifyToken(token);
}

/**
 * requireAuth — Express middleware.
 *
 * When JWT_SECRET is set:
 *   → Requires a valid Bearer token in the Authorization header.
 *   → Populates req.auth with { tenantId, repId, role }.
 *
 * When JWT_SECRET is NOT set (dev/demo mode):
 *   → Passes through with a demo identity.
 *   → Logs a warning on first request.
 */
let devWarned = false;

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  // ── Dev/demo bypass ──
  if (!CONFIG.jwtSecret) {
    if (process.env.NODE_ENV === "production" && !CONFIG.allowInsecureDemoAuth) {
      res.status(503).json({
        ok: false,
        error: "auth_not_configured",
        message: "JWT auth must be configured in production"
      });
      return;
    }

    if (!devWarned) {
      console.warn("[auth] JWT_SECRET not set — running in DEMO MODE (no auth enforced). Set JWT_SECRET in .env for production.");
      devWarned = true;
    }
    req.auth = {
      tenantId: (req.body?.tenantId as string) || (req.query?.tenantId as string) || "tenant_demo",
      repId: (req.body?.repId as string) || (req.query?.repId as string) || "rep_demo",
      role: "admin"
    };
    next();
    return;
  }

  // ── Extract token ──
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    res.status(401).json({ ok: false, error: "missing_auth_token", message: "Authorization: Bearer <token> required" });
    return;
  }

  const token = header.slice(7);
  const payload = verifyToken(token);

  if (!payload) {
    res.status(401).json({ ok: false, error: "invalid_auth_token", message: "Token is expired or invalid" });
    return;
  }

  req.auth = payload;
  next();
}
