import { describe, expect, it } from "vitest";
import { buildRealtimeTranscriptionSession } from "./realtime_token.js";

describe("Realtime transcription session", () => {
  it("uses manual commits so capture origin remains the speaker identity", () => {
    const session = buildRealtimeTranscriptionSession("lead");
    expect(session.type).toBe("transcription");
    expect(session.audio.input.turn_detection).toBeNull();
    expect(session.audio.input.transcription.model).toBeTruthy();
  });

  it("applies near-field cleanup only to the local microphone", () => {
    const local = buildRealtimeTranscriptionSession("rep");
    const remote = buildRealtimeTranscriptionSession("lead");
    expect(local.audio.input).toHaveProperty("noise_reduction.type", "near_field");
    expect(remote.audio.input).not.toHaveProperty("noise_reduction");
  });
});
