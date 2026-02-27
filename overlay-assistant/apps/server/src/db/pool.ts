import pg from "pg";
import { CONFIG } from "../config";

export const pool = new pg.Pool({
  connectionString: CONFIG.databaseUrl,
  max: 10,                        // max concurrent connections
  idleTimeoutMillis: 30_000,      // close idle connections after 30s
  connectionTimeoutMillis: 3_000, // fail-fast if PG unreachable
  statement_timeout: 5_000        // kill any query running > 5s
} as any);

export async function withClient<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}
