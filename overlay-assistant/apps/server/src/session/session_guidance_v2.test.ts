import { describe, expect, it } from "vitest";
import { SessionGuidanceV2 } from "./session_guidance_v2.js";

describe("SessionGuidanceV2", () => {
  it("aborts the previous turn and exposes one current publish lease", () => {
    let now = 100;
    let id = 0;
    const guidance = new SessionGuidanceV2({
      now: () => now,
      createId: () => `guidance-${++id}`
    });
    const first = guidance.beginTurn("turn-1", 1_500);
    const second = guidance.beginTurn("turn-2", 1_500);

    expect(first.signal.aborted).toBe(true);
    expect(first.canPublish()).toBe(false);
    expect(second.canPublish()).toBe(true);
    expect(guidance.currentGuidanceId).toBe("guidance-2");
  });

  it("cancels current work when owner speech or capture invalidates it", () => {
    const guidance = new SessionGuidanceV2({
      now: () => 100,
      createId: () => "guidance-1"
    });
    const lease = guidance.beginTurn("turn-1", 1_500);

    expect(guidance.cancel("owner_started_speaking")).toBe(true);
    expect(lease.signal.aborted).toBe(true);
    expect(lease.status()).toBe("cancelled");
    expect(guidance.currentGuidanceId).toBeNull();
  });

  it("marks a published final as complete", () => {
    const guidance = new SessionGuidanceV2({
      now: () => 100,
      createId: () => "guidance-1"
    });
    const lease = guidance.beginTurn("turn-1", 1_500);
    expect(guidance.complete(lease)).toBe(true);
    expect(lease.status()).toBe("completed");
    expect(guidance.complete(lease)).toBe(false);
  });
});
