import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes
} from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

const ENVELOPE_SCHEMA = "private_encrypted_jsonl_record_v2";
const ALGORITHM = "aes-256-gcm";
const MAX_RECENT_READ_BYTES = 8 * 1024 * 1024;

type EncryptedRecordEnvelopeV2 = {
  schema: typeof ENVELOPE_SCHEMA;
  algorithm: typeof ALGORITHM;
  iv: string;
  authTag: string;
  ciphertext: string;
};

export class PrivateArchiveEncryptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PrivateArchiveEncryptionError";
  }
}

export class EncryptedJsonlArchiveV2<T> {
  private queue = Promise.resolve();
  private migrationChecked = false;
  private readonly filePath: string;
  private readonly encryptionKey: string;
  private readonly validate: (value: unknown) => T;
  private readonly malformedLinePolicy: "reject" | "skip";

  constructor(options: {
    filePath: string;
    encryptionKey: string;
    validate: (value: unknown) => T;
    malformedLinePolicy?: "reject" | "skip";
  }) {
    if (options.encryptionKey.trim().length < 32) {
      throw new PrivateArchiveEncryptionError(
        "Private archive encryption key must contain at least 32 characters"
      );
    }
    this.filePath = options.filePath;
    this.encryptionKey = options.encryptionKey;
    this.validate = options.validate;
    this.malformedLinePolicy = options.malformedLinePolicy ?? "reject";
  }

  async append(value: T): Promise<void> {
    const validated = this.validate(value);
    this.queue = this.queue.catch(() => undefined).then(async () => {
      await this.ensureMigrated();
      await this.ensureDirectory();
      const serialized = `${JSON.stringify(this.encrypt(validated))}\n`;
      const handle = await fs.open(this.filePath, "a", 0o600);
      try {
        await handle.writeFile(serialized, "utf8");
        await handle.sync();
      } finally {
        await handle.close();
      }
      await fs.chmod(this.filePath, 0o600);
    });
    await this.queue;
  }

  async readAll(): Promise<T[]> {
    await this.queue.catch(() => undefined);
    await this.ensureMigrated();
    try {
      return this.decodeLines(await fs.readFile(this.filePath, "utf8"));
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return [];
      throw error;
    }
  }

  async readRecent(limit: number): Promise<T[]> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 10_000) {
      throw new TypeError("Recent archive limit must be between 1 and 10000");
    }
    await this.queue.catch(() => undefined);
    await this.ensureMigrated();
    let handle: fs.FileHandle | undefined;
    try {
      handle = await fs.open(this.filePath, "r");
      const stat = await handle.stat();
      const bytesToRead = Math.min(stat.size, MAX_RECENT_READ_BYTES);
      const start = Math.max(0, stat.size - bytesToRead);
      const buffer = Buffer.alloc(bytesToRead);
      await handle.read(buffer, 0, bytesToRead, start);
      let text = buffer.toString("utf8");
      if (start > 0) {
        const firstNewline = text.indexOf("\n");
        text = firstNewline >= 0 ? text.slice(firstNewline + 1) : "";
      }
      return this.decodeLines(text).slice(-limit);
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return [];
      throw error;
    } finally {
      await handle?.close();
    }
  }

  async clear(): Promise<void> {
    this.queue = this.queue.catch(() => undefined).then(async () => {
      await fs.unlink(this.filePath).catch((error: unknown) => {
        if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") throw error;
      });
      const directory = path.dirname(this.filePath);
      const prefix = `${path.basename(this.filePath)}.`;
      try {
        const entries = await fs.readdir(directory, { withFileTypes: true });
        await Promise.all(entries
          .filter((entry) =>
            entry.isFile() &&
            entry.name.startsWith(prefix) &&
            entry.name.endsWith(".tmp")
          )
          .map((entry) => fs.unlink(path.join(directory, entry.name))));
      } catch (error: unknown) {
        if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") throw error;
      }
      this.migrationChecked = false;
    });
    await this.queue;
  }

  private async ensureMigrated(): Promise<void> {
    if (this.migrationChecked) return;
    let raw: string;
    try {
      raw = await fs.readFile(this.filePath, "utf8");
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
        this.migrationChecked = true;
        return;
      }
      throw error;
    }
    const lines = raw.split(/\r?\n/).filter((line) => line.trim());
    let migrationNeeded = false;
    const records: T[] = [];
    for (const line of lines) {
      const parsed = this.parseLine(line);
      if (parsed === undefined) {
        migrationNeeded = true;
        continue;
      }
      if (isEncryptedEnvelope(parsed)) {
        records.push(this.decrypt(parsed));
        continue;
      }
      migrationNeeded = true;
      records.push(this.validate(parsed));
    }
    if (migrationNeeded) {
      await this.ensureDirectory();
      const encrypted = records
        .map((record) => JSON.stringify(this.encrypt(record)))
        .join("\n");
      await this.atomicWrite(encrypted ? `${encrypted}\n` : "");
    } else {
      await fs.chmod(this.filePath, 0o600);
    }
    this.migrationChecked = true;
  }

  private decodeLines(raw: string): T[] {
    const records: T[] = [];
    for (const line of raw.split(/\r?\n/).filter((entry) => entry.trim())) {
        const parsed = this.parseLine(line);
        if (parsed === undefined) continue;
        if (!isEncryptedEnvelope(parsed)) {
          throw new PrivateArchiveEncryptionError(
            "Private archive contains an unexpected plaintext record"
          );
        }
        records.push(this.decrypt(parsed));
    }
    return records;
  }

  private parseLine(line: string): unknown | undefined {
    try {
      return JSON.parse(line) as unknown;
    } catch {
      if (this.malformedLinePolicy === "skip") return undefined;
      throw new PrivateArchiveEncryptionError(
        "Private archive contains malformed JSON"
      );
    }
  }

  private encrypt(value: T): EncryptedRecordEnvelopeV2 {
    const iv = randomBytes(12);
    const cipher = createCipheriv(ALGORITHM, this.derivedKey(), iv);
    cipher.setAAD(this.aad());
    const ciphertext = Buffer.concat([
      cipher.update(JSON.stringify(value), "utf8"),
      cipher.final()
    ]);
    return {
      schema: ENVELOPE_SCHEMA,
      algorithm: ALGORITHM,
      iv: iv.toString("base64url"),
      authTag: cipher.getAuthTag().toString("base64url"),
      ciphertext: ciphertext.toString("base64url")
    };
  }

  private decrypt(envelope: EncryptedRecordEnvelopeV2): T {
    try {
      const decipher = createDecipheriv(
        ALGORITHM,
        this.derivedKey(),
        Buffer.from(envelope.iv, "base64url")
      );
      decipher.setAAD(this.aad());
      decipher.setAuthTag(Buffer.from(envelope.authTag, "base64url"));
      const plaintext = Buffer.concat([
        decipher.update(Buffer.from(envelope.ciphertext, "base64url")),
        decipher.final()
      ]).toString("utf8");
      return this.validate(JSON.parse(plaintext) as unknown);
    } catch (error) {
      if (error instanceof TypeError) throw error;
      throw new PrivateArchiveEncryptionError(
        "Private archive could not be decrypted with the configured key"
      );
    }
  }

  private derivedKey(): Buffer {
    return createHash("sha256")
      .update("live-rhetoric-encrypted-jsonl-v2\0")
      .update(path.basename(this.filePath))
      .update("\0")
      .update(this.encryptionKey, "utf8")
      .digest();
  }

  private aad(): Buffer {
    return Buffer.from(
      `${ENVELOPE_SCHEMA}\0${path.basename(this.filePath)}`,
      "utf8"
    );
  }

  private async ensureDirectory(): Promise<void> {
    const directory = path.dirname(this.filePath);
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    await fs.chmod(directory, 0o700);
  }

  private async atomicWrite(content: string): Promise<void> {
    const temporary = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    let handle: fs.FileHandle | undefined;
    try {
      handle = await fs.open(temporary, "w", 0o600);
      await handle.writeFile(content, "utf8");
      await handle.sync();
      await handle.close();
      handle = undefined;
      await fs.rename(temporary, this.filePath);
      await fs.chmod(this.filePath, 0o600);
    } catch (error) {
      await handle?.close().catch(() => undefined);
      await fs.unlink(temporary).catch(() => undefined);
      throw error;
    }
  }
}

function isEncryptedEnvelope(value: unknown): value is EncryptedRecordEnvelopeV2 {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Partial<EncryptedRecordEnvelopeV2>;
  return candidate.schema === ENVELOPE_SCHEMA &&
    candidate.algorithm === ALGORITHM &&
    typeof candidate.iv === "string" &&
    typeof candidate.authTag === "string" &&
    typeof candidate.ciphertext === "string";
}
