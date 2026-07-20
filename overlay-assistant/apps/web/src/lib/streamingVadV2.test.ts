import { describe, expect, it } from "vitest";
import { StreamingVadV2 } from "./streamingVadV2";

function frame(amplitude: number, length = 1_600): Float32Array {
  return Float32Array.from(
    { length },
    (_, index) => Math.sin(index / 7) * amplitude
  );
}

describe("StreamingVadV2", () => {
  it("starts and ends speech from audio time rather than animation frames", () => {
    const vad = new StreamingVadV2({
      sampleRate: 16_000,
      minimumSpeechMs: 200,
      silenceToEndMs: 400
    });

    expect(vad.push(frame(0))).toEqual([]);
    expect(vad.push(frame(0.08))).toEqual(["speech_started"]);
    expect(vad.push(frame(0.08))).toEqual([]);
    expect(vad.push(frame(0.08))).toEqual([]);
    expect(vad.push(frame(0))).toEqual([]);
    expect(vad.push(frame(0))).toEqual([]);
    expect(vad.push(frame(0))).toEqual([]);
    expect(vad.push(frame(0))).toEqual(["speech_ended"]);
  });

  it("does not trigger on a stable low-level noise floor", () => {
    const vad = new StreamingVadV2({ sampleRate: 16_000 });
    const events = Array.from({ length: 30 }, () => vad.push(frame(0.006))).flat();
    expect(events).toEqual([]);
    expect(vad.noiseFloor).toBeGreaterThan(0);
  });

  it("rejects short transients without committing a turn", () => {
    const vad = new StreamingVadV2({
      sampleRate: 16_000,
      minimumSpeechMs: 250,
      silenceToEndMs: 300
    });
    const events = [
      ...vad.push(frame(0.09, 1_600)),
      ...vad.push(frame(0, 4_800))
    ];
    expect(events).toEqual(["speech_started", "speech_cancelled"]);
  });

  it("checkpoints a bounded continuous turn", () => {
    const vad = new StreamingVadV2({
      sampleRate: 16_000,
      maximumSpeechMs: 500
    });
    const events = Array.from({ length: 6 }, () => vad.push(frame(0.08))).flat();
    expect(events).toEqual(["speech_started", "speech_ended", "speech_started"]);
  });

  it("validates sample rate and resets deterministically", () => {
    expect(() => new StreamingVadV2({ sampleRate: 0 })).toThrow(/sample rate/i);
    const vad = new StreamingVadV2({ sampleRate: 16_000 });
    vad.push(frame(0.08));
    vad.reset();
    expect(vad.active).toBe(false);
    expect(vad.elapsedSpeechMs).toBe(0);
  });
});
