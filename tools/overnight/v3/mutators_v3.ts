import { pickWeighted } from "./util_v3";

type Weighted = { text: string; weight?: number };

const PREFIXES: Weighted[] = [
  { text: "", weight: 8 },
  { text: "Quick question — ", weight: 2 },
  { text: "Short version please: ", weight: 2 },
  { text: "Be straight with me: ", weight: 1 },
  { text: "I’m not technical, so: ", weight: 1 },
];

const SUFFIXES: Weighted[] = [
  { text: "", weight: 10 },
  { text: " We’re deciding this week.", weight: 2 },
  { text: " Answer like I’m non-technical.", weight: 2 },
  { text: " Keep it to one sentence.", weight: 1 },
  { text: " What’s the biggest risk we avoid?", weight: 1 },
];

const NOISE: Weighted[] = [
  { text: "", weight: 10 },
  { text: " Also, we’re comparing to a competitor.", weight: 1 },
  { text: " Also, security will review.", weight: 1 },
  { text: " Also, integration depth is our main criteria.", weight: 1 },
];

export function applyMutatorsV3(rng: () => number, base: string) {
  const p = pickWeighted(rng, PREFIXES).text;
  const s = pickWeighted(rng, SUFFIXES).text;
  const n = pickWeighted(rng, NOISE).text;

  // Avoid double spaces when prefix is empty.
  const out = `${p}${base}${s}${n}`.replace(/\s+/g, " ").trim();
  return out;
}
