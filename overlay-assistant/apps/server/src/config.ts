import "dotenv/config";

export type ArbitrationLocus = "browser" | "backend" | "both";

export const CONFIG = {
  port: Number(process.env.PORT ?? 8080),
  wsPath: process.env.WS_PATH ?? "/ws",
  databaseUrl: process.env.DATABASE_URL ?? "postgres://overlay:overlay@localhost:5432/overlay",
  dbSsl: process.env.DB_SSL === "1" || process.env.DB_SSL === "true",
  openaiApiKey: process.env.OPENAI_API_KEY ?? "",
  openaiModel: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
  jwtSecret: process.env.JWT_SECRET ?? "",
  authTokenTtl: process.env.AUTH_TOKEN_TTL ?? "8h",
  allowInsecureDemoAuth: process.env.ALLOW_INSECURE_DEMO_AUTH === "1" || process.env.ALLOW_INSECURE_DEMO_AUTH === "true",
  sttMock: process.env.STT_MOCK === "1" || process.env.STT_MOCK === "true",
  sttMockIntervalMs: Number(process.env.STT_MOCK_INTERVAL_MS ?? 5000),
  arbitrationLocus: (process.env.ARBITRATION_LOCUS ?? "backend") as ArbitrationLocus,
  webOrigin: process.env.WEB_ORIGIN ?? "http://localhost:5173",
  trustProxy: process.env.TRUST_PROXY === "1" || process.env.TRUST_PROXY === "true",
  maxWsConnections: Number(process.env.MAX_WS_CONNECTIONS ?? 500),
  sessionTimeoutMs: Number(process.env.SESSION_TIMEOUT_MS ?? 30 * 60 * 1000),
  compressionEnabled: process.env.COMPRESSION !== "0"
};

export const ARBITRATION_LOCUS: ArbitrationLocus = CONFIG.arbitrationLocus;
