import { describe, expect, it } from "vitest";
import jwt from "jsonwebtoken";
import {
  authorizePersonalLogin,
  authorizeWebSocketStart,
  constantTimeSecretMatches,
  PERSONAL_OWNER_AUTH_PAYLOAD,
  PersonalLoginInputSchema,
  PersonalOwnerAuthPayloadSchema,
  resolveAuthRuntimeMode,
  verifyPersonalOwnerToken,
  type AuthRuntimePolicy
} from "./auth.js";

function policy(overrides: Partial<AuthRuntimePolicy> = {}): AuthRuntimePolicy {
  return {
    jwtConfigured: false,
    personalAccessCodeConfigured: false,
    allowInsecureDemoAuth: false,
    nodeEnv: "production",
    ...overrides
  };
}

describe("personal access code comparison", () => {
  it("accepts an exact match", () => {
    expect(constantTimeSecretMatches("a private code", "a private code")).toBe(true);
  });

  it("rejects missing, wrong, and different-length candidates", () => {
    expect(constantTimeSecretMatches("a private code")).toBe(false);
    expect(constantTimeSecretMatches("a private code", "wrong")).toBe(false);
    expect(constantTimeSecretMatches("a private code", "a private code plus more")).toBe(false);
  });
});

describe("runtime authentication policy", () => {
  it("fails closed in production when JWT auth is missing", () => {
    expect(resolveAuthRuntimeMode(policy())).toBe("unconfigured");
  });

  it("permits missing JWT only through the explicit demo switch", () => {
    expect(resolveAuthRuntimeMode(policy({ allowInsecureDemoAuth: true }))).toBe("insecure_demo");
    expect(resolveAuthRuntimeMode(policy({ nodeEnv: "test" }))).toBe("unconfigured");
  });

  it("uses JWT mode whenever a signing secret is configured", () => {
    expect(resolveAuthRuntimeMode(policy({ jwtConfigured: true }))).toBe("jwt");
  });
});

describe("fixed-owner JWT verification", () => {
  const secret = "test-jwt-signing-secret-that-is-at-least-32-characters";

  it("accepts only the fixed personal owner claims", () => {
    expect(PersonalOwnerAuthPayloadSchema.safeParse(PERSONAL_OWNER_AUTH_PAYLOAD).success).toBe(true);
    expect(PersonalOwnerAuthPayloadSchema.safeParse({
      tenantId: "legacy-tenant",
      repId: "legacy-user",
      role: "admin"
    }).success).toBe(false);
  });

  it("rejects legacy, wrong-identity, wrong-algorithm, and wrong-audience tokens", () => {
    const legacy = jwt.sign(PERSONAL_OWNER_AUTH_PAYLOAD, secret, { algorithm: "HS256" });
    const wrongIdentity = jwt.sign(
      { tenantId: "legacy-tenant", repId: "owner", role: "admin" },
      secret,
      { algorithm: "HS256", issuer: "live-rhetoric", audience: "live-rhetoric-owner", subject: "owner" }
    );
    const wrongAudience = jwt.sign(PERSONAL_OWNER_AUTH_PAYLOAD, secret, {
      algorithm: "HS256",
      issuer: "live-rhetoric",
      audience: "somewhere-else",
      subject: "owner"
    });

    expect(verifyPersonalOwnerToken(legacy, secret)).toBeNull();
    expect(verifyPersonalOwnerToken(wrongIdentity, secret)).toBeNull();
    expect(verifyPersonalOwnerToken(wrongAudience, secret)).toBeNull();
    expect(verifyPersonalOwnerToken(legacy, "short")).toBeNull();
  });

  it("accepts a correctly scoped owner token", () => {
    const token = jwt.sign(PERSONAL_OWNER_AUTH_PAYLOAD, secret, {
      algorithm: "HS256",
      issuer: "live-rhetoric",
      audience: "live-rhetoric-owner",
      subject: "owner"
    });
    expect(verifyPersonalOwnerToken(token, secret)).toMatchObject(PERSONAL_OWNER_AUTH_PAYLOAD);
  });
});

describe("personal-owner login admission", () => {
  it("rejects a production login when JWT auth is not configured", () => {
    expect(authorizePersonalLogin({
      policy: policy(),
      configuredAccessCode: "",
      candidateAccessCode: "anything"
    })).toMatchObject({ ok: false, status: 503, code: "auth_not_configured" });
  });

  it("requires a configured and correct access code whenever JWT is enabled", () => {
    const jwtPolicy = policy({ jwtConfigured: true });
    expect(authorizePersonalLogin({
      policy: jwtPolicy,
      configuredAccessCode: "",
      candidateAccessCode: "anything"
    })).toMatchObject({ ok: false, status: 503, code: "personal_access_code_not_configured" });

    expect(authorizePersonalLogin({
      policy: { ...jwtPolicy, personalAccessCodeConfigured: true },
      configuredAccessCode: "correct horse battery staple",
      candidateAccessCode: "wrong"
    })).toMatchObject({ ok: false, status: 401, code: "invalid_access_code" });
  });

  it("strips caller-selected identity and returns only the fixed owner admin", () => {
    const parsed = PersonalLoginInputSchema.parse({
      tenantId: "attacker-selected-tenant",
      repId: "attacker-selected-rep",
      role: "admin",
      accessCode: "correct horse battery staple"
    });
    expect(parsed).toEqual({ accessCode: "correct horse battery staple" });

    const decision = authorizePersonalLogin({
      policy: policy({ jwtConfigured: true, personalAccessCodeConfigured: true }),
      configuredAccessCode: "correct horse battery staple",
      candidateAccessCode: parsed.accessCode
    });
    expect(decision).toEqual({
      ok: true,
      mode: "jwt",
      identity: PERSONAL_OWNER_AUTH_PAYLOAD
    });
  });
});

describe("WebSocket start admission", () => {
  it("rejects an unconfigured production runtime and admits only explicit demo mode", () => {
    expect(authorizeWebSocketStart({
      policy: policy(),
      requestedTenantId: "personal",
      requestedRepId: "owner"
    })).toEqual({ ok: false, code: "auth_not_configured" });

    expect(authorizeWebSocketStart({
      policy: policy({ allowInsecureDemoAuth: true }),
      requestedTenantId: "caller-selected",
      requestedRepId: "caller-selected"
    })).toEqual({ ok: true, mode: "demo", identity: PERSONAL_OWNER_AUTH_PAYLOAD });
  });

  it("rejects missing, invalid, or identity-mismatched JWTs", () => {
    const jwtPolicy = policy({ jwtConfigured: true, personalAccessCodeConfigured: true });
    expect(authorizeWebSocketStart({
      policy: jwtPolicy,
      requestedTenantId: "personal",
      requestedRepId: "owner"
    })).toEqual({ ok: false, code: "missing_auth_token" });

    expect(authorizeWebSocketStart({
      policy: jwtPolicy,
      requestedTenantId: "personal",
      requestedRepId: "owner",
      token: "bad",
      decodeToken: () => null
    })).toEqual({ ok: false, code: "invalid_auth_token" });

    expect(authorizeWebSocketStart({
      policy: jwtPolicy,
      requestedTenantId: "another-tenant",
      requestedRepId: "owner",
      token: "valid",
      decodeToken: () => PERSONAL_OWNER_AUTH_PAYLOAD
    })).toEqual({ ok: false, code: "invalid_auth_token" });

  });

  it("admits a matching signed owner identity", () => {
    expect(authorizeWebSocketStart({
      policy: policy({ jwtConfigured: true, personalAccessCodeConfigured: true }),
      requestedTenantId: "personal",
      requestedRepId: "owner",
      token: "valid",
      decodeToken: () => PERSONAL_OWNER_AUTH_PAYLOAD
    })).toEqual({ ok: true, mode: "jwt", identity: PERSONAL_OWNER_AUTH_PAYLOAD });
  });
});
