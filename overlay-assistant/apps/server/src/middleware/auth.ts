/**
 * JWT Authentication Middleware
 *
 * Validates Bearer tokens on protected routes.
 * Only the explicit ALLOW_INSECURE_DEMO_AUTH switch creates the fixed
 * personal-owner demo identity. Missing credentials never enable a bypass.
 */

import type { Request, Response, NextFunction } from "express";
import { createHash, timingSafeEqual } from "node:crypto";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { CONFIG } from "../config.js";

const JWT_ISSUER = "live-rhetoric";
const JWT_AUDIENCE = "live-rhetoric-owner";
const JWT_SUBJECT = "owner";

export const PersonalOwnerAuthPayloadSchema = z.object({
  tenantId: z.literal("personal"),
  repId: z.literal("owner"),
  role: z.literal("admin"),
  iat: z.number().int().optional(),
  exp: z.number().int().optional()
}).strip();
export type AuthPayload = z.infer<typeof PersonalOwnerAuthPayloadSchema>;

export const PERSONAL_OWNER_AUTH_PAYLOAD = Object.freeze({
  tenantId: "personal",
  repId: "owner",
  role: "admin" as const
});

/**
 * Login is intentionally a one-owner operation. Legacy clients may still send
 * tenant, rep, or role fields, but Zod strips them before authorization so a
 * caller can never choose the identity or elevate a role.
 */
export const PersonalLoginInputSchema = z.object({
  accessCode: z.string().max(1000).optional()
}).strip();

export type AuthRuntimePolicy = {
  jwtConfigured: boolean;
  personalAccessCodeConfigured: boolean;
  allowInsecureDemoAuth: boolean;
  nodeEnv: string;
};

export type AuthRuntimeMode = "jwt" | "insecure_demo" | "unconfigured";

export function currentAuthRuntimePolicy(): AuthRuntimePolicy {
  return {
    jwtConfigured: CONFIG.jwtSecret.length >= 32,
    personalAccessCodeConfigured: CONFIG.personalAccessCode.length >= 12,
    allowInsecureDemoAuth: CONFIG.allowInsecureDemoAuth,
    nodeEnv: CONFIG.nodeEnv
  };
}

/** Missing JWT auth is allowed only through the explicit demo switch. */
export function resolveAuthRuntimeMode(policy: AuthRuntimePolicy): AuthRuntimeMode {
  if (policy.jwtConfigured) return "jwt";
  if (policy.allowInsecureDemoAuth) return "insecure_demo";
  return "unconfigured";
}

export type PersonalLoginDecision =
  | {
      ok: true;
      mode: "jwt" | "demo";
      identity: typeof PERSONAL_OWNER_AUTH_PAYLOAD;
    }
  | {
      ok: false;
      status: 401 | 503;
      code: "auth_not_configured" | "personal_access_code_not_configured" | "invalid_access_code";
      message: string;
    };

export function authorizePersonalLogin(params: {
  policy: AuthRuntimePolicy;
  configuredAccessCode: string;
  candidateAccessCode?: string;
}): PersonalLoginDecision {
  const mode = resolveAuthRuntimeMode(params.policy);
  if (mode === "unconfigured") {
    return {
      ok: false,
      status: 503,
      code: "auth_not_configured",
      message: "JWT auth must be configured in production"
    };
  }
  if (mode === "insecure_demo") {
    return { ok: true, mode: "demo", identity: PERSONAL_OWNER_AUTH_PAYLOAD };
  }
  if (!params.policy.personalAccessCodeConfigured || !params.configuredAccessCode) {
    return {
      ok: false,
      status: 503,
      code: "personal_access_code_not_configured",
      message: "PERSONAL_ACCESS_CODE must contain at least 12 characters before JWT login is enabled"
    };
  }
  if (!constantTimeSecretMatches(params.configuredAccessCode, params.candidateAccessCode)) {
    return {
      ok: false,
      status: 401,
      code: "invalid_access_code",
      message: "The personal access code is missing or incorrect"
    };
  }
  return { ok: true, mode: "jwt", identity: PERSONAL_OWNER_AUTH_PAYLOAD };
}

export type WebSocketStartAuthDecision =
  | { ok: true; mode: "jwt" | "demo"; identity: AuthPayload }
  | {
      ok: false;
      code: "auth_not_configured" | "missing_auth_token" | "invalid_auth_token";
    };

/** Shared, unit-testable admission policy for the WebSocket `start` message. */
export function authorizeWebSocketStart(params: {
  policy: AuthRuntimePolicy;
  requestedTenantId: string;
  requestedRepId: string;
  token?: string;
  decodeToken?: (token: string) => AuthPayload | null;
}): WebSocketStartAuthDecision {
  const mode = resolveAuthRuntimeMode(params.policy);
  if (mode === "unconfigured") return { ok: false, code: "auth_not_configured" };
  if (mode === "insecure_demo") {
    return { ok: true, mode: "demo", identity: PERSONAL_OWNER_AUTH_PAYLOAD };
  }
  if (!params.token) return { ok: false, code: "missing_auth_token" };
  const payload = (params.decodeToken ?? decodeAuthToken)(params.token);
  if (
    !payload ||
    payload.role !== PERSONAL_OWNER_AUTH_PAYLOAD.role ||
    payload.tenantId !== params.requestedTenantId ||
    payload.repId !== params.requestedRepId ||
    payload.tenantId !== PERSONAL_OWNER_AUTH_PAYLOAD.tenantId ||
    payload.repId !== PERSONAL_OWNER_AUTH_PAYLOAD.repId
  ) {
    return { ok: false, code: "invalid_auth_token" };
  }
  return { ok: true, mode: "jwt", identity: payload };
}

declare global {
  namespace Express {
    interface Request {
      auth?: AuthPayload;
    }
  }
}

/**
 * Sign the fixed personal-owner JWT used by the login endpoint.
 */
export function signToken(payload: Omit<AuthPayload, "iat" | "exp">): string {
  if (CONFIG.jwtSecret.length < 32) throw new Error("JWT_SECRET must contain at least 32 characters");
  const identity = PersonalOwnerAuthPayloadSchema
    .omit({ iat: true, exp: true })
    .parse(payload);
  return jwt.sign(identity, CONFIG.jwtSecret, {
    algorithm: "HS256",
    expiresIn: CONFIG.authTokenTtl as jwt.SignOptions["expiresIn"],
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE,
    subject: JWT_SUBJECT
  });
}

/**
 * Verify and decode a JWT.
 */
export function verifyPersonalOwnerToken(token: string, secret: string): AuthPayload | null {
  if (secret.length < 32) return null;
  try {
    const decoded = jwt.verify(token, secret, {
      algorithms: ["HS256"],
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
      subject: JWT_SUBJECT
    });
    const parsed = PersonalOwnerAuthPayloadSchema.safeParse(decoded);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function verifyToken(token: string): AuthPayload | null {
  return verifyPersonalOwnerToken(token, CONFIG.jwtSecret);
}

export function decodeAuthToken(token: string): AuthPayload | null {
  if (!CONFIG.jwtSecret) return null;
  return verifyToken(token);
}

/** Compare fixed-size hashes so different-length secrets share one timing path. */
export function constantTimeSecretMatches(expectedValue: string, candidate?: string): boolean {
  const expected = createHash("sha256").update(expectedValue).digest();
  const actual = createHash("sha256").update(candidate ?? "").digest();
  return timingSafeEqual(expected, actual);
}

export function matchesPersonalAccessCode(candidate?: string): boolean {
  if (!CONFIG.personalAccessCode) return false;
  return constantTimeSecretMatches(CONFIG.personalAccessCode, candidate);
}

/**
 * requireAuth — Express middleware.
 *
 * When JWT_SECRET is set:
 *   → Requires a valid Bearer token in the Authorization header.
 *   → Populates req.auth with { tenantId, repId, role }.
 *
 * Only when ALLOW_INSECURE_DEMO_AUTH is explicitly enabled:
 *   → Passes through with the fixed demo identity.
 *   → Logs a warning on first request.
 */
let devWarned = false;

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const runtimeMode = resolveAuthRuntimeMode(currentAuthRuntimePolicy());

  // ── Explicit demo bypass ──
  if (runtimeMode !== "jwt") {
    if (runtimeMode === "unconfigured") {
      res.status(503).json({
        ok: false,
        error: "auth_not_configured",
        message: "JWT auth must be configured in production"
      });
      return;
    }

    if (!devWarned) {
      console.warn("[auth] ALLOW_INSECURE_DEMO_AUTH is enabled — DEMO MODE has no request authentication and must remain loopback-only.");
      devWarned = true;
    }
    req.auth = PERSONAL_OWNER_AUTH_PAYLOAD;
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
