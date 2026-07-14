import path from "node:path";
import {
  GoogleSyncStateSchema,
  type GoogleLocalPurgeResult,
  type GoogleMemoryIngestor,
  type GoogleRuntimeConfig,
  type GoogleSyncRunResult,
  type GoogleSyncState,
  type MemoryFactExtractor,
  type SourceDocument
} from "./types.js";
import { PrivateJsonStore } from "./private_store.js";
import { GoogleOAuthManager } from "./oauth.js";
import { GoogleReadonlyClient } from "./client.js";
import { GoogleSourceCache } from "./cache.js";
import { materializeExtractedFacts } from "./extractor.js";
import { syncDrive, syncGmail } from "./sources.js";

export type GoogleSyncStatus = {
  configured: boolean;
  authorized: boolean;
  oauthExpiresAt?: number;
  scopes?: string[];
  state: GoogleSyncState;
  cachedSources: number;
  pendingExtraction: number;
  purging: boolean;
  extractionBudget: {
    day: string;
    used: number;
    dailyLimit: number;
    perRunLimit: number;
  };
  sourceCapacity: {
    used: number;
    limit: number;
    full: boolean;
  };
};

export class GoogleMemorySync {
  readonly oauth: GoogleOAuthManager;
  readonly cache: GoogleSourceCache;
  private readonly client: GoogleReadonlyClient;
  private readonly stateStore: PrivateJsonStore<GoogleSyncState>;
  private readonly now: () => Date;
  private readonly batchSize: number;
  private readonly maxPages: number;
  private readonly maxExtractionsPerRun: number;
  private readonly dailyExtractionBudget: number;
  private interval?: NodeJS.Timeout;
  private activeRun?: Promise<GoogleSyncRunResult>;
  private purging = false;
  private backgroundOptions: {
    runImmediately?: boolean;
    onError?: (error: unknown) => void;
  } = {};

  constructor(
    private readonly config: GoogleRuntimeConfig,
    private readonly extractor: MemoryFactExtractor,
    private readonly ingestFacts: GoogleMemoryIngestor
  ) {
    this.now = config.now ?? (() => new Date());
    this.batchSize = clampInteger(config.batchSize ?? 10, 1, 100);
    this.maxPages = clampInteger(config.maxPagesPerRun ?? 2, 1, 10);
    this.maxExtractionsPerRun = clampInteger(config.maxExtractionsPerRun ?? 5, 1, 50);
    this.dailyExtractionBudget = clampInteger(config.dailyExtractionBudget ?? 40, 1, 500);
    this.oauth = new GoogleOAuthManager(config);
    this.client = new GoogleReadonlyClient(this.oauth, {
      fetch: config.fetch ?? globalThis.fetch,
      requestTimeoutMs: config.requestTimeoutMs,
      maxJsonResponseBytes: config.maxJsonResponseBytes,
      maxTextResponseBytes: config.maxTextResponseBytes
    });
    this.cache = new GoogleSourceCache(
      config.storageDir,
      this.now,
      config.storageEncryptionKey,
      clampInteger(config.maxCachedSources ?? 1000, 10, 10_000)
    );
    this.stateStore = new PrivateJsonStore(
      path.join(config.storageDir, "google-sync-state.json"),
      GoogleSyncStateSchema,
      () => emptyState(this.now()),
      config.storageEncryptionKey
    );
  }

  beginAuthorization(): ReturnType<GoogleOAuthManager["beginAuthorization"]> {
    this.assertNotPurging();
    return this.oauth.beginAuthorization();
  }

  async completeAuthorization(input: { code: string; state: string }): ReturnType<GoogleOAuthManager["completeAuthorization"]> {
    this.assertNotPurging();
    const token = await this.oauth.completeAuthorization(input);
    if (!this.interval) this.startBackgroundSync({ ...this.backgroundOptions, runImmediately: false });
    return token;
  }

  async status(): Promise<GoogleSyncStatus> {
    const [oauth, state, cache, pending] = await Promise.all([
      this.oauth.status(),
      this.stateStore.read(),
      this.cache.read(),
      this.cache.pending(this.batchSize)
    ]);
    return {
      configured: oauth.configured,
      authorized: oauth.authorized,
      oauthExpiresAt: oauth.expiresAt,
      scopes: oauth.scopes,
      state,
      cachedSources: Object.keys(cache.sources).length,
      pendingExtraction: pending.length,
      purging: this.purging,
      extractionBudget: {
        day: state.extractionBudgetDay ?? this.budgetDay(),
        used: state.extractionBudgetDay === this.budgetDay() ? state.extractionsToday : 0,
        dailyLimit: this.dailyExtractionBudget,
        perRunLimit: this.maxExtractionsPerRun
      },
      sourceCapacity: {
        used: Object.keys(cache.sources).length,
        limit: this.cache.maxSources,
        full: Object.keys(cache.sources).length >= this.cache.maxSources
      }
    };
  }

  runOnce(): Promise<GoogleSyncRunResult> {
    this.assertNotPurging();
    if (this.activeRun) return this.activeRun;
    this.activeRun = this.performRun().finally(() => {
      this.activeRun = undefined;
    });
    return this.activeRun;
  }

  startBackgroundSync(options: {
    runImmediately?: boolean;
    onError?: (error: unknown) => void;
  } = {}): void {
    this.backgroundOptions = options;
    if (this.interval || this.purging) return;
    const intervalMs = clampInteger(this.config.intervalMs ?? 6 * 60 * 60_000, 60_000, 24 * 60 * 60_000);
    const run = () => this.runOnce().catch((error) => options.onError?.(error));
    if (options.runImmediately !== false) void run();
    this.interval = setInterval(run, intervalMs);
    this.interval.unref();
  }

  stopBackgroundSync(): void {
    if (this.interval) clearInterval(this.interval);
    this.interval = undefined;
  }

  /** Rotate all live store writers after an owner purge has removed prior values. */
  rotateStorageEncryptionKey(nextKey: string): void {
    this.config.storageEncryptionKey = nextKey;
    this.oauth.rotateStorageEncryptionKey(nextKey);
    this.cache.rotateStorageEncryptionKey(nextKey);
    this.stateStore.rotateEncryptionKey(nextKey);
  }

  async purgeLocalData(): Promise<GoogleLocalPurgeResult> {
    if (this.purging) throw new Error("google_private_data_purge_in_progress");
    this.purging = true;
    this.stopBackgroundSync();
    this.client.abortPendingRequests();
    this.oauth.abortPendingRequests();
    const warnings: string[] = [];
    let sourceRefs: string[] = [];
    let sourceInventoryRead = false;
    let factsDeactivated = true;
    let cacheCleared = false;
    let stateCleared = false;
    let providerRevoked = false;
    let localAuthorizationCleared = false;

    try {
      await this.activeRun;
    } catch {
      warnings.push("active_sync_failed_before_purge");
    }

    try {
      sourceRefs = await this.cache.sourceRefs();
      sourceInventoryRead = true;
    } catch {
      warnings.push("source_inventory_unreadable");
    }

    for (const sourceRef of sourceRefs) {
      try {
        await this.ingestFacts([], sourceRef);
      } catch {
        factsDeactivated = false;
        warnings.push("derived_memory_cleanup_failed");
      }
    }

    try {
      const revocation = await this.oauth.revokeAuthorization();
      providerRevoked = revocation.providerRevoked;
      localAuthorizationCleared = revocation.localAuthorizationCleared;
      warnings.push(...revocation.warnings);
    } catch {
      // Defensive boundary: the OAuth manager is itself best-effort, but an
      // unexpected error still must not skip cache/state deletion or later
      // scopes in the owner's full private-data purge.
      warnings.push("oauth_cleanup_failed");
    }

    try {
      await this.cache.clear();
      cacheCleared = true;
    } catch {
      warnings.push("source_cache_cleanup_failed");
    }
    try {
      await this.stateStore.clear();
      stateCleared = true;
    } catch {
      warnings.push("sync_state_cleanup_failed");
    }

    const localCleanupComplete = sourceInventoryRead
      && factsDeactivated
      && localAuthorizationCleared
      && cacheCleared
      && stateCleared;
    this.purging = false;
    return {
      removedSources: cacheCleared ? sourceRefs.length : 0,
      providerRevoked,
      localCleanupComplete,
      warnings: [...new Set(warnings)].sort()
    };
  }

  private async performRun(): Promise<GoogleSyncRunResult> {
    this.assertNotPurging();
    const oauthStatus = await this.oauth.status();
    const result: GoogleSyncRunResult = {
      authorized: oauthStatus.authorized,
      gmailDocuments: 0,
      driveDocuments: 0,
      extractedDocuments: 0,
      ingestedFacts: 0,
      reviewRequired: 0
    };
    if (!oauthStatus.authorized) return result;

    const state = await this.stateStore.read();
    const budgetDay = this.budgetDay();
    if (state.extractionBudgetDay !== budgetDay) {
      state.extractionBudgetDay = budgetDay;
      state.extractionsToday = 0;
      state.updatedAt = this.now().toISOString();
      await this.stateStore.write(state);
    }
    const handleDocument = async (document: SourceDocument) => {
      this.assertNotPurging();
      // Deactivate source-derived memory before accepting changed content. If
      // extraction later fails, obsolete claims cannot remain live.
      if (await this.cache.needsInvalidation(document)) {
        await this.ingestFacts([], document.sourceRef);
      }
      await this.cache.upsert(document);
      if (document.sourceType === "gmail") result.gmailDocuments += 1;
      else result.driveDocuments += 1;
    };
    const handleDelete = async (sourceRef: string) => {
      this.assertNotPurging();
      await this.ingestFacts([], sourceRef);
      await this.cache.markDeleted(sourceRef);
    };

    await syncGmail(this.client, {
      state: state.gmail,
      limit: this.batchSize,
      maxPages: this.maxPages,
      now: this.now,
      checkpoint: async (gmail) => {
        this.assertNotPurging();
        state.gmail = gmail;
        state.updatedAt = this.now().toISOString();
        await this.stateStore.write(state);
      },
      onDocument: handleDocument,
      onDelete: handleDelete,
      query: this.config.gmailQuery ?? "-in:spam -in:trash"
    });

    await syncDrive(this.client, {
      state: state.drive,
      limit: this.batchSize,
      maxPages: this.maxPages,
      now: this.now,
      checkpoint: async (drive) => {
        this.assertNotPurging();
        state.drive = drive;
        state.updatedAt = this.now().toISOString();
        await this.stateStore.write(state);
      },
      onDocument: handleDocument,
      onDelete: handleDelete,
      query: this.config.driveQuery
    });

    this.assertNotPurging();
    const remainingDailyBudget = Math.max(0, this.dailyExtractionBudget - state.extractionsToday);
    const pending = await this.cache.pending(Math.min(
      this.batchSize,
      this.maxExtractionsPerRun,
      remainingDailyBudget
    ));
    let existingFacts = await this.cache.allExtractedFacts();
    for (const document of pending) {
      this.assertNotPurging();
      state.extractionsToday += 1;
      state.updatedAt = this.now().toISOString();
      await this.stateStore.write(state);
      try {
        const drafts = await this.extractor.extract(document);
        this.assertNotPurging();
        const facts = materializeExtractedFacts({ document, drafts, existingFacts });
        // The ingestor is called before the source is marked complete. A crash
        // retries the same stable IDs, making the operation idempotent.
        await this.ingestFacts(facts, document.sourceRef);
        const reviewFlags = facts.flatMap((fact) => fact.reviewFlags);
        await this.cache.markExtracted({
          sourceRef: document.sourceRef,
          contentHash: document.contentHash,
          facts,
          reviewFlags
        });
        existingFacts = [
          ...existingFacts.filter((fact) => fact.source.ref !== document.sourceRef),
          ...facts
        ];
        result.extractedDocuments += 1;
        result.ingestedFacts += facts.length;
        result.reviewRequired += facts.filter((fact) =>
          fact.sensitivity !== "normal" || fact.reviewFlags.some((flag) => flag === "needs_review" || flag.startsWith("conflicts_with:"))
        ).length;
      } catch (error) {
        if (this.purging) throw error;
        // Keep this source pending. A transient OpenAI or memory-store failure
        // must not advance extraction state or block other cached sources.
      }
    }

    return result;
  }

  private assertNotPurging(): void {
    if (this.purging) throw new Error("google_private_data_purge_in_progress");
  }

  private budgetDay(): string {
    return this.now().toISOString().slice(0, 10);
  }
}

export function emptyState(now = new Date()): GoogleSyncState {
  return GoogleSyncStateSchema.parse({
    schema: "google_sync_state_v1",
    updatedAt: now.toISOString(),
    extractionBudgetDay: now.toISOString().slice(0, 10),
    extractionsToday: 0,
    gmail: { phase: "bootstrap" },
    drive: { phase: "bootstrap" }
  });
}

function clampInteger(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) return minimum;
  return Math.min(maximum, Math.max(minimum, Math.floor(value)));
}
