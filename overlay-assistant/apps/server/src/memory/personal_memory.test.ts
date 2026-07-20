import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CONFIG } from "../config.js";
import type { MemoryFact } from "./personal_memory.js";
import {
  appendSessionTurn,
  clearMemoryFile,
  formatMemoryContext,
  rankMemoryFacts,
  readMemoryFile,
  readSessionTurns,
  removeGoogleSourceFactsForSource,
  searchSessionTurns,
  upsertMemoryFacts
} from "./personal_memory.js";

const originalMemoryPath = CONFIG.personalMemoryPath;
const originalSessionLogDir = CONFIG.sessionLogDir;
const originalPrivateStorageKey = CONFIG.privateStorageEncryptionKey;
const temporaryDirectories: string[] = [];

afterEach(async () => {
  CONFIG.personalMemoryPath = originalMemoryPath;
  CONFIG.sessionLogDir = originalSessionLogDir;
  CONFIG.privateStorageEncryptionKey = originalPrivateStorageKey;
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    fs.rm(directory, { recursive: true, force: true })
  ));
});

function fact(overrides: Partial<MemoryFact> & Pick<MemoryFact, "id" | "category" | "fact">): MemoryFact {
  return {
    keywords: [],
    source: { type: "manual" },
    confidence: 0.8,
    sensitivity: "normal",
    temporality: "durable",
    userVerified: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides
  };
}

describe("personal memory retrieval", () => {
  it("encrypts the personal evidence bank without changing retrieval semantics", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "live-rhetoric-memory-encrypted-"));
    temporaryDirectories.push(directory);
    CONFIG.personalMemoryPath = path.join(directory, "personal-memory.json");
    CONFIG.privateStorageEncryptionKey = "test-personal-memory-key-at-least-32-characters";
    await upsertMemoryFacts([{
      id: "private-fact",
      category: "preference",
      fact: "Prefers concise and direct answers.",
      keywords: ["concise"],
      source: { type: "manual" },
      confidence: 0.9,
      sensitivity: "normal",
      temporality: "durable",
      userVerified: true
    }]);

    const raw = await fs.readFile(CONFIG.personalMemoryPath, "utf8");
    expect(raw).toContain("private_encrypted_json_v1");
    expect(raw).not.toContain("Prefers concise and direct answers");
    expect((await readMemoryFile()).facts[0]?.id).toBe("private-fact");
  });

  it("ranks relevant, verified evidence first", () => {
    const result = rankMemoryFacts([
      fact({ id: "generic", category: "preference", fact: "Prefers concise answers." }),
      fact({
        id: "support",
        category: "skills",
        fact: "Troubleshot a customer website delivery issue.",
        keywords: ["support", "website", "troubleshooting"],
        confidence: 0.95,
        userVerified: true
      })
    ], {
      query: "How do you troubleshoot a website support problem?",
      profile: { mode: "it_support", targetRole: "Help desk technician" }
    });

    expect(result[0]?.id).toBe("support");
  });

  it("never retrieves restricted evidence for live coaching", () => {
    const result = rankMemoryFacts([
      fact({
        id: "restricted",
        category: "story",
        fact: "A private story matching the exact interview query.",
        keywords: ["interview", "query"],
        sensitivity: "restricted",
        confidence: 1,
        userVerified: true
      }),
      fact({ id: "safe", category: "skills", fact: "Communicates clearly." })
    ], {
      query: "interview query",
      profile: { mode: "interview" }
    });

    expect(result.map((item) => item.id)).toEqual(["safe"]);
  });

  it("does not surface an expired fact", () => {
    const result = rankMemoryFacts([
      fact({
        id: "expired",
        category: "availability",
        fact: "Available for a shift that already ended.",
        validTo: "2020-01-01T00:00:00.000Z"
      }),
      fact({ id: "current", category: "skills", fact: "Communicates clearly." })
    ], {
      query: "availability",
      profile: { mode: "interview" }
    });

    expect(result.map((item) => item.id)).toEqual(["current"]);
  });

  it("stores but does not auto-retrieve unverified conflict/review facts", () => {
    const result = rankMemoryFacts([
      fact({
        id: "conflicted",
        category: "employment",
        fact: "A source-specific title that conflicts with another source.",
        keywords: ["support", "review:needs_review", "review:conflicts_with:google_other"],
        confidence: 0.95
      }),
      fact({ id: "safe", category: "skills", fact: "Handles support conversations calmly." })
    ], {
      query: "support title",
      profile: { mode: "interview" }
    });

    expect(result.map((item) => item.id)).toEqual(["safe"]);
  });

  it("allows review-gated local context in permissive personal mode without exposing restricted facts", () => {
    const result = rankMemoryFacts([
      fact({
        id: "review-context",
        category: "constraint",
        fact: "A scheduling constraint that may matter to this conversation.",
        keywords: ["schedule", "review:needs_review"],
        sensitivity: "sensitive",
        userVerified: false
      }),
      fact({
        id: "restricted",
        category: "constraint",
        fact: "A restricted fact matching schedule.",
        keywords: ["schedule"],
        sensitivity: "restricted",
        userVerified: true
      })
    ], {
      query: "schedule constraint",
      profile: { mode: "general" },
      policy: "personal_permissive"
    });

    expect(result.map((item) => item.id)).toEqual(["review-context"]);
  });

  it("labels review-gated evidence explicitly in model context", () => {
    const context = formatMemoryContext([
      fact({
        id: "review-context",
        category: "constraint",
        fact: "A tentative scheduling constraint.",
        keywords: ["review:needs_review"],
        userVerified: false
      })
    ]);
    expect(context).toContain("review-required");
  });

  it("only retrieves sensitive facts after verification and sensitive review are complete", () => {
    const result = rankMemoryFacts([
      fact({
        id: "unverified-sensitive",
        category: "constraint",
        fact: "A sensitive scheduling constraint.",
        sensitivity: "sensitive"
      }),
      fact({
        id: "review-pending-sensitive",
        category: "constraint",
        fact: "A verified sensitive constraint still pending review.",
        sensitivity: "sensitive",
        userVerified: true,
        keywords: ["review:sensitive_review"]
      }),
      fact({
        id: "verified-sensitive",
        category: "constraint",
        fact: "A reviewed and verified sensitive scheduling constraint.",
        sensitivity: "sensitive",
        userVerified: true
      }),
      fact({
        id: "normal",
        category: "skills",
        fact: "Handles scheduling conversations clearly."
      })
    ], {
      query: "scheduling constraint",
      profile: { mode: "interview" }
    });

    expect(result.map((item) => item.id)).toEqual(expect.arrayContaining(["verified-sensitive", "normal"]));
    expect(result.map((item) => item.id)).not.toContain("unverified-sensitive");
    expect(result.map((item) => item.id)).not.toContain("review-pending-sensitive");
  });

  it("purges every fact derived from a deleted Google source, including legacy IDs", () => {
    const removal = removeGoogleSourceFactsForSource([
      fact({
        id: "google_current",
        category: "employment",
        fact: "Current source-backed role.",
        source: { type: "gmail", ref: "gmail:deleted" }
      }),
      fact({
        id: "legacy-import-id",
        category: "story",
        fact: "Legacy source-backed story.",
        source: { type: "gmail", ref: "gmail:deleted" },
        userVerified: true
      }),
      fact({
        id: "other-google-source",
        category: "skills",
        fact: "A fact from another source.",
        source: { type: "drive", ref: "drive:other" }
      }),
      fact({
        id: "manual",
        category: "skills",
        fact: "A manually entered fact.",
        source: { type: "manual", ref: "gmail:deleted" }
      })
    ], "gmail:deleted");

    expect(removal.removed).toBe(2);
    expect(removal.facts.map((item) => item.id)).toEqual(["other-google-source", "manual"]);
  });

  it("replaces corrupt memory during owner erasure without first parsing it", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "live-rhetoric-memory-purge-"));
    temporaryDirectories.push(directory);
    CONFIG.personalMemoryPath = path.join(directory, "personal-memory.json");
    CONFIG.privateStorageEncryptionKey = "test-memory-purge-key-at-least-32-characters";
    await fs.writeFile(CONFIG.personalMemoryPath, "{not valid json", { mode: 0o600 });
    const crashTemp = `${CONFIG.personalMemoryPath}.old-process.tmp`;
    await fs.writeFile(crashTemp, "private stale data", { mode: 0o600 });

    await expect(clearMemoryFile()).resolves.toEqual({
      removed: null,
      countKnown: false,
      removedTempFiles: 1
    });
    const after = await fs.readFile(CONFIG.personalMemoryPath, "utf8");
    expect(after).toContain("private_encrypted_json_v1");
    expect(after).not.toContain("not valid json");
    expect(await readMemoryFile()).toMatchObject({
      schema: "personal_memory_v1",
      facts: []
    });
    expect((await fs.stat(CONFIG.personalMemoryPath)).mode & 0o777).toBe(0o600);
    await expect(fs.stat(crashTemp)).rejects.toMatchObject({ code: "ENOENT" });
  });
});

describe("encrypted transcript archive", () => {
  it("retains transcript turns indefinitely without plaintext at rest", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "live-rhetoric-transcripts-"));
    temporaryDirectories.push(directory);
    CONFIG.sessionLogDir = directory;
    CONFIG.privateStorageEncryptionKey = "test-transcript-encryption-key-at-least-32-characters";

    await appendSessionTurn({
      sessionId: "encrypted-session",
      speaker: "lead",
      text: "A private client conversation detail.",
      at: "2026-07-20T18:00:00.000Z",
      mode: "general",
      captureProvenance: "dedicated_browser_tab",
      attributionConfidence: 1
    });

    const target = path.join(directory, "encrypted-session.jsonl");
    const raw = await fs.readFile(target, "utf8");
    expect(raw).toContain("private_encrypted_jsonl_record_v2");
    expect(raw).not.toContain("private client conversation detail");
    await expect(readSessionTurns("encrypted-session")).resolves.toEqual([
      expect.objectContaining({
        schema: "session_turn_v1",
        speaker: "lead",
        text: "A private client conversation detail."
      })
    ]);
  });

  it("searches decrypted archives locally with source-linked results", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "live-rhetoric-search-"));
    temporaryDirectories.push(directory);
    CONFIG.sessionLogDir = directory;
    CONFIG.privateStorageEncryptionKey = "test-transcript-search-key-at-least-32-characters";

    await appendSessionTurn({
      sessionId: "client-call",
      speaker: "lead",
      text: "The client decided that reliability is the main priority.",
      at: "2026-07-20T18:00:00.000Z",
      mode: "general"
    });
    await appendSessionTurn({
      sessionId: "interview",
      speaker: "lead",
      text: "The interviewer asked about conflict resolution.",
      at: "2026-07-20T19:00:00.000Z",
      mode: "interview"
    });

    await expect(searchSessionTurns({
      query: "client reliability priority",
      limit: 5
    })).resolves.toEqual([
      expect.objectContaining({
        sessionId: "client-call",
        speaker: "lead",
        score: expect.any(Number)
      })
    ]);
  });
});
