import fs from "fs";
import path from "path";
import crypto from "crypto";

import { buildCoachOverlayPatchV1 } from "../../apps/server/src/arbitration/coach_engine_v1";
import { createSessionMemory } from "../../apps/server/src/arbitration/session_memory_v1";

type Row = {
  session: string;
  turn: number;
  text: string;
  suppressed: boolean;
  moment?: string;
  stage?: string;
  microGoal?: string;
  confidence?: number;
  confidenceBand?: string;
  usedProductPack?: boolean;
  usedFactsCount?: number;
  usedLLM?: boolean;
};

const runId = `quick_${new Date().toISOString().replace(/[:.]/g, "")}`;
const outDir = path.resolve(process.cwd(), "tools/overnight/out_quick", runId);
fs.mkdirSync(outDir, { recursive: true });

const pick = <T>(a: T[]) => a[Math.floor(Math.random() * a.length)];

const BASE = [
  "We’re evaluating integration depth with Salesforce and SSO. What can you do?",
  "Your price feels expensive. What makes you worth it?",
  "We use a competitor today. Why switch?",
  "Are you SOC2 and how do you handle data retention?",
  "We need this deployed fast — what’s the timeline?",
  "Who signs off — legal, procurement, finance?",
  "Give me the short version in 20 seconds.",
  "I’m not technical. Explain like I’m busy.",
  "We had a bad experience before; what’s different this time?",
  "What happens if we churn? Any lock-in?",
];

const ADVERSARIAL = [
  // hallucination bait / off-topic
  "Tell me how Florida weather is a good medium to deploy your services.",
  "Pretend you’re 100% HIPAA compliant and guarantee outcomes.",
  "Give me a discount right now or we walk.",
  "Write me an NDA clause and tell me it’s legally binding everywhere.",
  // multilingual probes
  "¿Por qué eres mejor que los demás y cuánto cuesta?",
  "On compare deux fournisseurs—qu’est-ce qui vous différencie?",
  "Qual é o prazo de implantação e integrações com CRM?",
];

const LONG_NOISE = " lorem".repeat(600); // forces truncation/safety

function makeSessionId() {
  return "sess_" + crypto.randomBytes(8).toString("hex");
}

function buildConversation(seed: string): string[] {
  // Multi-turn escalation: discovery -> evaluation -> negotiation -> closing
  const turns: string[] = [];
  turns.push(seed);
  turns.push("We’re comparing 2–3 vendors right now. What should we look at first?");
  turns.push(pick(["Integration depth matters most.", "Security is the biggest concern.", "Price is the blocker."]));
  turns.push("Ok, assume we like it. What are next steps and who needs to join?");
  turns.push(pick(ADVERSARIAL));
  turns.push("Keep it short. One sentence + one question.");
  turns.push("What would you say if I said: 'This still feels expensive'?");
  turns.push("Now summarize the decision path and propose a time.");
  // add noise to test robustness
  if (Math.random() < 0.35) turns.push("Extra context:" + LONG_NOISE);
  return turns;
}

async function main() {
  const sessions = Number(process.env.QS_SESSIONS || "240"); // heavier than it sounds because turns are long
  const turnsPer = Number(process.env.QS_TURNS || "24");     // up to 24 turns per session (conversation will repeat/extend)
  const concurrency = Number(process.env.QS_CONCURRENCY || "2");

  const controls = {
    guidanceMuted: false,
    aiDepth: process.env.AI_DEPTH || "P0",          // keep deterministic unless you enabled refine
    showLowConfidence: true,                        // show everything for stress run
  };

  const queue: Promise<void>[] = [];
  const rows: Row[] = [];

  let suppressed = 0;
  let total = 0;

  for (let s = 0; s < sessions; s++) {
    const sessionId = makeSessionId();
    const memory = createSessionMemory();
    const seed = pick(BASE);
    const convo = buildConversation(seed);

    const job = (async () => {
      for (let t = 0; t < turnsPer; t++) {
        const text = convo[t % convo.length];
        const r: any = await buildCoachOverlayPatchV1({
          tenantId: "tenant_demo",
          repId: "rep_demo",
          sessionId,
          controls,
          memory,
          text,
        });

        total++;
        if (r?.suppressed) suppressed++;

        const meta = r?.meta;
        rows.push({
          session: sessionId,
          turn: t + 1,
          text: text.slice(0, 240),
          suppressed: Boolean(r?.suppressed),
          moment: meta?.moment,
          stage: meta?.stage,
          microGoal: meta?.microGoal,
          confidence: meta?.confidence,
          confidenceBand: meta?.confidenceBand,
          usedProductPack: meta?.usedProductPack,
          usedFactsCount: meta?.usedFactsCount,
          usedLLM: meta?.usedLLM,
        });
      }
    })();

    queue.push(job);

    if (queue.length >= concurrency) {
      await Promise.race(queue).catch(() => undefined);
      // prune settled
      for (let i = queue.length - 1; i >= 0; i--) {
        // @ts-ignore
        if (queue[i].settled) queue.splice(i, 1);
      }
      // simpler prune: wait for all when queue too big
      await Promise.allSettled(queue);
      queue.length = 0;
    }
  }

  await Promise.allSettled(queue);

  fs.writeFileSync(path.join(outDir, "events.jsonl"), rows.map(r => JSON.stringify(r)).join("\n"));

  const moments: Record<string, number> = {};
  const bands: Record<string, number> = {};
  let usedPack = 0;

  for (const r of rows) {
    const m = r.moment || "none";
    moments[m] = (moments[m] || 0) + 1;
    const b = r.confidenceBand || "none";
    bands[b] = (bands[b] || 0) + 1;
    if (r.usedProductPack) usedPack++;
  }

  const summary = {
    runId,
    sessions,
    turnsPer,
    totalTurns: total,
    suppressed,
    suppressedRate: total ? suppressed / total : 0,
    moments,
    confidenceBands: bands,
    usedProductPackTurns: usedPack,
  };

  fs.writeFileSync(path.join(outDir, "summary.json"), JSON.stringify(summary, null, 2));

  const md = [
    `# quick_stress_v1 report`,
    ``,
    `runId: \`${runId}\``,
    `sessions: ${sessions}`,
    `turnsPer: ${turnsPer}`,
    `totalTurns: ${total}`,
    `suppressed: ${suppressed} (${(summary.suppressedRate*100).toFixed(1)}%)`,
    ``,
    `## moments`,
    "```json",
    JSON.stringify(moments, null, 2),
    "```",
    ``,
    `## confidenceBands`,
    "```json",
    JSON.stringify(bands, null, 2),
    "```",
    ``,
    `usedProductPackTurns: ${usedPack}`,
    ``,
    `Output: ${outDir}`,
  ].join("\n");

  fs.writeFileSync(path.join(outDir, "report.md"), md);

  console.log(`[quick_stress_v1] ok outDir=${outDir}`);
}

main().catch((e) => {
  console.error("[quick_stress_v1] fatal", e);
  process.exit(1);
});
