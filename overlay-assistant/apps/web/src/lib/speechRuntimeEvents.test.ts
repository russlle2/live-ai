import { describe, expect, it } from "vitest";
import { SpeechRuntimeEventFactoryV2 } from "./speechRuntimeEvents";

describe("SpeechRuntimeEventFactoryV2", () => {
  it("emits ordered start/end events for one authoritative source turn", () => {
    let monotonic = 100;
    let eventId = 0;
    const factory = new SpeechRuntimeEventFactoryV2({
      sessionId: "session-1",
      sourceId: "realtime-lead",
      speaker: "remote",
      provenance: "separated_channel",
      confidence: 1,
      monotonicNow: () => monotonic,
      wallNow: () => new Date("2026-07-20T18:00:00.000Z"),
      createEventId: () => `event-${++eventId}`
    });

    const started = factory.start();
    monotonic = 420;
    const ended = factory.end("silence");

    expect(started.sequence).toBe(1);
    expect(started.payload).toMatchObject({
      type: "speech.started",
      speaker: "remote"
    });
    expect(ended?.sequence).toBe(2);
    expect(ended?.payload).toEqual({
      type: "speech.ended",
      turnId: started.payload.type === "speech.started"
        ? started.payload.turnId
        : "",
      reason: "silence"
    });
    expect(factory.activeTurnId).toBeNull();
  });

  it("keeps mixed microphone activity explicitly unknown", () => {
    const factory = new SpeechRuntimeEventFactoryV2({
      sessionId: "session-1",
      sourceId: "mixed-mic",
      speaker: "unknown",
      provenance: "unverified",
      confidence: 0,
      createEventId: () => "event-1"
    });
    expect(factory.start()).toMatchObject({
      provenance: "unverified",
      confidence: 0,
      payload: { speaker: "unknown" }
    });
  });

  it("does not create duplicate starts or unmatched ends", () => {
    let eventId = 0;
    const factory = new SpeechRuntimeEventFactoryV2({
      sessionId: "session-1",
      sourceId: "owner-mic",
      speaker: "owner",
      provenance: "separated_channel",
      confidence: 1,
      createEventId: () => `event-${++eventId}`
    });
    const first = factory.start();
    expect(factory.start()).toBe(first);
    expect(factory.end("cancelled")).not.toBeNull();
    expect(factory.end("cancelled")).toBeNull();
  });

  it("validates its canonical envelope at construction", () => {
    expect(() => new SpeechRuntimeEventFactoryV2({
      sessionId: "bad session",
      sourceId: "owner-mic",
      speaker: "owner",
      provenance: "separated_channel",
      confidence: 1
    })).toThrow(/sessionId|identifier/);
  });
});
