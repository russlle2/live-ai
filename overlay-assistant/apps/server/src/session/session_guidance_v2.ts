import {
  GuidanceLifecycleV2,
  type GuidanceLeaseV2,
  type GuidanceLifecycleOptionsV2
} from "@overlay-assistant/runtime";

export class SessionGuidanceV2 {
  private readonly lifecycle: GuidanceLifecycleV2;
  private currentLease: GuidanceLeaseV2 | null = null;

  constructor(options: GuidanceLifecycleOptionsV2 = {}) {
    this.lifecycle = new GuidanceLifecycleV2(options);
  }

  beginTurn(turnId: string, budgetMs: number): GuidanceLeaseV2 {
    const lease = this.lifecycle.begin(turnId, budgetMs);
    this.currentLease = lease;
    return lease;
  }

  cancel(reason: string): boolean {
    const cancelled = this.lifecycle.cancelCurrent(reason);
    if (cancelled) this.currentLease = null;
    return cancelled;
  }

  complete(lease: GuidanceLeaseV2): boolean {
    if (this.currentLease?.guidanceId !== lease.guidanceId) return false;
    const completed = lease.complete();
    if (completed) this.currentLease = null;
    return completed;
  }

  get currentGuidanceId(): string | null {
    if (!this.currentLease?.canPublish()) {
      this.currentLease = null;
      return null;
    }
    return this.currentLease.guidanceId;
  }
}
