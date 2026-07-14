import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

const ManagedAuthSchema = z.object({
  schema: z.literal("personal_auth_v1"),
  jwtSecret: z.string().min(32),
  personalAccessCode: z.string().min(12),
  storageEncryptionKey: z.string().min(32).optional(),
  createdAt: z.string()
});

export type PersonalAuthBootstrap = {
  jwtSecret: string;
  personalAccessCode: string;
  storageEncryptionKey: string;
  managed: boolean;
};

export function clearManagedPersonalAuthArtifacts(
  filePath: string,
  options: { removeCanonical?: boolean } = {}
): { removedState: boolean; removedTempFiles: number } {
  const directory = path.dirname(filePath);
  const prefix = `${path.basename(filePath)}.`;
  let removedState = false;
  let removedTempFiles = 0;
  try {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.startsWith(prefix) && entry.name.endsWith(".tmp")) {
        fs.unlinkSync(path.join(directory, entry.name));
        removedTempFiles += 1;
      }
    }
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") throw error;
  }
  if (options.removeCanonical) {
    try {
      fs.unlinkSync(filePath);
      removedState = true;
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") throw error;
    }
  }
  return { removedState, removedTempFiles };
}

function writeManagedAuthState(
  filePath: string,
  value: z.infer<typeof ManagedAuthSchema>
): void {
  const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
    fs.chmodSync(temporary, 0o600);
    fs.renameSync(temporary, filePath);
    fs.chmodSync(filePath, 0o600);
  } catch (error) {
    try {
      fs.unlinkSync(temporary);
    } catch {
      // Preserve the original write error.
    }
    throw error;
  }
}

export function loadOrCreatePersonalAuth(params: {
  filePath: string;
  jwtSecret?: string;
  personalAccessCode?: string;
  allowInsecureDemoAuth: boolean;
  now?: () => Date;
}): PersonalAuthBootstrap {
  clearManagedPersonalAuthArtifacts(params.filePath);
  const suppliedJwt = params.jwtSecret?.trim() ?? "";
  const suppliedCode = params.personalAccessCode?.trim() ?? "";
  if (params.allowInsecureDemoAuth) {
    return {
      jwtSecret: suppliedJwt,
      personalAccessCode: suppliedCode,
      storageEncryptionKey: suppliedJwt,
      managed: false
    };
  }
  if (Boolean(suppliedJwt) !== Boolean(suppliedCode)) {
    throw new Error("JWT_SECRET and PERSONAL_ACCESS_CODE must either both be set or both be omitted");
  }
  if (suppliedJwt && suppliedJwt.length < 32) {
    throw new Error("JWT_SECRET must contain at least 32 characters");
  }
  if (suppliedCode && suppliedCode.length < 12) {
    throw new Error("PERSONAL_ACCESS_CODE must contain at least 12 characters");
  }
  if (suppliedJwt && suppliedCode) {
    return {
      jwtSecret: suppliedJwt,
      personalAccessCode: suppliedCode,
      storageEncryptionKey: "",
      managed: false
    };
  }

  let stored: z.infer<typeof ManagedAuthSchema> | undefined;
  try {
    stored = ManagedAuthSchema.parse(JSON.parse(fs.readFileSync(params.filePath, "utf8")));
    fs.chmodSync(params.filePath, 0o600);
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") throw error;
  }

  const next = ManagedAuthSchema.parse({
    schema: "personal_auth_v1",
    jwtSecret: suppliedJwt || stored?.jwtSecret || randomBytes(48).toString("base64url"),
    personalAccessCode: suppliedCode || stored?.personalAccessCode || randomBytes(15).toString("base64url"),
    storageEncryptionKey: stored?.storageEncryptionKey || randomBytes(48).toString("base64url"),
    createdAt: stored?.createdAt ?? (params.now ?? (() => new Date()))().toISOString()
  });
  const directory = path.dirname(params.filePath);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  fs.chmodSync(directory, 0o700);
  writeManagedAuthState(params.filePath, next);
  return {
    jwtSecret: next.jwtSecret,
    personalAccessCode: next.personalAccessCode,
    storageEncryptionKey: next.storageEncryptionKey!,
    managed: true
  };
}

export function rotateManagedPersonalAuth(
  filePath: string,
  options: { rotateStorageEncryptionKey?: boolean } = {}
): PersonalAuthBootstrap {
  clearManagedPersonalAuthArtifacts(filePath);
  const current = ManagedAuthSchema.parse(JSON.parse(fs.readFileSync(filePath, "utf8")));
  const next = ManagedAuthSchema.parse({
    ...current,
    jwtSecret: randomBytes(48).toString("base64url"),
    personalAccessCode: randomBytes(15).toString("base64url"),
    storageEncryptionKey: options.rotateStorageEncryptionKey
      ? randomBytes(48).toString("base64url")
      : current.storageEncryptionKey || randomBytes(48).toString("base64url")
  });
  writeManagedAuthState(filePath, next);
  return {
    jwtSecret: next.jwtSecret,
    personalAccessCode: next.personalAccessCode,
    storageEncryptionKey: next.storageEncryptionKey!,
    managed: true
  };
}

export function isLoopbackAddress(value?: string): boolean {
  if (!value) return false;
  const normalized = value.toLowerCase().split("%")[0];
  return normalized === "127.0.0.1" ||
    normalized === "::1" ||
    normalized === "::ffff:127.0.0.1";
}

type ForwardingHeader = string | string[] | undefined;

/** The pairing code is available only to a direct host process, never a proxy hop. */
export function isDirectLoopbackRequest(params: {
  remoteAddress?: string;
  forwarded?: ForwardingHeader;
  xForwardedFor?: ForwardingHeader;
  xRealIp?: ForwardingHeader;
  via?: ForwardingHeader;
}): boolean {
  const hasForwardingHeader = [params.forwarded, params.xForwardedFor, params.xRealIp, params.via]
    .some((value) => Array.isArray(value) ? value.length > 0 : Boolean(value?.trim()));
  return !hasForwardingHeader && isLoopbackAddress(params.remoteAddress);
}

export function isSafeLoopbackDemoBinding(params: { host: string; webOrigin: string }): boolean {
  const host = params.host.toLowerCase().replace(/^\[|\]$/g, "");
  if (host !== "localhost" && !isLoopbackAddress(host)) return false;
  try {
    const originHost = new URL(params.webOrigin).hostname.toLowerCase().replace(/^\[|\]$/g, "");
    return originHost === "localhost" || isLoopbackAddress(originHost);
  } catch {
    return false;
  }
}
