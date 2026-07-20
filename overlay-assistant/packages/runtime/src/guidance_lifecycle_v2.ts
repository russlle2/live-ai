export type GuidanceLeaseStatusV2 =
  | "active"
  | "completed"
  | "cancelled"
  | "expired"
  | "superseded";

export type GuidanceLeaseV2 = {
  readonly guidanceId: string;
  readonly turnId: string;
  readonly startedAtMonotonicMs: number;
  readonly deadlineAtMonotonicMs: number;
  readonly signal: AbortSignal;
  canPublish(): boolean;
  status(): GuidanceLeaseStatusV2;
  complete(): boolean;
};

export type GuidanceLifecycleOptionsV2 = {
  now?: () => number;
  createId?: () => string;
};

type LeaseEntry = {
  guidanceId: string;
  turnId: string;
  startedAtMonotonicMs: number;
  deadlineAtMonotonicMs: number;
  controller: AbortController;
  state: GuidanceLeaseStatusV2;
  timer?: ReturnType<typeof setTimeout>;
};

const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,239}$/;
const REASON_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;
let defaultIdSequence = 0;

function defaultNow(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

function defaultId(): string {
  defaultIdSequence = (defaultIdSequence + 1) % Number.MAX_SAFE_INTEGER;
  return `guidance-${Date.now().toString(36)}-${defaultIdSequence.toString(36)}`;
}

function unrefTimer(timer: ReturnType<typeof setTimeout>): void {
  const candidate = timer as unknown as { unref?: () => void };
  candidate.unref?.();
}

export class GuidanceLifecycleV2 {
  private readonly now: () => number;
  private readonly createId: () => string;
  private currentEntry: LeaseEntry | null = null;

  constructor(options: GuidanceLifecycleOptionsV2 = {}) {
    this.now = options.now ?? defaultNow;
    this.createId = options.createId ?? defaultId;
  }

  begin(turnId: string, budgetMs: number): GuidanceLeaseV2 {
    if (!IDENTIFIER_PATTERN.test(turnId)) {
      throw new TypeError("turnId must be a bounded protocol identifier");
    }
    if (!Number.isFinite(budgetMs) || budgetMs < 1 || budgetMs > 120_000) {
      throw new TypeError("guidance budget must be between 1 and 120000 milliseconds");
    }
    const startedAtMonotonicMs = this.readNow();
    const guidanceId = this.createId();
    if (!IDENTIFIER_PATTERN.test(guidanceId)) {
      throw new TypeError("guidance ID factory returned an invalid identifier");
    }

    if (this.currentEntry) {
      this.transition(this.currentEntry, "superseded", "newer_turn_started");
    }

    const entry: LeaseEntry = {
      guidanceId,
      turnId,
      startedAtMonotonicMs,
      deadlineAtMonotonicMs: startedAtMonotonicMs + budgetMs,
      controller: new AbortController(),
      state: "active"
    };
    entry.timer = setTimeout(() => {
      if (entry.state === "active") {
        this.transition(entry, "expired", "guidance_deadline_exceeded");
      }
    }, budgetMs);
    unrefTimer(entry.timer);
    this.currentEntry = entry;

    return {
      guidanceId,
      turnId,
      startedAtMonotonicMs,
      deadlineAtMonotonicMs: entry.deadlineAtMonotonicMs,
      signal: entry.controller.signal,
      canPublish: () => this.statusOf(entry) === "active",
      status: () => this.statusOf(entry),
      complete: () => this.completeEntry(entry)
    };
  }

  current(): GuidanceLeaseV2 | null {
    const entry = this.currentEntry;
    if (!entry || this.statusOf(entry) !== "active") return null;
    return {
      guidanceId: entry.guidanceId,
      turnId: entry.turnId,
      startedAtMonotonicMs: entry.startedAtMonotonicMs,
      deadlineAtMonotonicMs: entry.deadlineAtMonotonicMs,
      signal: entry.controller.signal,
      canPublish: () => this.statusOf(entry) === "active",
      status: () => this.statusOf(entry),
      complete: () => this.completeEntry(entry)
    };
  }

  cancelCurrent(reason = "cancelled"): boolean {
    if (!REASON_PATTERN.test(reason)) {
      throw new TypeError("cancellation reason must be a bounded reason code");
    }
    const entry = this.currentEntry;
    if (!entry || this.statusOf(entry) !== "active") return false;
    this.transition(entry, "cancelled", reason);
    return true;
  }

  private completeEntry(entry: LeaseEntry): boolean {
    if (this.statusOf(entry) !== "active") return false;
    this.transition(entry, "completed");
    return true;
  }

  private statusOf(entry: LeaseEntry): GuidanceLeaseStatusV2 {
    if (
      entry.state === "active" &&
      this.readNow() >= entry.deadlineAtMonotonicMs
    ) {
      this.transition(entry, "expired", "guidance_deadline_exceeded");
    }
    return entry.state;
  }

  private transition(
    entry: LeaseEntry,
    state: Exclude<GuidanceLeaseStatusV2, "active">,
    reason?: string
  ): void {
    if (entry.state !== "active") return;
    entry.state = state;
    if (entry.timer) clearTimeout(entry.timer);
    entry.timer = undefined;
    if (state !== "completed" && !entry.controller.signal.aborted) {
      entry.controller.abort(new Error(reason ?? state));
    }
    if (this.currentEntry === entry) this.currentEntry = null;
  }

  private readNow(): number {
    const value = this.now();
    if (!Number.isFinite(value) || value < 0) {
      throw new TypeError("guidance clock must return a finite nonnegative value");
    }
    return value;
  }
}
