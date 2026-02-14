import fs from "fs";
import path from "path";
import { productPackDir } from "./product_pack_v1";

export type FactV1 = { id: string; text: string; tags?: string[] };
export type FactsFileV1 = { schema: "facts_v1"; facts: FactV1[] };

export function loadFactsV1(tenantId: string): FactV1[] {
  const file = path.join(productPackDir(), tenantId, "facts.json");
  if (!fs.existsSync(file)) return [];
  const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as FactsFileV1;
  if (!parsed || parsed.schema !== "facts_v1" || !Array.isArray(parsed.facts)) return [];
  return parsed.facts.filter((f) => f && typeof f.id === "string" && typeof f.text === "string");
}

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((x) => x.length >= 3)
    .slice(0, 60);
}

export function retrieveFactsV1(query: string, facts: FactV1[], limit = 4): FactV1[] {
  const q = new Set(tokenize(query));
  const scored = facts.map((f) => {
    const ft = tokenize(f.text);
    let score = 0;
    for (const tok of ft) if (q.has(tok)) score += 1;
    // small boost for tags
    if (f.tags?.some((tg) => q.has(tg.toLowerCase()))) score += 2;
    return { f, score };
  });

  return scored
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.f);
}
