import { describe, expect, it } from "vitest";
import { GuidanceFeedbackStoreV2 } from "./guidance_feedback_v2.js";

describe("GuidanceFeedbackStoreV2", () => {
  it("attaches accepted feedback to the exact guidance once", () => {
    let now = 1_000;
    const store = new GuidanceFeedbackStoreV2({ now: () => now });
    store.register({
      sessionId: "session-1",
      guidanceId: "guidance-1",
      basedOnTurnSeq: 4,
    });

    now = 1_200;
    expect(
      store.mark({
        sessionId: "session-1",
        guidanceId: "guidance-1",
        status: "accepted",
      }),
    ).toBe(true);
    expect(store.takeForOwnerTurn("session-1", "guidance-1")).toMatchObject({
      guidanceId: "guidance-1",
      basedOnTurnSeq: 4,
      status: "accepted",
      markedAtMs: 1_200,
    });
    expect(store.takeForOwnerTurn("session-1", "guidance-1")).toBeNull();
  });

  it("records an explicit dismissal as ignored", () => {
    const store = new GuidanceFeedbackStoreV2({ now: () => 1_000 });
    store.register({
      sessionId: "session-1",
      guidanceId: "guidance-1",
      basedOnTurnSeq: 4,
    });
    expect(
      store.mark({
        sessionId: "session-1",
        guidanceId: "guidance-1",
        status: "ignored",
      }),
    ).toBe(true);
    expect(store.takeForOwnerTurn("session-1", "guidance-1")?.status).toBe("ignored");
  });

  it("preserves early feedback when the same guidance advances phases", () => {
    let now = 1_000;
    const store = new GuidanceFeedbackStoreV2({ now: () => now });
    store.register({
      sessionId: "session-1",
      guidanceId: "guidance-1",
      basedOnTurnSeq: 4,
    });
    expect(
      store.mark({
        sessionId: "session-1",
        guidanceId: "guidance-1",
        status: "accepted",
      }),
    ).toBe(true);

    now = 1_200;
    store.register({
      sessionId: "session-1",
      guidanceId: "guidance-1",
      basedOnTurnSeq: 4,
    });
    expect(store.takeForOwnerTurn("session-1", "guidance-1")).toMatchObject({
      status: "accepted",
      markedAtMs: 1_000,
      createdAtMs: 1_000,
    });
  });

  it("rejects mismatched sessions and guidance IDs", () => {
    const store = new GuidanceFeedbackStoreV2({ now: () => 1_000 });
    store.register({
      sessionId: "session-1",
      guidanceId: "guidance-1",
      basedOnTurnSeq: 4,
    });
    expect(
      store.mark({
        sessionId: "session-2",
        guidanceId: "guidance-1",
        status: "accepted",
      }),
    ).toBe(false);
    expect(
      store.mark({
        sessionId: "session-1",
        guidanceId: "guidance-2",
        status: "accepted",
      }),
    ).toBe(false);
  });

  it("returns unmarked guidance for conservative changed-wording analysis", () => {
    const store = new GuidanceFeedbackStoreV2({ now: () => 1_000 });
    store.register({
      sessionId: "session-1",
      guidanceId: "guidance-1",
      basedOnTurnSeq: 4,
    });
    expect(store.takeForOwnerTurn("session-1", "guidance-1")?.status).toBe("unmarked");
  });

  it("expires stale feedback and supersedes older session guidance", () => {
    let now = 1_000;
    const store = new GuidanceFeedbackStoreV2({
      now: () => now,
      ttlMs: 10_000,
    });
    store.register({
      sessionId: "session-1",
      guidanceId: "guidance-old",
      basedOnTurnSeq: 3,
    });
    store.register({
      sessionId: "session-1",
      guidanceId: "guidance-current",
      basedOnTurnSeq: 4,
    });

    expect(store.takeForOwnerTurn("session-1", "guidance-old")).toBeNull();
    now = 11_001;
    expect(store.takeForOwnerTurn("session-1", "guidance-current")).toBeNull();
    expect(store.size).toBe(0);
  });

  it("clears session and global private state", () => {
    const store = new GuidanceFeedbackStoreV2({ now: () => 1_000 });
    store.register({
      sessionId: "session-1",
      guidanceId: "guidance-1",
      basedOnTurnSeq: 1,
    });
    store.register({
      sessionId: "session-2",
      guidanceId: "guidance-2",
      basedOnTurnSeq: 2,
    });
    expect(store.clearSession("session-1")).toBe(true);
    expect(store.size).toBe(1);
    expect(store.clearAll()).toBe(1);
    expect(store.size).toBe(0);
  });
});
