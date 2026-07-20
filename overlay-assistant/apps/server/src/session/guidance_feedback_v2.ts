export type GuidanceFeedbackStatusV2 = "unmarked" | "accepted" | "ignored";

export type PendingGuidanceFeedbackV2 = {
  sessionId: string;
  guidanceId: string;
  basedOnTurnSeq: number;
  createdAtMs: number;
  status: GuidanceFeedbackStatusV2;
  markedAtMs?: number;
};

type FeedbackStoreOptions = {
  now?: () => number;
  ttlMs?: number;
};

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,239}$/;

function assertId(value: string, label: string): void {
  if (!ID_PATTERN.test(value)) {
    throw new TypeError(`${label} must be a bounded protocol identifier`);
  }
}

export class GuidanceFeedbackStoreV2 {
  private readonly entries = new Map<string, PendingGuidanceFeedbackV2>();
  private readonly now: () => number;
  private readonly ttlMs: number;

  constructor(options: FeedbackStoreOptions = {}) {
    this.now = options.now ?? Date.now;
    this.ttlMs = options.ttlMs ?? 10 * 60_000;
    if (!Number.isSafeInteger(this.ttlMs) || this.ttlMs < 1_000 || this.ttlMs > 24 * 60 * 60_000) {
      throw new TypeError("feedback TTL must be between one second and one day");
    }
  }

  register(input: { sessionId: string; guidanceId: string; basedOnTurnSeq: number }): PendingGuidanceFeedbackV2 {
    assertId(input.sessionId, "sessionId");
    assertId(input.guidanceId, "guidanceId");
    if (!Number.isSafeInteger(input.basedOnTurnSeq) || input.basedOnTurnSeq < 0) {
      throw new TypeError("basedOnTurnSeq must be a nonnegative integer");
    }
    this.pruneExpired();
    const existing = this.entries.get(input.sessionId);
    if (existing?.guidanceId === input.guidanceId) {
      existing.basedOnTurnSeq = input.basedOnTurnSeq;
      return { ...existing };
    }
    const entry: PendingGuidanceFeedbackV2 = {
      sessionId: input.sessionId,
      guidanceId: input.guidanceId,
      basedOnTurnSeq: input.basedOnTurnSeq,
      createdAtMs: this.readNow(),
      status: "unmarked",
    };
    this.entries.set(input.sessionId, entry);
    return { ...entry };
  }

  mark(input: { sessionId: string; guidanceId: string; status: Exclude<GuidanceFeedbackStatusV2, "unmarked"> }): boolean {
    assertId(input.sessionId, "sessionId");
    assertId(input.guidanceId, "guidanceId");
    this.pruneExpired();
    const entry = this.entries.get(input.sessionId);
    if (!entry || entry.guidanceId !== input.guidanceId) return false;
    entry.status = input.status;
    entry.markedAtMs = this.readNow();
    return true;
  }

  takeForOwnerTurn(sessionId: string, guidanceId: string): PendingGuidanceFeedbackV2 | null {
    assertId(sessionId, "sessionId");
    assertId(guidanceId, "guidanceId");
    this.pruneExpired();
    const entry = this.entries.get(sessionId);
    if (!entry || entry.guidanceId !== guidanceId) return null;
    this.entries.delete(sessionId);
    return { ...entry };
  }

  clearSession(sessionId: string): boolean {
    assertId(sessionId, "sessionId");
    return this.entries.delete(sessionId);
  }

  clearAll(): number {
    const count = this.entries.size;
    this.entries.clear();
    return count;
  }

  get size(): number {
    this.pruneExpired();
    return this.entries.size;
  }

  private pruneExpired(): void {
    const now = this.readNow();
    for (const [sessionId, entry] of this.entries) {
      if (now - entry.createdAtMs > this.ttlMs) this.entries.delete(sessionId);
    }
  }

  private readNow(): number {
    const value = this.now();
    if (!Number.isFinite(value) || value < 0) {
      throw new TypeError("feedback clock must return a finite nonnegative value");
    }
    return value;
  }
}
