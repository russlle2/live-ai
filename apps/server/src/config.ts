import "dotenv/config";

export type ArbitrationLocus = "browser" | "backend" | "both";

export const CONFIG = {
  port: Number(process.env.PORT ?? 8080),
  wsPath: process.env.WS_PATH ?? "/ws",
  databaseUrl: process.env.DATABASE_URL ?? "postgres://overlay:overlay@localhost:5432/overlay",
  openaiApiKey: process.env.OPENAI_API_KEY ?? "",
  openaiModel: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
  sttMock: process.env.STT_MOCK === "1" || process.env.STT_MOCK === "true",
  sttMockIntervalMs: Number(process.env.STT_MOCK_INTERVAL_MS ?? 2500),
  arbitrationLocus: (process.env.ARBITRATION_LOCUS ?? "backend") as ArbitrationLocus,
  webOrigin: process.env.WEB_ORIGIN ?? "http://localhost:5173"
};

export const ARBITRATION_LOCUS: ArbitrationLocus = CONFIG.arbitrationLocus;
