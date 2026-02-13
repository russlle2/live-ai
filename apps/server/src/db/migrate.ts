import fs from "fs";
import path from "path";
import { pool } from "./pool";

async function run() {
  const migrationsDir = path.resolve(process.cwd(), "src/db/migrations");
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
