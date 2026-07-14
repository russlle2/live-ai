import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { pool } from "./pool.js";

async function run() {
  // Works from both src/ under tsx and dist/ in the production image.
  const migrationsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "migrations");
  const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();
  for (const f of files) {
    const full = path.join(migrationsDir, f);
    const sql = fs.readFileSync(full, "utf8");
    // eslint-disable-next-line no-console
    console.log(`[migrate] applying ${f}`);
    await pool.query(sql);
  }
  // eslint-disable-next-line no-console
  console.log("[migrate] done");
  await pool.end();
}
run().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("[migrate] failed", err);
  process.exit(1);
});
