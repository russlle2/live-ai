import pg from "pg";
import { CONFIG } from "../config.js";
import { buildDatabaseSslOptions } from "./ssl.js";

export const pool = new pg.Pool({
  connectionString: CONFIG.databaseUrl,
  max: 10,                        // max concurrent connections
  idleTimeoutMillis: 30_000,      // close idle connections after 30s
  connectionTimeoutMillis: 3_000, // fail-fast if PG unreachable
  statement_timeout: 5_000,       // kill any query running > 5s
  // An explicit `false` also prevents PGSSLMODE from silently overriding the
  // local DB_SSL=false policy. Enabled TLS always verifies CA + DNS identity.
  ssl: buildDatabaseSslOptions({
    enabled: CONFIG.dbSsl,
    caFile: CONFIG.dbSslCaFile
  })
});

/** Lightweight DB connectivity check for health endpoints */
export async function pingDb(): Promise<boolean> {
  try {
    const { rows } = await pool.query("SELECT 1 AS ok");
    return rows[0]?.ok === 1;
  } catch {
    return false;
  }
}

export async function withClient<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}
