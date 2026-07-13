import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CONFIG } from "../config.js";
import type { MemoryFact } from "./personal_memory.js";
import { clearMemoryFile, rankMemoryFacts, removeGoogleSourceFactsForSource } from "./personal_memory.js";

const originalMemoryPath = CONFIG.personalMemoryPath;
const temporaryDirectories: string[] = [];

afterEach(async () => {
  CONFIG.personalMemoryPath = originalMemoryPath;
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
    await fs.writeFile(CONFIG.personalMemoryPath, "{not valid json", { mode: 0o600 });
    const crashTemp = `${CONFIG.personalMemoryPath}.old-process.tmp`;
    await fs.writeFile(crashTemp, "private stale data", { mode: 0o600 });

    await expect(clearMemoryFile()).resolves.toEqual({
      removed: null,
      countKnown: false,
      removedTempFiles: 1
    });
    const after = JSON.parse(await fs.readFile(CONFIG.personalMemoryPath, "utf8"));
    expect(after).toMatchObject({ schema: "personal_memory_v1", facts: [] });
    expect((await fs.stat(CONFIG.personalMemoryPath)).mode & 0o777).toBe(0o600);
    await expect(fs.stat(crashTemp)).rejects.toMatchObject({ code: "ENOENT" });
  });
});
