import path from "path";
import dotenv from "dotenv";

// Force-load repo-root .env (server runs from apps/server)
dotenv.config({ path: path.resolve(process.cwd(), "../../.env") });
// Optional local override
dotenv.config({ path: path.resolve(process.cwd(), ".env") });

export const ARBITRATION_LOCUS = (process.env.ARBITRATION_LOCUS || "backend") as "backend" | "browser";

export const CONFIG = {
  // HTTP server port (support SERVER_PORT; fall back to PORT; default 8080)
  port: Number(process.env.SERVER_PORT || process.env.PORT || 8080),

  webOrigin: process.env.WEB_ORIGIN || "http://localhost:5173",

  // WS path
  wsPath: process.env.WS_PATH || "/ws",

  databaseUrl: process.env.DATABASE_URL || "postgres://user@localhost:5432/user",
  sttMockIntervalMs: Number(process.env.STT_MOCK_INTERVAL_MS || 4000),
    retentionPruneEnabled: (process.env.RETENTION_PRUNE_ENABLED || "true") === "true",
    retentionPruneIntervalMs: Math.max(60_000, Number(process.env.RETENTION_PRUNE_INTERVAL_MS || 900_000)),

  sttMock: (process.env.STT_MOCK || "true") === "true",

  defaultControls: {
    guidanceMode: "assist",
    guidanceMuted: false,
    aiDepth: (process.env.AI_DEPTH || "P0") as "P0" | "P1" | "P2",
    showLowConfidence: (process.env.SHOW_LOW_CONFIDENCE || "true") === "true",
  }
};
