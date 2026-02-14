import fs from "fs";
import path from "path";
import { SCENARIOS_V3 } from "./scenario_bank_v3";
import { applyMutatorsV3 } from "./mutators_v3";
import { loadEngineV3 } from "./engine_loader_v3";
import { bump, makeRng, pickWeighted, runIdNow, tokenize, topK } from "./util_v3";
import { autopatchProductPackFactsV3 } from "./autopatch_product_pack_v3";
import { renderReportV3, type MetricsV3 } from "./report_v3";
import type { RunConfig, Scenario } from "./types_v3";
function resolveRepoRootForOut(): string {
  // Prefer repo root (where package.json + apps exist)
  const fs = require("fs");
  const path = require("path");
  let dir = process.cwd();
  for (let i = 0; i < 12; i++) {
    if (fs.existsSync(path.join(dir, "package.json")) && fs.existsSync(path.join(dir, "apps"))) return dir;
    dir = path.resolve(dir, "..");
  }
  return process.cwd();
}

function parseArgs(argv: string[]): RunConfig {
  const cfg: RunConfig = {
    minutes: 30,
    sessions: 300,
    turns: 8,
    concurrency: 2,
    seed: 1337,
    applyFacts: false,
const OUT_BASE = require("path").resolve(resolveRepoRootForOut(), "tools/overnight/out_v3_v3");
    outRoot: "tools/overnight/out_v3",
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[i + 1];
    const take = () => { const v = next(); i++; return v; };

    if (a === "--minutes") cfg.minutes = Number(take());
    else if (a === "--sessions") cfg.sessions = Number(take());
    else if (a === "--turns") cfg.turns = Number(take());
    else if (a === "--concurrency") cfg.concurrency = Number(take());
    else if (a === "--seed") cfg.seed = Number(take());
    else if (a === "--applyFacts") cfg.applyFacts = true;
    else if (a === "--outRoot") cfg.outRoot = String(take());
  }

  // hard clamps
  if (!Number.isFinite(cfg.minutes) || cfg.minutes <= 0) cfg.minutes = 30;
  if (!Number.isFinite(cfg.sessions) || cfg.sessions <= 0) cfg.sessions = 200;
  if (!Number.isFinite(cfg.turns) || cfg.turns <= 0) cfg.turns = 6;
  if (!Number.isFinite(cfg.concurrency) || cfg.concurrency <= 0) cfg.concurrency = 2;

  cfg.sessions = Math.min(cfg.sessions, 50_000);
  cfg.turns = Math.min(cfg.turns, 50);
  cfg.concurrency = Math.min(cfg.concurrency, 16);

  return cfg;
}

function findRepoRoot(startDir: string) {
  let cur = startDir;
  for (let i = 0; i < 8; i++) {
    const pkg = path.join(cur, "package.json");
    if (fs.existsSync(pkg)) return cur;
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return startDir;
}

function findProductPackDir(repoRoot: string): string | null {
  const candidates = [
    path.join(repoRoot, "product_packs"),
    path.join(repoRoot, "apps", "product_packs"),
    path.join(repoRoot, "apps", "server", "..", "product_packs"),
  ];
  for (const c of candidates) {
    try {
      if (fs.existsSync(c) && fs.statSync(c).isDirectory()) return path.resolve(c);
    } catch {
      // ignore
    }
  }
  return null;
}

function pickScenario(rng: () => number, scenarios: Scenario[]) {
  // Weight certain stress scenarios slightly higher
  const weighted = scenarios.map(s => ({
    ...s,
    weight:
      s.tags.includes("stakeholder") ? 1.3 :
      s.tags.includes("off_topic") ? 1.2 :
      s.tags.includes("integration") ? 1.2 :
      1.0
  })) as any[];
  return pickWeighted(rng, weighted) as Scenario;
}

type EventV3 = {
  schema: "overnight_event_v3";
  runId: string;
  at: string;
  sessionId: string;
  turn: number;
  scenarioId: string;
  text: string;
  suppressed: boolean;
  moment: string;
  microGoal: string;
  confidenceBand: string;
  confidence: number | null;
  usedProductPack: boolean | null;
  usedFactsCount: number | null;
  suggestionText: string;
};

async function main() {
  const cfg = parseArgs(process.argv.slice(2));
  const repoRoot = findRepoRoot(process.cwd());
  const runId = runIdNow("run");
  const outDir = path.join(repoRoot, cfg.outRoot, runId);
  fs.mkdirSync(outDir, { recursive: true });

  const startedAt = new Date().toISOString();

  // Ensure product pack dir is absolute and correct for THIS process.
  const packDir = findProductPackDir(repoRoot);
  if (packDir) {
    process.env.PRODUCT_PACK_DIR = packDir;
  }

  // Always allow low-confidence suggestions in the harness, so we can see what the engine *would* do.
  // (The UI can still hide them, but we want the analysis.)
  process.env.SHOW_LOW_CONFIDENCE = "true";

  // Load engine
  const engine = await loadEngineV3(repoRoot);

  // Optional: auto-patch product pack facts BEFORE running scenarios.
  let factsPatchNote: any = null;
  if (cfg.applyFacts && packDir) {
    factsPatchNote = autopatchProductPackFactsV3(repoRoot, packDir);
  }

  const rng = makeRng(cfg.seed);
  const endAtMs = Date.now() + cfg.minutes * 60 * 1000;

  const eventsPath = path.join(outDir, "events.jsonl");
  fs.writeFileSync(eventsPath, ""); // reset

  // Metrics accumulators
  const byMoment: Record<string, number> = {};
  const byMicroGoal: Record<string, number> = {};
  const byConfidenceBand: Record<string, number> = {};
  const byLanguage: Record<string, number> = {};
  const usedFactsBins: Record<string, number> = { "0": 0, "1": 0, "2": 0, "3+": 0 };
  let usedProductPackTrue = 0;
  let usedProductPackFalse = 0;

  let totalTurns = 0;
  let sessionsSimulated = 0;
  let suppressedTurns = 0;
  let unknownMomentTurns = 0;

  const unknownTerms: Record<string, number> = {};

  // Serialize writes across concurrent workers
  let writeChain = Promise.resolve();
  const writeJsonl = (obj: any) => {
    writeChain = writeChain.then(() => fs.promises.appendFile(eventsPath, JSON.stringify(obj) + "\n"));
    return writeChain;
  };

  async function runOneSession(sessionN: number) {
    const scenario = pickScenario(rng, SCENARIOS_V3);
    const sessionId = `sess_overnight_${runId}_${sessionN}_${Math.floor(rng() * 1e9)}`;
    const memory = engine.createMemory();
    const controls = {
      guidanceMode: "assist",
      guidanceMuted: false,
      aiDepth: "P0",
      showLowConfidence: true,
    };

    for (let t = 0; t < cfg.turns; t++) {
      if (Date.now() > endAtMs) break;

      const baseTurn = pickWeighted(rng, scenario.turns).template;
      const text = applyMutatorsV3(rng, baseTurn);

      const res: any = await engine.run({
        tenantId: "tenant_demo",
        repId: "rep_demo",
        sessionId,
        controls,
        memory,
        text
      });

      const patch: any = res?.patch ?? {};
      const meta: any = res?.meta ?? patch?.guidance?.items?.[0]?.explanation?.meta ?? {};
      const suppressed = Boolean(res?.suppressed);

      const moment = String(meta?.moment ?? "unknown");
      const microGoal = String(meta?.microGoal ?? "unknown");
      const confidenceBand = String(meta?.confidenceBand ?? "unknown");
      const confidence = typeof meta?.confidence === "number" ? meta.confidence : null;
      const usedProductPack = typeof meta?.usedProductPack === "boolean" ? meta.usedProductPack : null;
      const usedFactsCount = typeof meta?.usedFactsCount === "number" ? meta.usedFactsCount : null;
      const language = String(meta?.language ?? "unknown");

      const suggestionText =
        (patch?.text && typeof patch.text === "string" ? patch.text :
        patch?.guidance?.items?.[0]?.suggestedText ??
        patch?.guidance?.items?.[0]?.text ??
        "");

      // Metrics
      bump(byMoment, moment);
      bump(byMicroGoal, microGoal);
      bump(byConfidenceBand, confidenceBand);
      bump(byLanguage, language);

      if (usedProductPack === true) usedProductPackTrue += 1;
      if (usedProductPack === false) usedProductPackFalse += 1;

      if (usedFactsCount === 0) usedFactsBins["0"] += 1;
      else if (usedFactsCount === 1) usedFactsBins["1"] += 1;
      else if (usedFactsCount === 2) usedFactsBins["2"] += 1;
      else if (typeof usedFactsCount === "number" && usedFactsCount >= 3) usedFactsBins["3+"] += 1;

      totalTurns += 1;
      if (suppressed) suppressedTurns += 1;
      if (moment === "unknown") unknownMomentTurns += 1;

      // Unknown-term mining
      if (suppressed || moment === "unknown" || confidenceBand === "low") {
        for (const tok of tokenize(text)) bump(unknownTerms, tok);
      }

      const ev: EventV3 = {
        schema: "overnight_event_v3",
        runId,
        at: new Date().toISOString(),
        sessionId,
        turn: t,
        scenarioId: scenario.id,
        text,
        suppressed,
        moment,
        microGoal,
        confidenceBand,
        confidence,
        usedProductPack,
        usedFactsCount,
        suggestionText: String(suggestionText).slice(0, 4000)
      };

      await writeJsonl(ev);
    }
  }

  // Promise pool
  let nextSession = 0;
  const workers: Promise<void>[] = [];
  const worker = async () => {
    while (nextSession < cfg.sessions && Date.now() <= endAtMs) {
      const n = nextSession++;
      sessionsSimulated = Math.max(sessionsSimulated, n + 1);
      try {
        await runOneSession(n);
      } catch (e: any) {
        // Write a failure event but continue
        await writeJsonl({
          schema: "overnight_event_v3",
          runId,
          at: new Date().toISOString(),
          sessionId: `sess_overnight_${runId}_${n}`,
          turn: -1,
          scenarioId: "internal_error",
          text: "",
          suppressed: true,
          moment: "error",
          microGoal: "error",
          confidenceBand: "error",
          confidence: null,
          usedProductPack: null,
          usedFactsCount: null,
          suggestionText: `ERROR: ${(e?.message ?? e).toString()}`
        });
      }
    }
  };

  for (let i = 0; i < cfg.concurrency; i++) workers.push(worker());
  await Promise.all(workers);
  await writeChain;

  const finishedAt = new Date().toISOString();

  const topUnknownTerms = topK(unknownTerms, 80);

  const metrics: MetricsV3 = {
    runId,
    startedAt,
    finishedAt,
    config: cfg,

    totalTurns,
    sessionsSimulated,

    suppressedTurns,
    unknownMomentTurns,

    byMoment,
    byMicroGoal,
    byConfidenceBand,
    byLanguage,

    usedProductPackTrue,
    usedProductPackFalse,

    usedFactsCount: usedFactsBins,
    topUnknownTerms
  };

  fs.writeFileSync(path.join(outDir, "metrics.json"), JSON.stringify(metrics, null, 2) + "\n");
  fs.writeFileSync(path.join(outDir, "top_terms_unknown.json"), JSON.stringify(topUnknownTerms, null, 2) + "\n");

  // Regex suggestions: heuristic groupings
  const rxLines: string[] = [];
  rxLines.push("# Regex suggestions (v3 heuristic)");
  rxLines.push("");
  rxLines.push("These are not auto-applied. They’re meant to guide updates in your moment/intent detection.");
  rxLines.push("");
  rxLines.push("## Stakeholder sign-off / procurement");
  rxLines.push("Suggested patterns to catch:");
  rxLines.push("- signs off / approval / approve / approved");
  rxLines.push("- CFO / finance / budget owner");
  rxLines.push("- procurement / legal / security review / DPA / MSA");
  rxLines.push("");
  rxLines.push("Example regex:");
  rxLines.push("```");
  rxLines.push(String.raw`/\b(signs?\s+off|approv(e|al)|cfo|finance|budget\s+owner|procurement|legal|msa|dpa|security\s+review)\b/i`);
  rxLines.push("```");
  rxLines.push("");
  rxLines.push("## Style constraints");
  rxLines.push("Catch modifiers and treat them as style constraints, not 'unknown moment':");
  rxLines.push("```");
  rxLines.push(String.raw`/\b(short\s+version|tl;dr|keep\s+it\s+short|non-technical|explain\s+like\s+i\'?m\s+five|answer\s+today|deciding\s+this\s+week)\b/i`);
  rxLines.push("```");
  rxLines.push("");
  fs.writeFileSync(path.join(outDir, "regex_suggestions.md"), rxLines.join("\n"));

  // Facts todo: filter to more “content-y” terms
  const todoLines: string[] = [];
  todoLines.push("# Facts TODO (v3)");
  todoLines.push("");
  todoLines.push("Add / refine facts (product pack) for the concepts below (filtered from unknown/suppressed turns).");
  todoLines.push("");
  const todoTerms = topUnknownTerms
    .filter(t => t.count >= 5)
    .map(t => t.term)
    .filter(t => !/^(week|today|short|version|please|quick|question)$/.test(t)); // keep list clean
  for (const term of todoTerms.slice(0, 40)) {
    todoLines.push(`- ${term}: add a short, safe fact that helps coaching`);
  }
  todoLines.push("");
  todoLines.push("Suggested baseline facts to add (if missing):");
  todoLines.push("- stakeholder approval criteria (CFO, legal, security)");
  todoLines.push("- procurement checklist (SOC2, DPA/MSA, retention, data flow)");
  todoLines.push("- timeline acceleration path (fastest way to verify integrations)");
  todoLines.push("- short answer formatting");
  todoLines.push("- non-technical explanation template");
  fs.writeFileSync(path.join(outDir, "facts_todo.md"), todoLines.join("\n"));

  const report = renderReportV3(metrics);
  fs.writeFileSync(path.join(outDir, "overnight_report.md"), report + "\n");

  const summary = {
    ok: true,
    runId,
    engine: engine.kind,
    outDir,
    factsPatchNote
  };
  fs.writeFileSync(path.join(outDir, "summary.json"), JSON.stringify(summary, null, 2) + "\n");

  // Print a single line that’s easy to copy.
  // eslint-disable-next-line no-console
  console.log(`[overnight:v3] ok runId=${runId} engine=${engine.kind} outDir=${outDir}`);
  if (factsPatchNote?.changed) {
    // eslint-disable-next-line no-console
    console.log(`[overnight:v3] applied facts patch: ${factsPatchNote.file} (backup: ${factsPatchNote.backup})`);
  }
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error("[overnight:v3] fatal", e);
  process.exit(1);
});