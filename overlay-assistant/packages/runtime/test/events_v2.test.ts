import { describe, expect, it } from "vitest";
import { parseRuntimeEventV2 } from "../src/events_v2.js";

function validEvent() {
  return {
    protocolVersion: 2,
    eventId: "evt-1",
    sessionId: "session-1",
    sourceId: "mic-1",
    sequence: 4,
    capturedAtMonotonicMs: 120.5,
    capturedAt: "2026-07-20T18:00:00.000Z",
    receivedAt: "2026-07-20T18:00:00.010Z",
    privacyClass: "private",
    provenance: "separated_channel",
    confidence: 1,
    payload: {
      type: "speech.started",
      turnId: "turn-1",
      speaker: "owner"
    }
  };
}

describe("runtime event v2", () => {
  it("accepts a versioned, sequenced speech event", () => {
    expect(parseRuntimeEventV2(validEvent()).payload.type).toBe("speech.started");
  });

  it.each([
    { ...validEvent(), protocolVersion: 1 },
    { ...validEvent(), capturedAtMonotonicMs: Number.NaN },
    { ...validEvent(), sequence: -1 },
    { ...validEvent(), capturedAt: "bad" },
    { ...validEvent(), confidence: 2 },
    { ...validEvent(), payload: { type: "made.up" } }
  ])("rejects malformed runtime events", (candidate) => {
    expect(() => parseRuntimeEventV2(candidate)).toThrow();
  });

  it("rejects unknown properties instead of silently accepting protocol drift", () => {
    expect(() => parseRuntimeEventV2({
      ...validEvent(),
      payload: {
        ...validEvent().payload,
        unexpected: true
      }
    })).toThrow();
  });
});
