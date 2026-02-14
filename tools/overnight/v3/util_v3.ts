import crypto from "crypto";

export function runIdNow(prefix = "run") {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const id = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  return `${prefix}_${id}`;
}

// Deterministic RNG (mulberry32)
export function makeRng(seed: number) {
  let t = seed >>> 0;
  return function rand() {
    t += 0x6D2B79F5;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x ^= x + Math.imul(x ^ (x >>> 7), 61 | x);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

export function pickWeighted<T extends { weight?: number }>(rng: () => number, items: T[]): T {
  const total = items.reduce((s, it) => s + (it.weight ?? 1), 0);
  let r = rng() * total;
  for (const it of items) {
    r -= (it.weight ?? 1);
    if (r <= 0) return it;
  }
  return items[items.length - 1];
}

export function sha256Hex(s: string) {
  return crypto.createHash("sha256").update(s).digest("hex");
}

// Tiny stoplist: used to keep top_terms_unknown useful.
const STOP = new Set([
  "a","an","and","are","as","at","be","but","by","can","could","did","do","does","for","from","had","has","have","how",
  "i","if","in","into","is","it","its","just","like","me","my","no","not","of","on","or","our","please","so","that",
  "the","their","them","then","there","these","they","this","to","too","us","was","we","were","what","when","which","who",
  "why","will","with","would","you","your"
]);

export function tokenize(text: string): string[] {
  const norm = text
    .toLowerCase()
    .replace(/[“”‘’]/g, "'")
    .replace(/[^a-z0-9\s\-']/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!norm) return [];
  const raw = norm.split(" ");
  const toks: string[] = [];
  for (const t of raw) {
    if (!t) continue;
    if (t.length <= 2) continue;
    if (STOP.has(t)) continue;
    toks.push(t);
  }
  return toks;
}

export function bump(map: Record<string, number>, key: string, by = 1) {
  map[key] = (map[key] ?? 0) + by;
}

export function topK(map: Record<string, number>, k = 50) {
  return Object.entries(map).sort((a,b) => b[1] - a[1]).slice(0, k).map(([term,count]) => ({ term, count }));
}
