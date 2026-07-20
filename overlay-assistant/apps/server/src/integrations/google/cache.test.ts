import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { GoogleSourceCache, GoogleSourceCapacityError } from "./cache.js";
import type { ExtractedMemoryFact, SourceDocument } from "./types.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    fs.rm(directory, { recursive: true, force: true })
  ));
});

describe("Google source cache privacy", () => {
  it("sanitizes cached and extracted titles, then purges content and facts on deletion", async () => {
    const storageDir = await fs.mkdtemp(path.join(os.tmpdir(), "live-rhetoric-google-cache-"));
    temporaryDirectories.push(storageDir);
    const cache = new GoogleSourceCache(
      storageDir,
      () => new Date("2026-07-13T12:00:00.000Z")
    );
    const sourceSecret = "source-secret-987654";
    const factSecret = "fact-secret-987654";
    const document: SourceDocument = {
      sourceType: "drive",
      sourceRef: "drive:deleted",
      externalId: "deleted",
      title: `Password: ${sourceSecret}`,
      timestamp: "2026-07-01T00:00:00.000Z",
      mimeType: "text/plain",
      text: "Cached source body that must be purged.",
      contentHash: "c".repeat(64),
      sensitivity: "normal",
      reviewFlags: []
    };
    const fact: ExtractedMemoryFact = {
      id: "google_deleted_fact",
      fact: "Derived source fact that must be purged.",
      category: "skills",
      keywords: ["support"],
      confidence: 0.9,
      sensitivity: "normal",
      temporality: "historical",
      reviewFlags: [],
      source: {
        type: "drive",
        ref: "drive:deleted",
        title: `Password: ${factSecret}`
      },
      userVerified: false,
      sourceContentHash: document.contentHash
    };

    const upserted = await cache.upsert(document);
    await cache.markExtracted({
      sourceRef: document.sourceRef,
      contentHash: upserted.source.contentHash,
      facts: [fact]
    });
    const beforeDelete = (await cache.read()).sources[document.sourceRef];
    expect(beforeDelete?.title).not.toContain(sourceSecret);
    expect(beforeDelete?.extractedFacts[0]?.source.title).not.toContain(factSecret);
    expect(beforeDelete?.text).toBe("");

    await cache.markDeleted(document.sourceRef);

    const deleted = (await cache.read()).sources[document.sourceRef];
    expect(deleted).toBeUndefined();
    const rawCache = await fs.readFile(path.join(storageDir, "google-source-cache.json"), "utf8");
    expect(rawCache).not.toContain("Cached source body that must be purged.");
    expect(rawCache).not.toContain("Derived source fact that must be purged.");
    expect(rawCache).not.toContain(sourceSecret);
    expect(rawCache).not.toContain(factSecret);
  });

  it("invalidates old facts immediately when source content changes", async () => {
    const storageDir = await fs.mkdtemp(path.join(os.tmpdir(), "live-rhetoric-google-stale-"));
    temporaryDirectories.push(storageDir);
    const cache = new GoogleSourceCache(storageDir);
    const original: SourceDocument = {
      sourceType: "drive",
      sourceRef: "drive:changed",
      externalId: "changed",
      title: "Role notes",
      text: "The current role is support representative.",
      contentHash: "a".repeat(64),
      sensitivity: "normal",
      reviewFlags: []
    };
    const oldFact: ExtractedMemoryFact = {
      id: "google_old_role",
      fact: "The current role is support representative.",
      category: "employment",
      keywords: [],
      confidence: 0.9,
      sensitivity: "normal",
      temporality: "current",
      reviewFlags: [],
      source: { type: "drive", ref: original.sourceRef },
      userVerified: false,
      sourceContentHash: original.contentHash
    };
    await cache.upsert(original);
    await cache.markExtracted({
      sourceRef: original.sourceRef,
      contentHash: original.contentHash,
      facts: [oldFact]
    });
    const changed = {
      ...original,
      text: "The role note was removed.",
      contentHash: "b".repeat(64)
    };

    expect(await cache.needsInvalidation(changed)).toBe(true);
    await cache.upsert(changed);
    const stored = (await cache.read()).sources[original.sourceRef];
    expect(stored?.extractedFacts).toEqual([]);
    expect(stored?.extractedContentHash).toBeUndefined();
    expect(stored?.text).toBe(changed.text);
  });

  it("stops before an unbounded source-cache expansion", async () => {
    const storageDir = await fs.mkdtemp(path.join(os.tmpdir(), "live-rhetoric-google-capacity-"));
    temporaryDirectories.push(storageDir);
    const cache = new GoogleSourceCache(storageDir, () => new Date(), undefined, 1);
    const document: SourceDocument = {
      sourceType: "drive",
      sourceRef: "drive:first",
      externalId: "first",
      title: "First",
      text: "First source",
      contentHash: "a".repeat(64),
      sensitivity: "normal",
      reviewFlags: []
    };
    await cache.upsert(document);
    await expect(cache.upsert({
      ...document,
      sourceRef: "drive:second",
      externalId: "second",
      contentHash: "b".repeat(64)
    })).rejects.toBeInstanceOf(GoogleSourceCapacityError);
    expect(Object.keys((await cache.read()).sources)).toEqual(["drive:first"]);

    await cache.markDeleted("drive:first");
    await expect(cache.upsert({
      ...document,
      sourceRef: "drive:second",
      externalId: "second",
      contentHash: "b".repeat(64)
    })).resolves.toMatchObject({ changed: true });
    expect(Object.keys((await cache.read()).sources)).toEqual(["drive:second"]);
  });
});
