import pg from "pg";
import { CONFIG } from "../config";

export const pool = new pg.Pool({
  connectionString: CONFIG.databaseUrl
});

export async function withClient<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}
