import path from "node:path";
import { isIP } from "node:net";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
export const OVERLAY_ROOT = path.resolve(moduleDir, "../../..");
export const REPO_ROOT = path.resolve(OVERLAY_ROOT, "..");
const defaultCoachingCorpusPaths = [
  path.join(OVERLAY_ROOT, "data/coaching/seed_examples_v1.jsonl"),
  path.join(OVERLAY_ROOT, "data/coaching/original_expansion_customer_v1.jsonl"),
  path.join(OVERLAY_ROOT, "data/coaching/original_expansion_growth_v1.jsonl")
];

// Keep the personal project's API key at the repository root while still
// supporting the original overlay-assistant/.env convention.
loadEnv({ path: path.join(REPO_ROOT, ".env.local"), override: false, quiet: true });
loadEnv({ path: path.join(OVERLAY_ROOT, ".env.local"), override: false, quiet: true });
loadEnv({ path: path.join(OVERLAY_ROOT, ".env"), override: false, quiet: true });

export type ArbitrationLocus = "browser" | "backend" | "both";

export function parseBoundedEnvInteger(
  name: string,
  raw: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number
): number {
  if (
    !Number.isSafeInteger(fallback) ||
    !Number.isSafeInteger(minimum) ||
    !Number.isSafeInteger(maximum) ||
    minimum > maximum ||
    fallback < minimum ||
    fallback > maximum
  ) {
    throw new Error(`Invalid bounds configured for ${name}`);
  }
  if (raw === undefined || raw.trim() === "") return fallback;
  const normalized = raw.trim();
  if (!/^\d+$/.test(normalized)) {
    throw new Error(`${name} must be a base-10 integer between ${minimum} and ${maximum}`);
  }
  const parsed = Number(normalized);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
  return parsed;
}

function boundedEnvInteger(
  name: string,
  fallback: number,
  minimum: number,
  maximum: number
): number {
  return parseBoundedEnvInteger(name, process.env[name], fallback, minimum, maximum);
}

export function parseStrictEnvBoolean(name: string, raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined || raw.trim() === "") return fallback;
  const normalized = raw.trim().toLowerCase();
  if (normalized === "1" || normalized === "true") return true;
  if (normalized === "0" || normalized === "false") return false;
  throw new Error(`${name} must be one of: true, false, 1, 0`);
}

function isLoopbackWebHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return normalized === "localhost" ||
    normalized.endsWith(".localhost") ||
    normalized === "127.0.0.1" ||
    normalized === "[::1]" ||
    normalized === "::1";
}

/** Require one exact browser origin; wildcard CORS can expose loopback bootstrap credentials. */
export function validateWebOrigin(value: string): string {
  const normalized = value.trim();
  if (!normalized || normalized === "*") {
    throw new Error("WEB_ORIGIN must be one exact http(s) origin; wildcard is forbidden");
  }
  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    throw new Error("WEB_ORIGIN must be a valid http(s) origin");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("WEB_ORIGIN must use http or https");
  }
  if (parsed.username || parsed.password || parsed.pathname !== "/" || parsed.search || parsed.hash) {
    throw new Error("WEB_ORIGIN must contain only scheme, host, and optional port");
  }
  if (parsed.protocol !== "https:" && !isLoopbackWebHost(parsed.hostname)) {
    throw new Error("WEB_ORIGIN must use HTTPS outside loopback development");
  }
  return parsed.origin;
}

const DATABASE_TLS_QUERY_KEYS = new Set([
  "ssl",
  "sslmode",
  "sslcert",
  "sslkey",
  "sslrootcert",
  "uselibpqcompat"
]);

/** Keep node-postgres URL parsing from replacing the app's verified TLS policy. */
export function validateDatabaseUrl(value: string, tlsEnabled: boolean): string {
  if (value.startsWith("/")) {
    if (tlsEnabled) throw new Error("DB_SSL requires a PostgreSQL URL with a DNS hostname");
    return value;
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("DATABASE_URL must be a valid PostgreSQL connection URL");
  }
  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    throw new Error("DATABASE_URL must use the postgres or postgresql scheme");
  }

  for (const key of parsed.searchParams.keys()) {
    if (DATABASE_TLS_QUERY_KEYS.has(key.toLowerCase())) {
      throw new Error(`DATABASE_URL must not set ${key}; configure TLS with DB_SSL and DB_SSL_CA_FILE`);
    }
  }

  if (tlsEnabled) {
    if (parsed.searchParams.has("host")) {
      throw new Error("DATABASE_URL must put the TLS-verified database hostname in the URL authority, not a host query parameter");
    }
    if (!parsed.hostname || isIP(parsed.hostname) !== 0) {
      throw new Error("DB_SSL requires a DNS hostname so the database certificate identity can be verified");
    }
  }
  return value;
}

export function resolveOverlayPath(value: string): string {
  if (path.isAbsolute(value)) return path.normalize(value);
  const resolved = path.resolve(OVERLAY_ROOT, value);
  const relative = path.relative(OVERLAY_ROOT, resolved);
  if (relative === ".." || relative.startsWith(`..${path.sep}`)) {
    throw new Error(`Relative runtime path escapes overlay root: ${value}`);
  }
  return resolved;
}

const configuredDbSsl = parseStrictEnvBoolean("DB_SSL", process.env.DB_SSL, false);
const configuredDatabaseUrl = validateDatabaseUrl(
  process.env.DATABASE_URL ?? "postgres://overlay:overlay@localhost:5432/overlay",
  configuredDbSsl
);
const configuredDbSslCaFile = process.env.DB_SSL_CA_FILE?.trim()
  ? resolveOverlayPath(process.env.DB_SSL_CA_FILE.trim())
  : "";
if (!configuredDbSsl && configuredDbSslCaFile) {
  throw new Error("DB_SSL_CA_FILE requires DB_SSL=true");
}

export const CONFIG = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  host: process.env.HOST ?? "127.0.0.1",
  port: boundedEnvInteger("PORT", 8080, 1, 65_535),
  wsPath: process.env.WS_PATH ?? "/ws",
  databaseUrl: configuredDatabaseUrl,
  dbSsl: configuredDbSsl,
  dbSslCaFile: configuredDbSslCaFile,
  openaiApiKey: process.env.OPENAI_API_KEY ?? "",
  openaiModel: process.env.OPENAI_LIVE_MODEL ?? process.env.OPENAI_MODEL ?? "gpt-5.6-luna",
  openaiDeepModel: process.env.OPENAI_DEEP_MODEL ?? "gpt-5.6-terra",
  openaiReasoningEffort: process.env.OPENAI_REASONING_EFFORT ?? "none",
  openaiTranscriptionModel: process.env.OPENAI_TRANSCRIPTION_MODEL ?? "gpt-realtime-whisper",
  openaiTranscriptionDelay: process.env.OPENAI_TRANSCRIPTION_DELAY ?? "minimal",
  openaiRequestTimeoutMs: boundedEnvInteger("OPENAI_REQUEST_TIMEOUT_MS", 4500, 250, 120_000),
  coachingProvisionalDelayMs: boundedEnvInteger("COACHING_PROVISIONAL_DELAY_MS", 300, 100, 30_000),
  coachingFinalDeadlineMs: boundedEnvInteger("COACHING_FINAL_DEADLINE_MS", 1500, 400, 30_000),
  openaiRealtimeTokenTtlSeconds: boundedEnvInteger("OPENAI_REALTIME_TOKEN_TTL_SECONDS", 600, 10, 7200),
  jwtSecret: process.env.JWT_SECRET ?? "",
  personalAccessCode: process.env.PERSONAL_ACCESS_CODE ?? "",
  authTokenTtl: process.env.AUTH_TOKEN_TTL ?? "8h",
  allowInsecureDemoAuth: process.env.ALLOW_INSECURE_DEMO_AUTH === "1" || process.env.ALLOW_INSECURE_DEMO_AUTH === "true",
  sttMock: process.env.STT_MOCK === "1" || process.env.STT_MOCK === "true",
  sttMockIntervalMs: boundedEnvInteger("STT_MOCK_INTERVAL_MS", 5000, 100, 3_600_000),
  arbitrationLocus: (process.env.ARBITRATION_LOCUS ?? "backend") as ArbitrationLocus,
  webOrigin: validateWebOrigin(process.env.WEB_ORIGIN ?? "http://localhost:5173"),
  trustProxy: process.env.TRUST_PROXY === "1" || process.env.TRUST_PROXY === "true",
  maxWsConnections: boundedEnvInteger("MAX_WS_CONNECTIONS", 500, 1, 10_000),
  maxWsConnectionsPerIp: boundedEnvInteger("MAX_WS_CONNECTIONS_PER_IP", 8, 1, 1000),
  sessionTimeoutMs: boundedEnvInteger("SESSION_TIMEOUT_MS", 30 * 60 * 1000, 10_000, 24 * 60 * 60_000),
  compressionEnabled: process.env.COMPRESSION !== "0",
  databaseRequired: process.env.DATABASE_REQUIRED === "1" || process.env.DATABASE_REQUIRED === "true",
  personalMemoryOwner: process.env.PERSONAL_MEMORY_OWNER ?? "Owner",
  personalAuthStatePath: resolveOverlayPath(process.env.PERSONAL_AUTH_STATE_PATH ?? "data/private/personal_auth.local.json"),
  authAutoBootstrapped: false,
  personalMemoryPath: resolveOverlayPath(process.env.PERSONAL_MEMORY_PATH ?? "data/private/personal_memory.local.json"),
  sessionLogDir: resolveOverlayPath(process.env.SESSION_LOG_DIR ?? "data/private/sessions"),
  privateStorageEncryptionKey:
    process.env.PRIVATE_STORAGE_ENCRYPTION_KEY ??
    process.env.GOOGLE_STORAGE_ENCRYPTION_KEY ??
    "",
  memoryMaxPromptFacts: boundedEnvInteger("MEMORY_MAX_PROMPT_FACTS", 12, 1, 100),
  coachingCorpusPaths: (process.env.COACHING_CORPUS_PATHS ?? process.env.COACHING_CORPUS_PATH ?? defaultCoachingCorpusPaths.join(","))
    .split(",")
    .map((filePath) => filePath.trim())
    .filter(Boolean)
    .map((filePath) => path.resolve(OVERLAY_ROOT, filePath)),
  coachingSourceManifestPath: resolveOverlayPath(process.env.COACHING_SOURCE_MANIFEST_PATH ?? "data/coaching/source_manifest_v1.json"),
  coachingMaxPromptExamples: boundedEnvInteger("COACHING_MAX_PROMPT_EXAMPLES", 3, 1, 6),
  rateLimitPerSession: boundedEnvInteger("RATE_LIMIT_PER_SESSION", 500, 1, 1_000_000),
  rateLimitPerTenantHour: boundedEnvInteger("RATE_LIMIT_PER_TENANT_HOUR", 2000, 1, 1_000_000),
  rateLimitPerTenantMinute: boundedEnvInteger("RATE_LIMIT_PER_TENANT_MINUTE", 120, 1, 100_000),
  googleClientId: process.env.GOOGLE_CLIENT_ID ?? "",
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
  googleRedirectUri: process.env.GOOGLE_REDIRECT_URI ?? "http://localhost:8080/api/google/oauth/callback",
  googleSyncDir: resolveOverlayPath(process.env.GOOGLE_SYNC_DIR ?? "data/private/google"),
  googleStorageEncryptionKey: process.env.GOOGLE_STORAGE_ENCRYPTION_KEY ?? "",
  googleSyncBatchSize: boundedEnvInteger("GOOGLE_SYNC_BATCH_SIZE", 10, 1, 100),
  googleSyncMaxPages: boundedEnvInteger("GOOGLE_SYNC_MAX_PAGES", 2, 1, 10),
  googleSyncIntervalMs: boundedEnvInteger("GOOGLE_SYNC_INTERVAL_MS", 6 * 60 * 60_000, 60_000, 24 * 60 * 60_000),
  googleRequestTimeoutMs: boundedEnvInteger("GOOGLE_REQUEST_TIMEOUT_MS", 15_000, 1_000, 120_000),
  googleMaxJsonResponseBytes: boundedEnvInteger("GOOGLE_MAX_JSON_RESPONSE_BYTES", 2 * 1024 * 1024, 1024, 8 * 1024 * 1024),
  googleMaxTextResponseBytes: boundedEnvInteger("GOOGLE_MAX_TEXT_RESPONSE_BYTES", 1_000_000, 1024, 4 * 1024 * 1024),
  googleMaxExtractionsPerRun: boundedEnvInteger("GOOGLE_MAX_EXTRACTIONS_PER_RUN", 5, 1, 50),
  googleDailyExtractionBudget: boundedEnvInteger("GOOGLE_DAILY_EXTRACTION_BUDGET", 40, 1, 500),
  googleMaxCachedSources: boundedEnvInteger("GOOGLE_MAX_CACHED_SOURCES", 1000, 10, 10_000),
  googleGmailQuery: (process.env.GOOGLE_GMAIL_QUERY ?? "-in:spam -in:trash").slice(0, 500),
  googleDriveQuery: (process.env.GOOGLE_DRIVE_QUERY ?? "").slice(0, 2000),
  webDistPath: resolveOverlayPath(process.env.WEB_DIST_PATH ?? "apps/web/dist")
};

export const ARBITRATION_LOCUS: ArbitrationLocus = CONFIG.arbitrationLocus;
