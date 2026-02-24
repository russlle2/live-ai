import { URLSearchParams } from "url";
import type { OAuthProvider } from "./oauth_store";

function requiredEnv(name: string): string {
  const value = (process.env[name] || "").trim();
  if (!value) throw new Error(`${name}_missing`);
  return value;
}

function providerConfig(provider: OAuthProvider): {
  clientId: string;
  clientSecret: string;
  authUrl: string;
  tokenUrl: string;
  defaultScope: string;
} {
  if (provider === "zoom") {
    return {
      clientId: requiredEnv("ZOOM_OAUTH_CLIENT_ID"),
      clientSecret: requiredEnv("ZOOM_OAUTH_CLIENT_SECRET"),
      authUrl: (process.env.ZOOM_OAUTH_AUTH_URL || "https://zoom.us/oauth/authorize").trim(),
      tokenUrl: (process.env.ZOOM_OAUTH_TOKEN_URL || "https://zoom.us/oauth/token").trim(),
      defaultScope: (process.env.ZOOM_OAUTH_SCOPE || "meeting:read user:read").trim()
    };
  }

  return {
    clientId: requiredEnv("GOOGLE_OAUTH_CLIENT_ID"),
    clientSecret: requiredEnv("GOOGLE_OAUTH_CLIENT_SECRET"),
    authUrl: (process.env.GOOGLE_OAUTH_AUTH_URL || "https://accounts.google.com/o/oauth2/v2/auth").trim(),
    tokenUrl: (process.env.GOOGLE_OAUTH_TOKEN_URL || "https://oauth2.googleapis.com/token").trim(),
    defaultScope: (process.env.GOOGLE_OAUTH_SCOPE || "openid profile email").trim()
  };
}

export function buildOauthAuthorizeUrl(params: {
  provider: OAuthProvider;
  redirectUri: string;
  stateToken: string;
  tenantId: string;
}): string {
  const cfg = providerConfig(params.provider);
  const query = new URLSearchParams();
  query.set("response_type", "code");
  query.set("client_id", cfg.clientId);
  query.set("redirect_uri", params.redirectUri);
  query.set("scope", cfg.defaultScope);
  query.set("state", `${params.tenantId}:${params.stateToken}`);

  if (params.provider === "google") {
    query.set("access_type", "offline");
    query.set("prompt", "consent");
    query.set("include_granted_scopes", "true");
  }

  return `${cfg.authUrl}?${query.toString()}`;
}

export async function exchangeOauthCode(params: {
  provider: OAuthProvider;
  code: string;
  redirectUri: string;
}): Promise<{
  accessToken: string;
  refreshToken?: string;
  tokenType?: string;
  scope?: string;
  expiresInSec?: number;
  subjectId?: string;
  raw: Record<string, unknown>;
}> {
  const cfg = providerConfig(params.provider);

  const body = new URLSearchParams();
  body.set("grant_type", "authorization_code");
  body.set("code", params.code);
  body.set("redirect_uri", params.redirectUri);
  body.set("client_id", cfg.clientId);
  body.set("client_secret", cfg.clientSecret);

  const res = await fetch(cfg.tokenUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: body.toString()
  });

  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const err = typeof json.error === "string" ? json.error : `token_exchange_failed_${res.status}`;
    throw new Error(err);
  }

  const accessToken = String(json.access_token || "");
  if (!accessToken) throw new Error("missing_access_token");

  return {
    accessToken,
    refreshToken: typeof json.refresh_token === "string" ? json.refresh_token : undefined,
    tokenType: typeof json.token_type === "string" ? json.token_type : undefined,
    scope: typeof json.scope === "string" ? json.scope : undefined,
    expiresInSec: typeof json.expires_in === "number" ? json.expires_in : undefined,
    subjectId: typeof json.user_id === "string" ? json.user_id : undefined,
    raw: json
  };
}
