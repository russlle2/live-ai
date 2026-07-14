import crypto from "crypto";
import { withClient } from "../db/pool.js";

/**
 * Tenant-scoped OAuth credential storage (encrypted at rest).
 *
 * Uses AES-256-GCM with a server-side key from CREDENTIAL_ENCRYPTION_KEY env var.
 * Each credential gets its own random IV. The encrypted blob + IV + authTag
 * are stored together in the DB.
 *
 * NOTE: In production, use a KMS (AWS KMS, GCP KMS, HashiCorp Vault) instead
 * of a static env var key. This scaffold shows the interface + pattern.
 */

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;

function getEncryptionKey(): Buffer {
  const raw = process.env.CREDENTIAL_ENCRYPTION_KEY ?? "";
  if (!/^[a-f0-9]{64}$/i.test(raw)) {
    throw new Error("CREDENTIAL_ENCRYPTION_KEY must be exactly 64 hexadecimal characters");
  }
  const key = Buffer.from(raw, "hex");
  if (key.length !== 32) throw new Error("CREDENTIAL_ENCRYPTION_KEY must decode to 32 bytes");
  return key;
}

export function encryptCredential(plaintext: string): { encrypted: string; iv: string; tag: string } {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  let enc = cipher.update(plaintext, "utf8", "hex");
  enc += cipher.final("hex");
  const tag = cipher.getAuthTag().toString("hex");
  return { encrypted: enc, iv: iv.toString("hex"), tag };
}

export function decryptCredential(encrypted: string, iv: string, tag: string): string {
  const key = getEncryptionKey();
  if (!/^[a-f0-9]{24}$/i.test(iv) || !/^[a-f0-9]{32}$/i.test(tag) || !/^(?:[a-f0-9]{2})*$/i.test(encrypted)) {
    throw new Error("Encrypted credential material is malformed");
  }
  const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(iv, "hex"));
  decipher.setAuthTag(Buffer.from(tag, "hex"));
  let dec = decipher.update(encrypted, "hex", "utf8");
  dec += decipher.final("utf8");
  return dec;
}

export type OAuthCredential = {
  tenantId: string;
  integration: string;
  accessToken: string;
  refreshToken?: string;
  expiresAt?: string;
};

export async function storeCredential(cred: OAuthCredential): Promise<void> {
  const blob = JSON.stringify({
    accessToken: cred.accessToken,
    refreshToken: cred.refreshToken ?? "",
    expiresAt: cred.expiresAt ?? ""
  });
  const { encrypted, iv, tag } = encryptCredential(blob);

  await withClient(async (c) => {
    await c.query(
      `INSERT INTO oauth_credentials(tenant_id, integration, encrypted_blob, iv, auth_tag)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (tenant_id, integration)
       DO UPDATE SET encrypted_blob = EXCLUDED.encrypted_blob, iv = EXCLUDED.iv, auth_tag = EXCLUDED.auth_tag, updated_at = now()`,
      [cred.tenantId, cred.integration, encrypted, iv, tag]
    );
  });
}

export async function loadCredential(tenantId: string, integration: string): Promise<OAuthCredential | null> {
  return withClient(async (c) => {
    const { rows } = await c.query(
      `SELECT encrypted_blob, iv, auth_tag FROM oauth_credentials WHERE tenant_id = $1 AND integration = $2`,
      [tenantId, integration]
    );
    if (rows.length === 0) return null;
    const row = rows[0];
    try {
      const plaintext = decryptCredential(row.encrypted_blob, row.iv, row.auth_tag);
      const parsed = JSON.parse(plaintext);
      return {
        tenantId,
        integration,
        accessToken: parsed.accessToken,
        refreshToken: parsed.refreshToken || undefined,
        expiresAt: parsed.expiresAt || undefined
      };
    } catch {
      return null;
    }
  });
}

export async function deleteCredential(tenantId: string, integration: string): Promise<void> {
  await withClient(async (c) => {
    await c.query(
      `DELETE FROM oauth_credentials WHERE tenant_id = $1 AND integration = $2`,
      [tenantId, integration]
    );
  });
}
