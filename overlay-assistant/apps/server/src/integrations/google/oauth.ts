import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import path from "node:path";
import {
  GOOGLE_READONLY_SCOPES,
  OAuthPendingSchema,
  OAuthTokenSchema,
  type GoogleAuthorizationRevocationResult,
  type GoogleRuntimeConfig,
  type OAuthPending,
  type OAuthToken
} from "./types.js";
import { PrivateJsonStore } from "./private_store.js";
import { GoogleHttpTransport, readBoundedResponseBytes } from "./transport.js";

const AUTHORIZATION_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const REVOCATION_ENDPOINT = "https://oauth2.googleapis.com/revoke";
const OAUTH_STATE_MAX_AGE_MS = 15 * 60 * 1000;

type TokenEndpointResponse = {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
  token_type?: string;
  error?: string;
  error_description?: string;
};

export class GoogleOAuthError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status?: number
  ) {
    super(message);
    this.name = "GoogleOAuthError";
  }
}

export class GoogleOAuthManager {
  private readonly transport: GoogleHttpTransport;
  private readonly now: () => Date;
  private readonly tokenStore: PrivateJsonStore<OAuthToken>;
  private readonly pendingStore: PrivateJsonStore<OAuthPending>;

  constructor(private readonly config: GoogleRuntimeConfig) {
    this.transport = new GoogleHttpTransport(
      config.fetch ?? globalThis.fetch,
      boundedInteger(config.requestTimeoutMs ?? 15_000, 100, 120_000)
    );
    this.now = config.now ?? (() => new Date());
    this.tokenStore = new PrivateJsonStore(
      path.join(config.storageDir, "google-oauth-token.json"),
      OAuthTokenSchema,
      () => {
        throw new GoogleOAuthError("Google has not been authorized", "not_authorized");
      },
      config.storageEncryptionKey
    );
    this.pendingStore = new PrivateJsonStore(
      path.join(config.storageDir, "google-oauth-pending.json"),
      OAuthPendingSchema,
      () => {
        throw new GoogleOAuthError("No Google OAuth flow is pending", "oauth_not_pending");
      },
      config.storageEncryptionKey
    );
  }

  async beginAuthorization(): Promise<{ url: string; state: string }> {
    this.assertConfigured();
    const state = base64Url(randomBytes(32));
    const codeVerifier = base64Url(randomBytes(48));
    const codeChallenge = base64Url(createHash("sha256").update(codeVerifier).digest());
    await this.pendingStore.write({
      state,
      codeVerifier,
      createdAt: this.now().toISOString()
    });

    const url = new URL(AUTHORIZATION_ENDPOINT);
    url.searchParams.set("client_id", this.config.clientId);
    url.searchParams.set("redirect_uri", this.config.redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", GOOGLE_READONLY_SCOPES.join(" "));
    url.searchParams.set("access_type", "offline");
    url.searchParams.set("include_granted_scopes", "true");
    url.searchParams.set("prompt", "consent");
    url.searchParams.set("state", state);
    url.searchParams.set("code_challenge", codeChallenge);
    url.searchParams.set("code_challenge_method", "S256");
    return { url: url.toString(), state };
  }

  async completeAuthorization(input: { code: string; state: string }): Promise<OAuthToken> {
    this.assertConfigured();
    const pending = await this.pendingStore.read();
    const age = this.now().getTime() - Date.parse(pending.createdAt);
    if (!safeEqual(input.state, pending.state) || !Number.isFinite(age) || age < 0 || age > OAUTH_STATE_MAX_AGE_MS) {
      throw new GoogleOAuthError("OAuth state is invalid or expired", "invalid_oauth_state");
    }

    const body = new URLSearchParams({
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      redirect_uri: this.config.redirectUri,
      code: input.code,
      code_verifier: pending.codeVerifier,
      grant_type: "authorization_code"
    });
    const exchange = await this.postTokenRequest(body);
    const { payload } = exchange;
    if (!exchange.ok || !payload.access_token || !payload.expires_in) {
      throw new GoogleOAuthError(
        payload.error_description ?? payload.error ?? "Google OAuth token exchange failed",
        payload.error ?? "token_exchange_failed",
        exchange.status
      );
    }

    const token = this.fromEndpoint(payload);
    if (!token.refreshToken) {
      throw new GoogleOAuthError(
        "Google did not issue a refresh token; revoke the app grant and authorize again",
        "refresh_token_missing"
      );
    }
    await this.tokenStore.write(token);
    await this.pendingStore.clear();
    return token;
  }

  async getAccessToken(): Promise<string> {
    const token = await this.tokenStore.read();
    if (token.expiresAt - this.now().getTime() > 60_000) return token.accessToken;
    return (await this.refresh(token)).accessToken;
  }

  async status(): Promise<{
    configured: boolean;
    authorized: boolean;
    expiresAt?: number;
    scopes?: string[];
    accountEmail?: string;
  }> {
    if (!this.isConfigured()) return { configured: false, authorized: false };
    try {
      const token = await this.tokenStore.read();
      return {
        configured: true,
        authorized: true,
        expiresAt: token.expiresAt,
        scopes: token.scopes,
        accountEmail: token.accountEmail
      };
    } catch (error) {
      if (error instanceof GoogleOAuthError && error.code === "not_authorized") {
        return { configured: true, authorized: false };
      }
      throw error;
    }
  }

  async revokeLocalAuthorization(): Promise<void> {
    await this.tokenStore.clear();
    await this.pendingStore.clear();
  }

  rotateStorageEncryptionKey(nextKey: string): void {
    this.tokenStore.rotateEncryptionKey(nextKey);
    this.pendingStore.rotateEncryptionKey(nextKey);
  }

  abortPendingRequests(): void {
    this.transport.abortAll();
  }

  async revokeAuthorization(): Promise<GoogleAuthorizationRevocationResult> {
    const warnings: string[] = [];
    let token: OAuthToken | undefined;
    try {
      token = await this.tokenStore.read();
    } catch (error) {
      if (!(error instanceof GoogleOAuthError && error.code === "not_authorized")) {
        // Corrupt or unreadable local authorization must not block deletion of
        // that file, pending OAuth state, source cache, or other owner data.
        warnings.push("provider_revocation_token_unreadable");
      }
    }

    let providerRevoked = false;
    try {
      const credential = token?.refreshToken ?? token?.accessToken;
      if (credential) {
        const accepted = await this.transport.run(REVOCATION_ENDPOINT, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ token: credential })
        }, async (response) => response.ok);
        providerRevoked = accepted;
        if (!accepted) warnings.push("provider_revocation_rejected");
      }
    } catch {
      warnings.push("provider_revocation_network_failed");
    }

    const localResults = await Promise.allSettled([
      this.tokenStore.clear(),
      this.pendingStore.clear()
    ]);
    if (localResults[0]?.status === "rejected") warnings.push("local_oauth_token_cleanup_failed");
    if (localResults[1]?.status === "rejected") warnings.push("local_oauth_pending_cleanup_failed");
    return {
      providerRevoked,
      localAuthorizationCleared: localResults.every((result) => result.status === "fulfilled"),
      warnings
    };
  }

  private async refresh(previous: OAuthToken): Promise<OAuthToken> {
    if (!previous.refreshToken) throw new GoogleOAuthError("Refresh token is missing", "refresh_token_missing");
    const body = new URLSearchParams({
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      refresh_token: previous.refreshToken,
      grant_type: "refresh_token"
    });
    const refresh = await this.postTokenRequest(body);
    const { payload } = refresh;
    if (!refresh.ok || !payload.access_token || !payload.expires_in) {
      throw new GoogleOAuthError(
        payload.error_description ?? payload.error ?? "Google OAuth refresh failed",
        payload.error ?? "token_refresh_failed",
        refresh.status
      );
    }
    const next = this.fromEndpoint(payload, previous);
    await this.tokenStore.write(next);
    return next;
  }

  private fromEndpoint(payload: TokenEndpointResponse, previous?: OAuthToken): OAuthToken {
    const scopes = payload.scope?.split(/\s+/).filter(Boolean) ?? previous?.scopes ?? [];
    const expectedScopes = new Set<string>(GOOGLE_READONLY_SCOPES);
    if (
      scopes.length !== expectedScopes.size ||
      scopes.some((scope) => !expectedScopes.has(scope)) ||
      [...expectedScopes].some((scope) => !scopes.includes(scope))
    ) {
      throw new GoogleOAuthError(
        "Google authorization did not return exactly the expected read-only scopes",
        "invalid_oauth_scope"
      );
    }
    return OAuthTokenSchema.parse({
      accessToken: payload.access_token,
      refreshToken: payload.refresh_token ?? previous?.refreshToken,
      expiresAt: this.now().getTime() + Number(payload.expires_in) * 1000,
      tokenType: payload.token_type ?? previous?.tokenType ?? "Bearer",
      scopes,
      accountEmail: previous?.accountEmail,
      updatedAt: this.now().toISOString()
    });
  }

  private postTokenRequest(body: URLSearchParams): Promise<{
    ok: boolean;
    status: number;
    payload: TokenEndpointResponse;
  }> {
    return this.transport.run(TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body
    }, async (response) => {
      const bytes = await readBoundedResponseBytes(response, 64 * 1024);
      let payload: TokenEndpointResponse;
      try {
        payload = JSON.parse(new TextDecoder().decode(bytes)) as TokenEndpointResponse;
      } catch {
        throw new GoogleOAuthError("Google OAuth returned invalid JSON", "invalid_oauth_response", response.status);
      }
      return { ok: response.ok, status: response.status, payload };
    });
  }

  private isConfigured(): boolean {
    return Boolean(this.config.clientId && this.config.clientSecret && this.config.redirectUri);
  }

  private assertConfigured(): void {
    if (!this.isConfigured()) {
      throw new GoogleOAuthError("Google OAuth client is not configured", "oauth_not_configured");
    }
  }
}

function boundedInteger(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) return minimum;
  return Math.min(maximum, Math.max(minimum, Math.trunc(value)));
}

function base64Url(value: Buffer): string {
  return value.toString("base64url");
}

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}
