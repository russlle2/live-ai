import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { GoogleMemorySync } from "./sync.js";
import type { ExtractedMemoryFact, MemoryFactExtractor, SourceDocument } from "./types.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

describe("automatic Google memory sync", () => {
  it("drains cached sources into the memory ingestor once using stable IDs", async () => {
    const storageDir = await fs.mkdtemp(path.join(os.tmpdir(), "live-rhetoric-google-sync-"));
    temporaryDirectories.push(storageDir);
    await fs.writeFile(path.join(storageDir, "google-oauth-token.json"), JSON.stringify({
      accessToken: "test-access-token",
      refreshToken: "test-refresh-token",
      expiresAt: Date.parse("2030-01-01T00:00:00.000Z"),
      tokenType: "Bearer",
      scopes: [
        "https://www.googleapis.com/auth/gmail.readonly",
        "https://www.googleapis.com/auth/drive.readonly"
      ],
      updatedAt: "2026-07-13T00:00:00.000Z"
    }), { mode: 0o600 });

    const fetchMock = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/revoke")) {
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
        });
      }
      let body: unknown;
      if (url.pathname.endsWith("/profile")) body = { historyId: "gmail-1", emailAddress: "owner@example.com" };
      else if (url.pathname.endsWith("/messages")) body = { messages: [] };
      else if (url.pathname.endsWith("/history")) body = { history: [], historyId: "gmail-1" };
      else if (url.pathname.endsWith("/changes/startPageToken")) body = { startPageToken: "drive-1" };
      else if (url.pathname.endsWith("/files")) body = { files: [] };
      else if (url.pathname.endsWith("/changes")) body = { changes: [], newStartPageToken: "drive-2" };
      else return new Response(JSON.stringify({ error: { message: `Unexpected URL ${url}` } }), { status: 404 });
      return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;

    let extractionCalls = 0;
    const extractor: MemoryFactExtractor = {
      extract: async () => {
        extractionCalls += 1;
        return [{
          fact: "Built and delivered a client website.",
          category: "project",
          keywords: ["website"],
          confidence: 0.95,
          sensitivity: "normal",
          temporality: "historical",
          reviewFlags: []
        }];
      }
    };
    const ingested: ExtractedMemoryFact[][] = [];
    const sync = new GoogleMemorySync({
      clientId: "client-id",
      clientSecret: "client-secret",
      redirectUri: "http://localhost/callback",
      storageDir,
      storageEncryptionKey: "test-google-storage-encryption-key-32-plus",
      batchSize: 5,
      maxPagesPerRun: 2,
      maxExtractionsPerRun: 1,
      dailyExtractionBudget: 1,
      requestTimeoutMs: 100,
      fetch: fetchMock,
      now: () => new Date("2026-07-13T12:00:00.000Z")
    }, extractor, async (facts) => { ingested.push(facts); });
    const source: SourceDocument = {
      sourceType: "drive",
      sourceRef: "drive:portfolio",
      externalId: "portfolio",
      title: "Portfolio notes",
      timestamp: "2026-07-01T00:00:00.000Z",
      mimeType: "text/plain",
      text: "Built and delivered a client website.",
      contentHash: "c".repeat(64),
      sensitivity: "normal",
      reviewFlags: []
    };
    await sync.cache.upsert(source);

    const first = await sync.runOnce();
    await sync.cache.upsert({
      ...source,
      sourceRef: "drive:second",
      externalId: "second",
      title: "Second notes",
      text: "A second pending source.",
      contentHash: "d".repeat(64)
    });
    const second = await sync.runOnce();
    expect(first.extractedDocuments).toBe(1);
    expect(first.ingestedFacts).toBe(1);
    expect(second.extractedDocuments).toBe(0);
    expect(extractionCalls).toBe(1);
    await expect(sync.status()).resolves.toMatchObject({
      pendingExtraction: 1,
      extractionBudget: { day: "2026-07-13", used: 1, dailyLimit: 1, perRunLimit: 1 }
    });
    expect(ingested).toHaveLength(1);
    expect(ingested[0]?.[0]?.source).toMatchObject({ type: "drive", ref: "drive:portfolio" });
    const migratedToken = await fs.readFile(path.join(storageDir, "google-oauth-token.json"), "utf8");
    expect(migratedToken).toContain("private_encrypted_json_v1");
    expect(migratedToken).not.toContain("test-refresh-token");

    await expect(sync.purgeLocalData()).resolves.toEqual({
      removedSources: 2,
      providerRevoked: false,
      localCleanupComplete: true,
      warnings: ["provider_revocation_network_failed"]
    });
    expect(ingested.at(-1)).toEqual([]);
    expect(Object.keys((await sync.cache.read()).sources)).toHaveLength(0);
    await expect(sync.oauth.status()).resolves.toMatchObject({ authorized: false });
    sync.stopBackgroundSync();
  });
});
