import { describe, expect, it } from "vitest";
import {
  initialConversationStateV2,
  reduceConversationStateV2
} from "../src/conversation_state_v2.js";
import { event } from "./fixtures.js";

describe("conversation state v2", () => {
  it("detects a remote interruption while owner speech remains active", () => {
    let state = initialConversationStateV2("session-1");
    state = reduceConversationStateV2(state, event(1, {
      type: "speech.started",
      turnId: "owner-turn",
      speaker: "owner"
    }));
    state = reduceConversationStateV2(state, event(1, {
      type: "speech.started",
      turnId: "remote-turn",
      speaker: "remote"
    }, "remote-source"));

    expect(state.activeTurns.map((turn) => turn.turnId).sort()).toEqual([
      "owner-turn",
      "remote-turn"
    ]);
    expect(state.overlapActive).toBe(true);
    expect(state.lastInterruption).toMatchObject({
      interruptedTurnId: "owner-turn",
      interruptingTurnId: "remote-turn"
    });
  });

  it("does not invent an interruption identity for unknown mixed speech", () => {
    let state = initialConversationStateV2("session-1");
    state = reduceConversationStateV2(state, event(1, {
      type: "speech.started",
      turnId: "owner-turn",
      speaker: "owner"
    }));
    state = reduceConversationStateV2(state, event(1, {
      type: "speech.started",
      turnId: "mixed-turn",
      speaker: "unknown"
    }, "mixed-mic"));

    expect(state.overlapActive).toBe(true);
    expect(state.lastInterruption).toBeNull();
  });

  it("closes only the matching turn and ends overlap", () => {
    let state = initialConversationStateV2("session-1");
    state = reduceConversationStateV2(state, event(1, {
      type: "speech.started",
      turnId: "owner-turn",
      speaker: "owner"
    }));
    state = reduceConversationStateV2(state, event(1, {
      type: "speech.started",
      turnId: "remote-turn",
      speaker: "remote"
    }, "remote-source"));
    state = reduceConversationStateV2(state, event(2, {
      type: "speech.ended",
      turnId: "owner-turn",
      reason: "silence"
    }));

    expect(state.activeTurns.map((turn) => turn.turnId)).toEqual(["remote-turn"]);
    expect(state.overlapActive).toBe(false);
  });

  it("keeps only the newest partial revision for each turn", () => {
    let state = initialConversationStateV2("session-1");
    state = reduceConversationStateV2(state, event(1, {
      type: "transcript.partial",
      turnId: "turn-1",
      revision: 2,
      text: "newer partial",
      stablePrefixLength: 6,
      speaker: "remote"
    }, "remote-source"));
    state = reduceConversationStateV2(state, event(2, {
      type: "transcript.partial",
      turnId: "turn-1",
      revision: 1,
      text: "stale",
      stablePrefixLength: 5,
      speaker: "remote"
    }, "remote-source"));

    expect(state.partials["turn-1"]).toMatchObject({
      revision: 2,
      text: "newer partial"
    });
  });

  it("ignores duplicate IDs and stale per-source sequences", () => {
    const first = event(2, {
      type: "speech.started",
      turnId: "turn-2",
      speaker: "owner"
    });
    let state = reduceConversationStateV2(
      initialConversationStateV2("session-1"),
      first
    );
    state = reduceConversationStateV2(state, first);
    state = reduceConversationStateV2(state, event(1, {
      type: "speech.started",
      turnId: "stale-turn",
      speaker: "owner"
    }));

    expect(state.activeTurns.map((turn) => turn.turnId)).toEqual(["turn-2"]);
    expect(state.processedEventIds).toHaveLength(1);
  });

  it("commits turns once, clears transient state, and bounds history", () => {
    let state = initialConversationStateV2("session-1");
    for (let index = 0; index < 205; index += 1) {
      state = reduceConversationStateV2(state, event(index + 1, {
        type: "turn.committed",
        turnId: `turn-${index}`,
        text: `Turn ${index}`,
        speaker: index % 2 ? "owner" : "remote",
        startedAt: "2026-07-20T18:00:00.000Z",
        endedAt: "2026-07-20T18:00:01.000Z"
      }));
    }

    expect(state.committedTurns).toHaveLength(200);
    expect(state.committedTurns[0]?.turnId).toBe("turn-5");
    expect(state.committedTurns.at(-1)?.turnId).toBe("turn-204");
  });

  it("clears active turns owned by a disconnected source", () => {
    let state = initialConversationStateV2("session-1");
    state = reduceConversationStateV2(state, event(1, {
      type: "speech.started",
      turnId: "owner-turn",
      speaker: "owner"
    }));
    state = reduceConversationStateV2(state, event(2, {
      type: "source.disconnected",
      reason: "device_change"
    }));

    expect(state.activeTurns).toEqual([]);
    expect(state.overlapActive).toBe(false);
  });

  it("replays deterministically and rejects cross-session events", () => {
    const events = [
      event(1, {
        type: "speech.started",
        turnId: "owner-turn",
        speaker: "owner"
      }),
      event(2, {
        type: "speech.ended",
        turnId: "owner-turn",
        reason: "silence"
      })
    ];
    const once = events.reduce(reduceConversationStateV2, initialConversationStateV2("session-1"));
    const twice = events.reduce(reduceConversationStateV2, once);

    expect(twice).toEqual(once);
    expect(() => reduceConversationStateV2(
      once,
      event(3, {
        type: "speech.started",
        turnId: "wrong-session-turn",
        speaker: "owner"
      }, "owner-source", { sessionId: "session-2" })
    )).toThrow(/session/i);
  });
});
