import crypto from "crypto";
import { withClient } from "../db/pool";
import { decryptToken, encryptToken } from "./oauth_crypto";

export type OAuthProvider = "zoom" | "google";

export async function createOauthState(params: {
  tenantId: string;
  provider: OAuthProvider;
  redirectUri: string;
  ttlMinutes?: number;
}): Promise<{ stateToken: string; expiresAtIso: string }> {
  const stateToken = crypto.randomBytes(24).toString("hex");
  const ttlMinutes = Math.max(1, Math.min(30, Number(params.ttlMinutes ?? 10)));
  const expiresAt = new Date(Date.now() + ttlMinutes * 60_000);

  await withClient(async (c) => {
    await c.query(
      `INSERT INTO integration_oauth_state(tenant_id, provider, state_token, redirect_uri, expires_at)
       VALUES ($1, $2, $3, $4, $5::timestamptz)`,
      [params.tenantId, params.provider, stateToken, params.redirectUri, expiresAt.toISOString()]
    );
  });

  return { stateToken, expiresAtIso: expiresAt.toISOString() };
}

export async function consumeOauthState(params: {
  tenantId: string;
  provider: OAuthProvider;
  stateToken: string;
  redirectUri: string;
}): Promise<boolean> {
  return withClient(async (c) => {
    const { rows } = await c.query(
      `UPDATE integration_oauth_state
       SET used_at = now()
       WHERE tenant_id = $1
         AND provider = $2
         AND state_token = $3
         AND redirect_uri = $4
         AND used_at IS NULL
         AND expires_at > now()
       RETURNING id`,
      [params.tenantId, params.provider, params.stateToken, params.redirectUri]
    );
    return rows.length > 0;
  });
}

export async function upsertOauthTokens(params: {
  tenantId: string;
  provider: OAuthProvider;
  subjectId?: string;
  accessToken: string;
  refreshToken?: string;
  tokenType?: string;
  scope?: string;
  expiresInSec?: number;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  const expiresAt = typeof params.expiresInSec === "number"
    ? new Date(Date.now() + Math.max(30, params.expiresInSec) * 1000).toISOString()
    : null;

  const accessEnc = encryptToken(params.accessToken);
  const refreshEnc = params.refreshToken ? encryptToken(params.refreshToken) : null;

  await withClient(async (c) => {
    await c.query(
      `INSERT INTO integration_oauth_tokens(
        tenant_id, provider, subject_id, access_token_enc, refresh_token_enc,
        token_type, scope, expires_at, metadata, updated_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::timestamptz, $9::jsonb, now())
       ON CONFLICT (tenant_id, provider)
       DO UPDATE SET
         subject_id = EXCLUDED.subject_id,
         access_token_enc = EXCLUDED.access_token_enc,
         refresh_token_enc = COALESCE(EXCLUDED.refresh_token_enc, integration_oauth_tokens.refresh_token_enc),
         token_type = EXCLUDED.token_type,
         scope = EXCLUDED.scope,
         expires_at = EXCLUDED.expires_at,
         metadata = EXCLUDED.metadata,
         updated_at = now()`,
      [
        params.tenantId,
        params.provider,
        params.subjectId ?? null,
        accessEnc,
        refreshEnc,
        params.tokenType ?? null,
        params.scope ?? null,
        expiresAt,
        JSON.stringify(params.metadata ?? {})
      ]
    );
  });
}

export async function getOauthAccessToken(params: {
  tenantId: string;
  provider: OAuthProvider;
}): Promise<string | null> {
  return withClient(async (c) => {
    const { rows } = await c.query(
      `SELECT access_token_enc, expires_at
       FROM integration_oauth_tokens
       WHERE tenant_id = $1 AND provider = $2
       LIMIT 1`,
      [params.tenantId, params.provider]
    );

    const row = rows[0];
    if (!row?.access_token_enc) return null;
    if (row.expires_at && new Date(row.expires_at).getTime() <= Date.now() + 5000) return null;

    try {
      return decryptToken(String(row.access_token_enc));
    } catch {
      return null;
    }
  });
}
