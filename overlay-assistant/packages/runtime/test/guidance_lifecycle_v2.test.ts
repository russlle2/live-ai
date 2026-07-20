import { describe, expect, it } from "vitest";
import { GuidanceLifecycleV2 } from "../src/guidance_lifecycle_v2.js";

describe("guidance lifecycle v2", () => {
  it("aborts obsolete work when a newer turn begins", () => {
    let now = 100;
    let id = 0;
    const lifecycle = new GuidanceLifecycleV2({
      now: () => now,
      createId: () => `guidance-${++id}`
    });
    const first = lifecycle.begin("turn-1", 1_500);
    const second = lifecycle.begin("turn-2", 1_500);

    expect(first.signal.aborted).toBe(true);
    expect(first.canPublish()).toBe(false);
    expect(first.status()).toBe("superseded");
    expect(second.signal.aborted).toBe(false);
    expect(second.canPublish()).toBe(true);
    expect(second.guidanceId).not.toBe(first.guidanceId);
  });

  it("expires and aborts work after its deadline", () => {
    let now = 100;
    const lifecycle = new GuidanceLifecycleV2({
      now: () => now,
      createId: () => "guidance-1"
    });
    const lease = lifecycle.begin("turn-1", 400);
    now = 500;

    expect(lease.canPublish()).toBe(false);
    expect(lease.signal.aborted).toBe(true);
    expect(lease.status()).toBe("expired");
  });

  it("completes only the current active lease", () => {
    const lifecycle = new GuidanceLifecycleV2({
      now: () => 100,
      createId: () => "guidance-1"
    });
    const lease = lifecycle.begin("turn-1", 400);

    expect(lease.complete()).toBe(true);
    expect(lease.complete()).toBe(false);
    expect(lease.status()).toBe("completed");
    expect(lease.canPublish()).toBe(false);
    expect(lifecycle.current()).toBeNull();
  });

  it("supports explicit cancellation with a safe reason", () => {
    const lifecycle = new GuidanceLifecycleV2({
      now: () => 100,
      createId: () => "guidance-1"
    });
    const lease = lifecycle.begin("turn-1", 400);

    expect(lifecycle.cancelCurrent("capture_stopped")).toBe(true);
    expect(lease.status()).toBe("cancelled");
    expect(lease.signal.aborted).toBe(true);
    expect(lifecycle.cancelCurrent("capture_stopped")).toBe(false);
  });

  it("rejects unsafe identifiers and invalid budgets", () => {
    const lifecycle = new GuidanceLifecycleV2({
      now: () => 100,
      createId: () => "guidance-1"
    });
    expect(() => lifecycle.begin("bad turn id", 400)).toThrow(/turn/i);
    expect(() => lifecycle.begin("turn-1", 0)).toThrow(/budget/i);
    expect(() => lifecycle.begin("turn-1", Number.NaN)).toThrow(/budget/i);
  });
});
