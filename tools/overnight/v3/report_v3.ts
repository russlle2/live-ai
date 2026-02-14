import { topK } from "./util_v3";
import type { RunConfig } from "./types_v3";

export type MetricsV3 = {
  runId: string;
  startedAt: string;
  finishedAt: string;
  config: RunConfig;

  totalTurns: number;
  sessionsSimulated: number;

  suppressedTurns: number;
  unknownMomentTurns: number;

  byMoment: Record<string, number>;
  byMicroGoal: Record<string, number>;
  byConfidenceBand: Record<string, number>;
  byLanguage: Record<string, number>;

  usedProductPackTrue: number;
  usedProductPackFalse: number;

  usedFactsCount: Record<string, number>; // "0","1","2","3+"
  topUnknownTerms: { term: string; count: number }[];
};

export function renderReportV3(m: MetricsV3) {
  const lines: string[] = [];
  lines.push(`# Overnight Report v3`);
  lines.push(``);
  lines.push(`Run: **${m.runId}**`);
  lines.push(`Started: ${m.startedAt}`);
  lines.push(`Finished: ${m.finishedAt}`);
  lines.push(``);
  lines.push(`## Volume`);
  lines.push(`- Sessions: **${m.sessionsSimulated}**`);
  lines.push(`- Turns: **${m.totalTurns}**`);
  lines.push(`- Suppressed: **${m.suppressedTurns}**`);
  lines.push(`- Moment=unknown: **${m.unknownMomentTurns}**`);
  lines.push(``);

  lines.push(`## Coverage`);
  lines.push(`### Moment distribution (top 15)`);
  for (const { term, count } of topK(m.byMoment, 15)) lines.push(`- ${term}: ${count}`);
  lines.push(``);
  lines.push(`### Micro-goal distribution (top 15)`);
  for (const { term, count } of topK(m.byMicroGoal, 15)) lines.push(`- ${term}: ${count}`);
  lines.push(``);
  lines.push(`### Confidence band`);
  for (const { term, count } of topK(m.byConfidenceBand, 10)) lines.push(`- ${term}: ${count}`);
  lines.push(``);

  lines.push(`## Product-pack usage`);
  lines.push(`- usedProductPack=true: ${m.usedProductPackTrue}`);
  lines.push(`- usedProductPack=false: ${m.usedProductPackFalse}`);
  lines.push(``);
  lines.push(`### Facts used per suggestion`);
  const factsBins = Object.entries(m.usedFactsCount).sort((a,b) => Number(a[0].replace('+','')) - Number(b[0].replace('+','')));
  for (const [bin, count] of factsBins) lines.push(`- ${bin}: ${count}`);
  lines.push(``);

  lines.push(`## Top terms correlated with unknown/suppressed`);
  for (const t of m.topUnknownTerms.slice(0, 30)) lines.push(`- ${t.term}: ${t.count}`);
  lines.push(``);

  lines.push(`## Suggested next patches (human review)`);
  lines.push(`1) **Stakeholder sign-off**: Add moment/intent patterns for "signs off", "approve", "CFO", "procurement", "legal review".`);
  lines.push(`2) **Style constraints**: Detect and honor modifiers like "short version", "non-technical", "answer today".`);
  lines.push(`3) **Off-topic prompts**: Keep a consistent fallback: clarify → reframe back to evaluation criteria → propose next step.`);
  lines.push(`4) **Suppression**: If confidence is low, default to a safe clarify question instead of outputting nothing.`);
  lines.push(``);

  lines.push(`## How to run again`);
  lines.push("```bash");
  lines.push(`bash tools/overnight/run_v3.sh --minutes ${m.config.minutes} --sessions ${m.config.sessions} --turns ${m.config.turns} --concurrency ${m.config.concurrency}`);
  lines.push("```");
  lines.push(``);

  return lines.join("\n");
}
