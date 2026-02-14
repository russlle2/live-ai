import fs from "fs";
import path from "path";

type Fact = { id: string; text: string; tags: string[] };

const AUTOGEN_FACTS_V3: Fact[] = [
  {
    id: "stakeholder_approve_01",
    text: "If someone says a CFO/finance 'signs off', the safe next move is: ask what approval criteria they use (ROI, risk, budget cycle), and offer a 1-page summary + a short finance call.",
    tags: ["stakeholder", "cfo", "approval", "roi", "procurement"]
  },
  {
    id: "procurement_legal_01",
    text: "Procurement/legal review usually needs: security overview, data flow diagram, retention policy, DPA/SOC2 reports, and a clear implementation timeline. Offer a checklist and a technical follow-up.",
    tags: ["procurement", "legal", "security", "soc2", "dpa", "timeline"]
  },
  {
    id: "timeline_urgency_01",
    text: "When urgency shows up ('deciding this week', 'go live next week'), clarify the decision date + required steps (security, legal, procurement, integration), then propose the fastest verification path.",
    tags: ["timeline", "urgency", "next_steps", "implementation"]
  },
  {
    id: "short_version_01",
    text: "If asked for a 'short version', respond in 1 sentence: outcome + why it works + next step. Example: 'We coach reps live with safe suggestions; teams close faster and stay consistent; want a 10-minute technical check on integrations?'",
    tags: ["style", "short", "value", "next_steps"]
  },
  {
    id: "nontechnical_01",
    text: "If asked to explain non-technically: use plain language + a concrete example (what happens during a call) + 1 benefit (fewer stalls, faster next steps). Avoid jargon unless asked.",
    tags: ["style", "nontechnical", "example", "value"]
  },
  {
    id: "offtopic_reframe_01",
    text: "If the buyer asks something off-topic (e.g., Florida weather), do not hallucinate. Say: 'Happy to, but to keep this useful—are you evaluating integration depth, security, or ROI?' Then answer within that frame.",
    tags: ["off_topic", "reframe", "clarify", "robustness"]
  }
];

function isFactArray(x: any): x is Fact[] {
  return Array.isArray(x) && x.length >= 0 && (x.length === 0 || (typeof x[0]?.id === "string" && typeof x[0]?.text === "string" && Array.isArray(x[0]?.tags)));
}

function walk(dir: string, maxFiles = 2000): string[] {
  const out: string[] = [];
  const q: string[] = [dir];
  while (q.length) {
    const d = q.shift()!;
    let ents: fs.Dirent[] = [];
    try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { continue; }
    for (const e of ents) {
      if (e.name === "node_modules" || e.name.startsWith(".")) continue;
      const full = path.join(d, e.name);
      if (e.isDirectory()) q.push(full);
      else out.push(full);
      if (out.length >= maxFiles) return out;
    }
  }
  return out;
}

export function autopatchProductPackFactsV3(repoRoot: string, packDirAbs: string) {
  const files = walk(packDirAbs).filter(f => f.endsWith(".json"));
  const candidates = files
    .filter(f => /facts/i.test(path.basename(f)))
    .slice(0, 200); // bound

  let best: { file: string; facts: Fact[] } | null = null;

  for (const f of candidates) {
    try {
      const raw = fs.readFileSync(f, "utf8");
      const parsed = JSON.parse(raw);
      if (!isFactArray(parsed)) continue;
      if (!best || parsed.length > best.facts.length) best = { file: f, facts: parsed };
    } catch {
      continue;
    }
  }

  if (!best) {
    return { ok: false as const, reason: "no_facts_json_found", checked: candidates.length, packDirAbs };
  }

  const existingIds = new Set(best.facts.map(x => x.id));
  const toAdd = AUTOGEN_FACTS_V3.filter(f => !existingIds.has(f.id));

  if (toAdd.length === 0) {
    return { ok: true as const, changed: false, file: best.file, added: 0 };
  }

  const next = best.facts.concat(toAdd);
  const backup = `${best.file}.bak.${Date.now()}`;

  fs.copyFileSync(best.file, backup);
  fs.writeFileSync(best.file, JSON.stringify(next, null, 2) + "\n");

  return { ok: true as const, changed: true, file: best.file, backup, added: toAdd.length, repoRoot };
}
