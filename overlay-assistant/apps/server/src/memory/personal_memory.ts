import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { ScenarioModeV1, SessionProfileV1 } from "@overlay-assistant/shared";
import { CONFIG } from "../config.js";
import { EncryptedJsonlArchiveV2 } from "../storage/encrypted_jsonl_archive_v2.js";

export const MemoryFactSchema = z.object({
  id: z.string().min(1),
  category: z.enum([
    "identity",
    "employment",
    "education",
    "skills",
    "achievement",
    "project",
    "preference",
    "constraint",
    "story",
    "communication_style",
    "availability",
    "other"
  ]),
  fact: z.string().min(2).max(4000),
  keywords: z.array(z.string().min(1).max(80)).max(40).default([]),
  source: z.object({
    type: z.enum(["gmail", "drive", "conversation", "manual", "system"]),
    ref: z.string().max(1000).optional(),
    timestamp: z.string().max(100).optional(),
    title: z.string().max(500).optional()
  }),
  confidence: z.number().min(0).max(1).default(0.8),
  sensitivity: z.enum(["normal", "sensitive", "restricted"]).default("normal"),
  temporality: z.enum(["durable", "current", "historical", "unknown"]).default("unknown"),
  userVerified: z.boolean().default(false),
  validFrom: z.string().optional(),
  validTo: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string()
});

export type MemoryFact = z.infer<typeof MemoryFactSchema>;
export const MemoryFactInputSchema = MemoryFactSchema
  .omit({ id: true, createdAt: true, updatedAt: true })
  .extend({ id: z.string().min(1).optional() });
export type MemoryFactInput = z.input<typeof MemoryFactInputSchema>;

const MemoryFileSchema = z.object({
  schema: z.literal("personal_memory_v1"),
  owner: z.string().default(CONFIG.personalMemoryOwner),
  generatedAt: z.string(),
  facts: z.array(MemoryFactSchema)
});

type MemoryFile = z.infer<typeof MemoryFileSchema>;
let writeQueue = Promise.resolve();

const SessionTurnSchema = z.object({
  schema: z.literal("session_turn_v1"),
  sessionId: z.string().min(1).max(240),
  speaker: z.enum(["rep", "lead", "unknown"]),
  text: z.string().min(1).max(20_000),
  at: z.string().max(100),
  mode: z.enum([
    "interview",
    "insurance_sales",
    "it_support",
    "inbound_service",
    "negotiation",
    "general"
  ]),
  captureProvenance: z.string().max(100).optional(),
  attributionConfidence: z.number().min(0).max(1).optional(),
  attributionReason: z.string().max(160).optional()
}).strict();

export type SessionTurn = z.infer<typeof SessionTurnSchema>;
const sessionArchives = new Map<
  string,
  { encryptionKey: string; archive: EncryptedJsonlArchiveV2<SessionTurn> }
>();

function emptyMemory(): MemoryFile {
  return {
    schema: "personal_memory_v1",
    owner: CONFIG.personalMemoryOwner,
    generatedAt: new Date().toISOString(),
    facts: []
  };
}

async function ensureParent(): Promise<void> {
  const directory = path.dirname(CONFIG.personalMemoryPath);
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  await fs.chmod(directory, 0o700);
}

export async function readMemoryFile(): Promise<MemoryFile> {
  try {
    const raw = await fs.readFile(CONFIG.personalMemoryPath, "utf8");
    return MemoryFileSchema.parse(JSON.parse(raw));
  } catch (error: any) {
    if (error?.code === "ENOENT") return emptyMemory();
    throw error;
  }
}

async function writeMemoryFile(memory: MemoryFile): Promise<void> {
  await ensureParent();
  const next = { ...memory, generatedAt: new Date().toISOString() };
  const tempPath = `${CONFIG.personalMemoryPath}.${process.pid}.tmp`;
  try {
    await fs.writeFile(tempPath, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
    await fs.rename(tempPath, CONFIG.personalMemoryPath);
    await fs.chmod(CONFIG.personalMemoryPath, 0o600);
  } catch (error) {
    await fs.unlink(tempPath).catch(() => undefined);
    throw error;
  }
}

async function clearMemoryTempFiles(): Promise<number> {
  const directory = path.dirname(CONFIG.personalMemoryPath);
  const prefix = `${path.basename(CONFIG.personalMemoryPath)}.`;
  try {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    const matches = entries.filter((entry) =>
      entry.isFile() && entry.name.startsWith(prefix) && entry.name.endsWith(".tmp")
    );
    await Promise.all(matches.map((entry) => fs.unlink(path.join(directory, entry.name))));
    return matches.length;
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return 0;
    throw error;
  }
}

export async function upsertMemoryFacts(inputs: MemoryFactInput[]): Promise<{ inserted: number; updated: number; total: number }> {
  let result = { inserted: 0, updated: 0, total: 0 };
  writeQueue = writeQueue.catch(() => {}).then(async () => {
    const memory = await readMemoryFile();
    const byId = new Map(memory.facts.map((fact) => [fact.id, fact]));
    const now = new Date().toISOString();

    for (const rawInput of inputs) {
      const input = MemoryFactInputSchema.parse(rawInput);
      const id = input.id || randomUUID();
      const previous = byId.get(id);
      const next = MemoryFactSchema.parse({
        ...input,
        id,
        createdAt: previous?.createdAt ?? now,
        updatedAt: now
      });
      byId.set(id, next);
      if (previous) result.updated += 1;
      else result.inserted += 1;
    }

    memory.facts = [...byId.values()].sort((a, b) => a.category.localeCompare(b.category) || a.id.localeCompare(b.id));
    result.total = memory.facts.length;
    await writeMemoryFile(memory);
  });
  await writeQueue;
  return result;
}

export async function deleteMemoryFact(id: string): Promise<{ removed: boolean; total: number }> {
  let result = { removed: false, total: 0 };
  writeQueue = writeQueue.catch(() => {}).then(async () => {
    const memory = await readMemoryFile();
    const before = memory.facts.length;
    memory.facts = memory.facts.filter((fact) => fact.id !== id);
    result = { removed: memory.facts.length !== before, total: memory.facts.length };
    if (result.removed) await writeMemoryFile(memory);
  });
  await writeQueue;
  return result;
}

export async function clearMemoryFile(): Promise<{ removed: number | null; countKnown: boolean; removedTempFiles: number }> {
  let result: { removed: number | null; countKnown: boolean; removedTempFiles: number } = {
    removed: 0,
    countKnown: true,
    removedTempFiles: 0
  };
  writeQueue = writeQueue.catch(() => {}).then(async () => {
    try {
      const memory = await readMemoryFile();
      result = { removed: memory.facts.length, countKnown: true, removedTempFiles: 0 };
    } catch {
      // Erasure must not depend on successfully parsing the data being erased.
      result = { removed: null, countKnown: false, removedTempFiles: 0 };
    }
    await writeMemoryFile(emptyMemory());
    result.removedTempFiles = await clearMemoryTempFiles();
  });
  await writeQueue;
  return result;
}

export async function clearGoogleMemoryFacts(): Promise<{ removed: number; total: number }> {
  let result = { removed: 0, total: 0 };
  writeQueue = writeQueue.catch(() => {}).then(async () => {
    const memory = await readMemoryFile();
    const retained = memory.facts.filter((fact) =>
      fact.source.type !== "gmail" && fact.source.type !== "drive"
    );
    result = { removed: memory.facts.length - retained.length, total: retained.length };
    memory.facts = retained;
    if (result.removed > 0) await writeMemoryFile(memory);
  });
  await writeQueue;
  return result;
}

export async function clearSessionLogs(): Promise<{ removedFiles: number }> {
  sessionArchives.clear();
  let entries: Array<{ name: string; isFile: () => boolean }> = [];
  try {
    entries = await fs.readdir(CONFIG.sessionLogDir, { withFileTypes: true });
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return { removedFiles: 0 };
    throw error;
  }
  await fs.rm(CONFIG.sessionLogDir, { recursive: true, force: true });
  await fs.mkdir(CONFIG.sessionLogDir, { recursive: true, mode: 0o700 });
  await fs.chmod(CONFIG.sessionLogDir, 0o700);
  return { removedFiles: entries.filter((entry) => entry.isFile()).length };
}

/**
 * Reconcile facts produced by the automatic Google worker for one source.
 * Facts tied to other sources and manually entered facts are preserved. Every
 * Gmail/Drive fact tied to this exact source is replaced or removed so deleted
 * source data cannot survive under a legacy or previously curated identifier.
 */
export async function replaceGoogleSourceFacts(
  sourceRef: string,
  inputs: MemoryFactInput[]
): Promise<{ inserted: number; updated: number; removed: number; total: number }> {
  let result = { inserted: 0, updated: 0, removed: 0, total: 0 };
  writeQueue = writeQueue.catch(() => {}).then(async () => {
    const memory = await readMemoryFile();
    const previousById = new Map(memory.facts.map((fact) => [fact.id, fact]));
    const removal = removeGoogleSourceFactsForSource(memory.facts, sourceRef);
    const retained = removal.facts;
    result.removed = removal.removed;
    const byId = new Map(retained.map((fact) => [fact.id, fact]));
    const now = new Date().toISOString();

    for (const rawInput of inputs) {
      const input = MemoryFactInputSchema.parse(rawInput);
      if (
        !input.id?.startsWith("google_") ||
        input.source.ref !== sourceRef ||
        (input.source.type !== "gmail" && input.source.type !== "drive")
      ) {
        throw new Error("google_source_fact_mismatch");
      }
      const previous = previousById.get(input.id);
      const next = MemoryFactSchema.parse({
        ...input,
        createdAt: previous?.createdAt ?? now,
        updatedAt: now
      });
      byId.set(next.id, next);
      if (previous) {
        result.updated += 1;
        result.removed -= 1;
      } else {
        result.inserted += 1;
      }
    }

    memory.facts = [...byId.values()].sort((a, b) => a.category.localeCompare(b.category) || a.id.localeCompare(b.id));
    result.total = memory.facts.length;
    await writeMemoryFile(memory);
  });
  await writeQueue;
  return result;
}

/** Remove every fact derived from an exact Google source, including legacy IDs. */
export function removeGoogleSourceFactsForSource(
  facts: MemoryFact[],
  sourceRef: string
): { facts: MemoryFact[]; removed: number } {
  let removed = 0;
  const retained = facts.filter((fact) => {
    const sourceDerived =
      fact.source.ref === sourceRef &&
      (fact.source.type === "gmail" || fact.source.type === "drive");
    if (sourceDerived) removed += 1;
    return !sourceDerived;
  });
  return { facts: retained, removed };
}

function terms(value: string): Set<string> {
  return new Set(
    value
      .toLowerCase()
      .replace(/[^a-z0-9+#.\-]+/g, " ")
      .split(/\s+/)
      .filter((token) => token.length > 2)
  );
}

const MODE_CATEGORY_BOOST: Record<ScenarioModeV1, Set<MemoryFact["category"]>> = {
  interview: new Set(["employment", "education", "skills", "achievement", "story", "constraint", "communication_style"]),
  insurance_sales: new Set(["employment", "skills", "achievement", "story", "communication_style"]),
  it_support: new Set(["skills", "project", "employment", "education", "story", "communication_style"]),
  inbound_service: new Set(["employment", "skills", "achievement", "communication_style", "story"]),
  negotiation: new Set(["skills", "achievement", "constraint", "communication_style", "story"]),
  general: new Set(["identity", "preference", "constraint", "communication_style"])
};

export async function retrieveMemoryFacts(params: {
  query: string;
  profile: SessionProfileV1;
  limit?: number;
}): Promise<MemoryFact[]> {
  const memory = await readMemoryFile();
  return rankMemoryFacts(memory.facts, params);
}

/**
 * Pure ranking function kept separate from file I/O so retrieval behavior can be
 * tested without opening or mutating the user's private memory file.
 */
export function rankMemoryFacts(
  facts: MemoryFact[],
  params: { query: string; profile: SessionProfileV1; limit?: number }
): MemoryFact[] {
  const queryTerms = terms([
    params.query,
    params.profile.targetRole,
    params.profile.company,
    params.profile.goal,
    params.profile.preContext
  ].filter(Boolean).join(" "));
  const boosted = MODE_CATEGORY_BOOST[params.profile.mode] ?? MODE_CATEGORY_BOOST.general;
  const now = Date.now();

  return facts
    .filter((fact) => {
      if (fact.sensitivity === "restricted") return false;
      const requiresReview = fact.keywords.some((keyword) =>
        /^review:(?:needs_review|low_confidence|sensitive_review|conflicts_with:)/i.test(keyword)
      );
      if (fact.sensitivity === "sensitive" && (!fact.userVerified || requiresReview)) return false;
      if (!fact.userVerified && requiresReview) return false;
      const validFrom = fact.validFrom ? Date.parse(fact.validFrom) : Number.NaN;
      const validTo = fact.validTo ? Date.parse(fact.validTo) : Number.NaN;
      if (Number.isFinite(validFrom) && validFrom > now) return false;
      if (Number.isFinite(validTo) && validTo < now) return false;
      return true;
    })
    .map((fact) => {
      const factTerms = terms(`${fact.category} ${fact.fact} ${fact.keywords.join(" ")}`);
      let overlap = 0;
      for (const term of queryTerms) if (factTerms.has(term)) overlap += 1;
      const score =
        overlap * 4 +
        (boosted.has(fact.category) ? 3 : 0) +
        (fact.userVerified ? 3 : 0) +
        fact.confidence * 2 +
        (fact.category === "identity" ? 0.5 : 0);
      return { fact, score };
    })
    .sort((a, b) => b.score - a.score || b.fact.confidence - a.fact.confidence)
    .slice(0, params.limit ?? CONFIG.memoryMaxPromptFacts)
    .map(({ fact }) => fact);
}

export function formatMemoryContext(facts: MemoryFact[]): string {
  if (facts.length === 0) return "No relevant personal evidence was retrieved.";
  return facts
    .map((fact) => {
      const sourceRef = fact.source.ref?.replace(/\s+/g, " ").slice(0, 160);
      const source = `${fact.source.type}${sourceRef ? `:${sourceRef}` : ""}`;
      const compactFact = fact.fact.replace(/\s+/g, " ").trim().slice(0, 1200);
      return `- [${fact.id}] ${compactFact} (source ${source}; confidence ${fact.confidence.toFixed(2)}${fact.userVerified ? ", user-verified" : ", not user-verified"})`;
    })
    .join("\n");
}

export async function getMemoryStats(): Promise<Record<string, unknown>> {
  const memory = await readMemoryFile();
  const byCategory: Record<string, number> = {};
  const bySource: Record<string, number> = {};
  for (const fact of memory.facts) {
    byCategory[fact.category] = (byCategory[fact.category] ?? 0) + 1;
    bySource[fact.source.type] = (bySource[fact.source.type] ?? 0) + 1;
  }
  return {
    total: memory.facts.length,
    userVerified: memory.facts.filter((fact) => fact.userVerified).length,
    byCategory,
    bySource,
    generatedAt: memory.generatedAt
  };
}

export async function appendSessionTurn(params: {
  sessionId: string;
  speaker: string;
  text: string;
  at: string;
  mode: ScenarioModeV1;
  captureProvenance?: string;
  attributionConfidence?: number;
  attributionReason?: string;
}): Promise<void> {
  const turn = SessionTurnSchema.parse({ schema: "session_turn_v1", ...params });
  await sessionArchive(params.sessionId).append(turn);
}

export async function readSessionTurns(sessionId: string): Promise<SessionTurn[]> {
  return sessionArchive(sessionId).readAll();
}

export type SessionTurnSearchResult = SessionTurn & { score: number };

export async function searchSessionTurns(params: {
  query: string;
  limit?: number;
}): Promise<SessionTurnSearchResult[]> {
  const query = params.query.normalize("NFKC").trim().slice(0, 500);
  const queryTerms = terms(query);
  if (queryTerms.size === 0) return [];
  const limit = Math.max(1, Math.min(params.limit ?? 20, 100));
  let entries: Array<{ name: string; isFile: () => boolean }>;
  try {
    entries = await fs.readdir(CONFIG.sessionLogDir, { withFileTypes: true });
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return [];
    throw error;
  }

  const ignored = new Set([
    "delivery_style_observations.jsonl",
    "style_feature_observations_v2.jsonl"
  ]);
  const results: SessionTurnSearchResult[] = [];
  for (const entry of entries
    .filter((candidate) =>
      candidate.isFile() &&
      candidate.name.endsWith(".jsonl") &&
      !ignored.has(candidate.name)
    )
    .sort((left, right) => left.name.localeCompare(right.name))) {
    const target = path.join(CONFIG.sessionLogDir, entry.name);
    const turns = await sessionArchiveForPath(target).readAll();
    for (const turn of turns) {
      const turnTerms = terms(turn.text);
      const matched = [...queryTerms].filter((term) => turnTerms.has(term)).length;
      if (matched === 0) continue;
      const phraseBonus = turn.text.toLowerCase().includes(query.toLowerCase()) ? 5 : 0;
      results.push({
        ...turn,
        score: matched * 10 + phraseBonus
      });
    }
  }
  return results
    .sort((left, right) =>
      right.score - left.score ||
      right.at.localeCompare(left.at) ||
      left.sessionId.localeCompare(right.sessionId)
    )
    .slice(0, limit);
}

function sessionArchive(sessionId: string): EncryptedJsonlArchiveV2<SessionTurn> {
  const safeId = sessionId.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 120);
  if (!safeId) throw new TypeError("sessionId is required");
  const target = path.join(CONFIG.sessionLogDir, `${safeId}.jsonl`);
  return sessionArchiveForPath(target);
}

function sessionArchiveForPath(
  target: string
): EncryptedJsonlArchiveV2<SessionTurn> {
  const cached = sessionArchives.get(target);
  if (
    cached &&
    cached.encryptionKey === CONFIG.privateStorageEncryptionKey
  ) {
    return cached.archive;
  }
  const archive = new EncryptedJsonlArchiveV2<SessionTurn>({
    filePath: target,
    encryptionKey: CONFIG.privateStorageEncryptionKey,
    validate: (value) => SessionTurnSchema.parse(value)
  });
  sessionArchives.set(target, {
    encryptionKey: CONFIG.privateStorageEncryptionKey,
    archive
  });
  return archive;
}
