import path from "node:path";
import {
  SourceCacheSchema,
  type CachedSource,
  type ExtractedMemoryFact,
  type SourceCacheFile,
  type SourceDocument
} from "./types.js";
import { PrivateJsonStore } from "./private_store.js";
import { sanitizeGoogleSourceTitle } from "./privacy.js";

export class GoogleSourceCapacityError extends Error {
  constructor(readonly limit: number) {
    super(`Google source cache reached its configured limit of ${limit}`);
    this.name = "GoogleSourceCapacityError";
  }
}

export class GoogleSourceCache {
  private readonly store: PrivateJsonStore<SourceCacheFile>;
  private queue = Promise.resolve();

  constructor(
    storageDir: string,
    private readonly now: () => Date = () => new Date(),
    storageEncryptionKey?: string,
    readonly maxSources = 1000
  ) {
    this.store = new PrivateJsonStore(
      path.join(storageDir, "google-source-cache.json"),
      SourceCacheSchema,
      () => ({
        schema: "google_source_cache_v1",
        updatedAt: this.now().toISOString(),
        sources: {}
      }),
      storageEncryptionKey
    );
  }

  async upsert(document: SourceDocument): Promise<{ changed: boolean; source: CachedSource }> {
    let result!: { changed: boolean; source: CachedSource };
    await this.mutate((cache) => {
      const safeTitle = sanitizeGoogleSourceTitle(
        document.title,
        document.sourceType === "gmail" ? "Untitled Gmail message" : "Untitled Drive file"
      );
      const safeDocument: SourceDocument = {
        ...document,
        title: safeTitle.text,
        reviewFlags: [...new Set([
          ...document.reviewFlags,
          ...safeTitle.exclusions.map((value) => `excluded:${value}`)
        ])].sort()
      };
      const previous = cache.sources[document.sourceRef];
      if (!previous && Object.keys(cache.sources).length >= this.maxSources) {
        throw new GoogleSourceCapacityError(this.maxSources);
      }
      const now = this.now().toISOString();
      const changed = !previous || previous.contentHash !== safeDocument.contentHash || Boolean(previous.deletedAt);
      const source: CachedSource = {
        ...safeDocument,
        // Full source text is needed only while extraction is pending. A
        // repeated unchanged sync must not restore a body already minimized.
        text: changed || previous?.extractedContentHash !== safeDocument.contentHash
          ? safeDocument.text
          : "",
        firstSeenAt: previous?.firstSeenAt ?? now,
        lastSeenAt: now,
        extractedContentHash: changed ? undefined : previous?.extractedContentHash,
        extractedFacts: changed ? [] : previous?.extractedFacts ?? [],
        extractionReviewFlags: changed ? [] : previous?.extractionReviewFlags ?? [],
        deletedAt: undefined
      };
      cache.sources[document.sourceRef] = source;
      result = { changed, source };
    });
    return result;
  }

  /** True before a changed source replaces its previously extracted facts. */
  async needsInvalidation(document: SourceDocument): Promise<boolean> {
    const cache = await this.store.read();
    const previous = cache.sources[document.sourceRef];
    return Boolean(
      previous &&
      !previous.deletedAt &&
      previous.contentHash !== document.contentHash &&
      (previous.extractedFacts.length > 0 || previous.extractedContentHash)
    );
  }

  async markDeleted(sourceRef: string): Promise<void> {
    await this.mutate((cache) => {
      delete cache.sources[sourceRef];
    });
  }

  async pending(limit: number): Promise<CachedSource[]> {
    const cache = await this.store.read();
    return Object.values(cache.sources)
      .filter((source) => !source.deletedAt && source.extractedContentHash !== source.contentHash)
      .sort((a, b) => a.lastSeenAt.localeCompare(b.lastSeenAt))
      .slice(0, limit);
  }

  async allExtractedFacts(): Promise<ExtractedMemoryFact[]> {
    const cache = await this.store.read();
    return Object.values(cache.sources)
      .filter((source) => !source.deletedAt)
      .flatMap((source) => source.extractedFacts);
  }

  async markExtracted(input: {
    sourceRef: string;
    contentHash: string;
    facts: ExtractedMemoryFact[];
    reviewFlags?: string[];
  }): Promise<void> {
    await this.mutate((cache) => {
      const source = cache.sources[input.sourceRef];
      // If a newer source version arrived during extraction, preserve it as
      // pending instead of incorrectly marking it complete.
      if (!source || source.contentHash !== input.contentHash) return;
      source.extractedContentHash = input.contentHash;
      source.text = "";
      source.extractedFacts = input.facts.map((fact) => {
        const safeTitle = fact.source.title
          ? sanitizeGoogleSourceTitle(
            fact.source.title,
            fact.source.type === "gmail" ? "Untitled Gmail message" : "Untitled Drive file"
          )
          : undefined;
        return {
          ...fact,
          reviewFlags: [...new Set([
            ...fact.reviewFlags,
            ...(safeTitle?.exclusions ?? []).map((value) => `excluded:${value}`)
          ])].sort(),
          source: {
            ...fact.source,
            title: safeTitle?.text
          }
        };
      });
      source.extractionReviewFlags = [...new Set(input.reviewFlags ?? [])].sort();
    });
  }

  async read(): Promise<SourceCacheFile> {
    return this.store.read();
  }

  async clear(): Promise<void> {
    await this.store.clear();
  }

  rotateStorageEncryptionKey(nextKey: string): void {
    this.store.rotateEncryptionKey(nextKey);
  }

  async sourceRefs(): Promise<string[]> {
    const cache = await this.store.read();
    return Object.keys(cache.sources);
  }

  private async mutate(update: (cache: SourceCacheFile) => void): Promise<void> {
    this.queue = this.queue.catch(() => {}).then(async () => {
      const cache = await this.store.read();
      update(cache);
      cache.updatedAt = this.now().toISOString();
      await this.store.write(cache);
    });
    await this.queue;
  }
}
