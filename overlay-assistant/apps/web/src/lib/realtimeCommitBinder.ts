export type PendingRealtimeCommit<T> = {
  localTurnId: string;
  committedAt: number;
  decision: Promise<T>;
};

/**
 * Binds local VAD commits to Realtime item IDs. Transcript completion only
 * consumes evidence with the same item ID, so a missing/short turn cannot steal
 * the following turn's speaker decision.
 */
export class RealtimeCommitBinder<T> {
  private readonly unbound: PendingRealtimeCommit<T>[] = [];
  private readonly byItemId = new Map<string, PendingRealtimeCommit<T>>();

  enqueue(commit: PendingRealtimeCommit<T>): void {
    this.unbound.push(commit);
  }

  bindNext(itemId: string | null | undefined): void {
    const commit = this.unbound.shift();
    if (!commit || !itemId) return;
    this.byItemId.set(itemId, commit);
  }

  take(itemId: string | null | undefined): PendingRealtimeCommit<T> | null {
    if (!itemId) return null;
    const commit = this.byItemId.get(itemId) ?? null;
    if (commit) this.byItemId.delete(itemId);
    return commit;
  }

  expireBefore(timestamp: number): void {
    while (this.unbound[0]?.committedAt < timestamp) this.unbound.shift();
    for (const [itemId, commit] of this.byItemId) {
      if (commit.committedAt < timestamp) this.byItemId.delete(itemId);
    }
  }

  clear(): void {
    this.unbound.length = 0;
    this.byItemId.clear();
  }

  get size(): number {
    return this.unbound.length + this.byItemId.size;
  }
}
