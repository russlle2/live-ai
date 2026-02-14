import fs from "fs";
import path from "path";
import { pathToFileURL, fileURLToPath } from "url";
import type { EngineResult, CoachPatch, GuidanceItem } from "./types_v3";

export type LoadedEngine = {
  kind: "coach_engine_v1" | "arbitration_v1_fallback";
  createMemory: () => any;
  run: (args: { tenantId: string; repId: string; sessionId: string; controls: any; memory: any; text: string }) => Promise<EngineResult>;
};

async function tryImport(fileAbs: string) {
  const url = pathToFileURL(fileAbs).href;
  return await import(url);
}

function isRepoRoot(dir: string): boolean {
  return fs.existsSync(path.join(dir, "package.json")) && fs.existsSync(path.join(dir, "apps"));
}

function findRepoRootUp(startDir: string): string | null {
  let dir = startDir;
  for (let i = 0; i < 12; i++) {
    if (isRepoRoot(dir)) return dir;
    dir = path.resolve(dir, "..");
  }
  return null;
}

function resolveRepoRoot(input?: string): string {
  // 1) If caller provided a valid repoRoot, use it
  if (input && isRepoRoot(input)) return input;

  // 2) Try from current working directory
  const fromCwd = findRepoRootUp(process.cwd());
  if (fromCwd) return fromCwd;

  // 3) Try from this file location (ESM-safe)
  const hereDir = path.dirname(fileURLToPath(import.meta.url));
  const guess = path.resolve(hereDir, "../../../.."); // tools/overnight/v3 -> repo root
  if (isRepoRoot(guess)) return guess;

  // 4) Last resort: search upward from hereDir
  const fromHere = findRepoRootUp(hereDir);
  if (fromHere) return fromHere;

  // If we truly can't find it, return input/cwd for debug
  return input || process.cwd();
}

export async function loadEngineV3(repoRootInput?: string): Promise<LoadedEngine> {
  const repoRoot = resolveRepoRoot(repoRootInput);

  const coachEngineCandidates = [
    path.join(repoRoot, "apps/server/src/arbitration/coach_engine_pro_v1.ts"),
    path.join(repoRoot, "apps/server/src/arbitration/coach_engine_v1.ts"),
    path.join(repoRoot, "apps/server/src/arbitration/coach_engine_v1.js"),
  ];

  for (const f of coachEngineCandidates) {
    if (!fs.existsSync(f)) continue;
    const mod: any = await tryImport(f);
    const build = mod?.buildCoachOverlayPatchV1;
    if (typeof build === "function") {
      // Try to load memory factory
      let createMemory = () => ({ lastSuggestionAt: 0 });
      const memFileTs = path.join(repoRoot, "apps/server/src/arbitration/session_memory_v1.ts");
      const memFileJs = path.join(repoRoot, "apps/server/src/arbitration/session_memory_v1.js");
      try {
        const mf = fs.existsSync(memFileTs) ? memFileTs : (fs.existsSync(memFileJs) ? memFileJs : null);
        if (mf) {
          const memMod: any = await tryImport(mf);
          if (typeof memMod?.createSessionMemory === "function") createMemory = () => memMod.createSessionMemory();
        }
      } catch {
        // ignore
      }

      return {
        kind: "coach_engine_v1",
        createMemory,
        run: async ({ tenantId, repId, sessionId, controls, memory, text }) => {
          const built: any = await build({ tenantId, repId, sessionId, controls, memory, text });
          const patch: CoachPatch | undefined =
            built?.rawPatch ?? built?.patch ?? built?.patchV1 ?? built?.overlayPatch ?? built?.patch_payload ?? built;
          const meta = built?.meta ?? built?.decision?.meta ?? patch?.guidance?.items?.[0]?.explanation?.meta ?? undefined;
          const suppressed = Boolean(built?.suppressed);
          return { suppressed, patch, meta, decision: built?.decision ?? built };
        }
      };
    }
  }

  // Fallback: older deterministic arbiter
  const arbCandidates = [
    path.join(repoRoot, "apps/server/src/arbitration/arbitration_v1.ts"),
    path.join(repoRoot, "apps/server/src/arbitration/arbitration_v1.js"),
  ];

  for (const f of arbCandidates) {
    if (!fs.existsSync(f)) continue;
    const mod: any = await tryImport(f);
    const arb = mod?.arbitrateV1;
    if (typeof arb === "function") {
      return {
        kind: "arbitration_v1_fallback",
        createMemory: () => ({ lastSuggestionAt: 0 }),
        run: async ({ controls, text }) => {
          const decision: any = arb({ text, controls, domainKeywords: ["security","soc2","crm","integration","pricing","roi"] });
          const first: any = Array.isArray(decision?.items) ? decision.items[0] : null;
          const suggestionText = (first?.suggestedText ?? first?.text ?? "").toString();
          const items: GuidanceItem[] = Array.isArray(decision?.items) ? decision.items : [];
          const patch: CoachPatch = {
            text: suggestionText || "Ask a clarifying question and reflect their concern.",
            guidance: { items }
          };
          return { suppressed: false, patch, meta: (first?.explanation?.meta ?? undefined), decision };
        }
      };
    }
  }

  // Helpful failure message
  const checked = [...coachEngineCandidates, ...arbCandidates].map((p) => `- ${p} (${fs.existsSync(p) ? "FOUND" : "missing"})`).join("\n");
  throw new Error(
    `No engine found.\nrepoRoot=${repoRoot}\nChecked:\n${checked}\n`
  );
}
