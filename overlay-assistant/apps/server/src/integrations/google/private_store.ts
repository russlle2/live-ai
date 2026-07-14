import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes
} from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { z } from "zod";

const ENCRYPTED_SCHEMA = "private_encrypted_json_v1";
const ENCRYPTION_ALGORITHM = "aes-256-gcm";
const AUTH_TAG_BYTES = 16;

type EncryptedEnvelope = {
  schema: typeof ENCRYPTED_SCHEMA;
  algorithm: typeof ENCRYPTION_ALGORITHM;
  iv: string;
  authTag: string;
  ciphertext: string;
};

export class PrivateStoreEncryptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PrivateStoreEncryptionError";
  }
}

/**
 * JSON persistence for OAuth material, resumable cursors, and source cache.
 * Directories are owner-only (0700) and files are owner read/write only (0600).
 * When an encryption key is supplied, values use authenticated AES-256-GCM.
 * Legacy plaintext files are migrated atomically on their first successful read.
 */
export class PrivateJsonStore<T> {
  constructor(
    readonly filePath: string,
    private readonly schema: z.ZodType<T, z.ZodTypeDef, unknown>,
    private readonly createDefault: () => T,
    private encryptionKey?: string
  ) {}

  /** Use only after the prior encrypted value has been cleared or intentionally invalidated. */
  rotateEncryptionKey(nextKey: string): void {
    assertEncryptionKey(nextKey);
    this.encryptionKey = nextKey;
  }

  async read(): Promise<T> {
    try {
      const raw = await fs.readFile(this.filePath, "utf8");
      await fs.chmod(this.filePath, 0o600);
      const parsedJson = JSON.parse(raw) as unknown;
      if (isEncryptedEnvelope(parsedJson)) {
        if (!this.encryptionKey) {
          throw new PrivateStoreEncryptionError("Private data is encrypted but no storage encryption key is configured");
        }
        return this.schema.parse(JSON.parse(decryptEnvelope(parsedJson, this.encryptionKey, this.filePath)));
      }

      const parsed = this.schema.parse(parsedJson);
      if (this.encryptionKey) await this.write(parsed);
      return parsed;
    } catch (error: any) {
      if (error?.code === "ENOENT") return this.createDefault();
      throw error;
    }
  }

  async write(value: T): Promise<void> {
    const parsed = this.schema.parse(value);
    const directory = path.dirname(this.filePath);
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    await fs.chmod(directory, 0o700);
    const temporary = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    const serialized = this.encryptionKey
      ? `${JSON.stringify(encryptValue(parsed, this.encryptionKey, this.filePath), null, 2)}\n`
      : `${JSON.stringify(parsed, null, 2)}\n`;
    try {
      await fs.writeFile(temporary, serialized, {
        encoding: "utf8",
        mode: 0o600
      });
      await fs.chmod(temporary, 0o600);
      await fs.rename(temporary, this.filePath);
      await fs.chmod(this.filePath, 0o600);
    } catch (error) {
      await fs.unlink(temporary).catch(() => undefined);
      throw error;
    }
  }

  async clear(): Promise<void> {
    try {
      await fs.unlink(this.filePath);
    } catch (error: any) {
      if (error?.code !== "ENOENT") throw error;
    }
    const directory = path.dirname(this.filePath);
    const prefix = `${path.basename(this.filePath)}.`;
    try {
      const names = await fs.readdir(directory);
      await Promise.all(names
        .filter((name) => name.startsWith(prefix) && name.endsWith(".tmp"))
        .map((name) => fs.unlink(path.join(directory, name)).catch(() => undefined)));
    } catch (error: any) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
}

function isEncryptedEnvelope(value: unknown): value is EncryptedEnvelope {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<EncryptedEnvelope>;
  return candidate.schema === ENCRYPTED_SCHEMA &&
    candidate.algorithm === ENCRYPTION_ALGORITHM &&
    typeof candidate.iv === "string" &&
    typeof candidate.authTag === "string" &&
    typeof candidate.ciphertext === "string";
}

function encryptValue(value: unknown, secret: string, filePath: string): EncryptedEnvelope {
  assertEncryptionKey(secret);
  const iv = randomBytes(12);
  const cipher = createCipheriv(ENCRYPTION_ALGORITHM, deriveKey(secret, filePath), iv, {
    authTagLength: AUTH_TAG_BYTES
  });
  cipher.setAAD(aad(filePath));
  const plaintext = Buffer.from(JSON.stringify(value), "utf8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return {
    schema: ENCRYPTED_SCHEMA,
    algorithm: ENCRYPTION_ALGORITHM,
    iv: iv.toString("base64url"),
    authTag: cipher.getAuthTag().toString("base64url"),
    ciphertext: ciphertext.toString("base64url")
  };
}

function decryptEnvelope(envelope: EncryptedEnvelope, secret: string, filePath: string): string {
  assertEncryptionKey(secret);
  try {
    const decipher = createDecipheriv(
      ENCRYPTION_ALGORITHM,
      deriveKey(secret, filePath),
      Buffer.from(envelope.iv, "base64url"),
      { authTagLength: AUTH_TAG_BYTES }
    );
    decipher.setAAD(aad(filePath));
    decipher.setAuthTag(Buffer.from(envelope.authTag, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(envelope.ciphertext, "base64url")),
      decipher.final()
    ]).toString("utf8");
  } catch {
    throw new PrivateStoreEncryptionError("Private data could not be decrypted with the configured storage encryption key");
  }
}

function assertEncryptionKey(secret: string): void {
  if (secret.trim().length < 32) {
    throw new PrivateStoreEncryptionError("The private storage encryption key must contain at least 32 characters");
  }
}

function deriveKey(secret: string, filePath: string): Buffer {
  return createHash("sha256")
    .update("live-ai-private-store-v1\0")
    .update(path.basename(filePath))
    .update("\0")
    .update(secret, "utf8")
    .digest();
}

function aad(filePath: string): Buffer {
  return Buffer.from(`${ENCRYPTED_SCHEMA}\0${path.basename(filePath)}`, "utf8");
}
