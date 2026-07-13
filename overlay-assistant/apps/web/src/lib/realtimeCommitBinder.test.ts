import { describe, expect, it } from "vitest";
import { RealtimeCommitBinder } from "./realtimeCommitBinder";

describe("RealtimeCommitBinder", () => {
  it("keeps reverse-resolving classifier promises attached to their item IDs", async () => {
    const binder = new RealtimeCommitBinder<string>();
    let resolveFirst!: (value: string) => void;
    let resolveSecond!: (value: string) => void;
    binder.enqueue({
      localTurnId: "turn-1",
      committedAt: 1,
      decision: new Promise((resolve) => { resolveFirst = resolve; })
    });
    binder.enqueue({
      localTurnId: "turn-2",
      committedAt: 2,
      decision: new Promise((resolve) => { resolveSecond = resolve; })
    });
    binder.bindNext("item-a");
    binder.bindNext("item-b");
    const first = binder.take("item-a");
    const second = binder.take("item-b");
    resolveSecond("other");
    resolveFirst("owner");
    await expect(first?.decision).resolves.toBe("owner");
    await expect(second?.decision).resolves.toBe("other");
  });

  it("does not consume a later turn when a completion has no matching item ID", async () => {
    const binder = new RealtimeCommitBinder<string>();
    binder.enqueue({ localTurnId: "short", committedAt: 1, decision: Promise.resolve("unknown") });
    binder.enqueue({ localTurnId: "next", committedAt: 2, decision: Promise.resolve("owner") });
    binder.bindNext(null);
    binder.bindNext("item-next");
    expect(binder.take("missing")).toBeNull();
    await expect(binder.take("item-next")?.decision).resolves.toBe("owner");
  });

  it("expires late evidence and clears on stop/restart", () => {
    const binder = new RealtimeCommitBinder<string>();
    binder.enqueue({ localTurnId: "old", committedAt: 10, decision: Promise.resolve("owner") });
    binder.bindNext("item-old");
    binder.expireBefore(11);
    expect(binder.take("item-old")).toBeNull();
    binder.enqueue({ localTurnId: "new", committedAt: 12, decision: Promise.resolve("owner") });
    binder.clear();
    expect(binder.size).toBe(0);
  });
});
