import { describe, expect, it } from "vitest";
import { SynchronizedTurnAudioRecorder } from "./turnAudioRecorder";

function samples(length: number, value: number): Float32Array {
  return Float32Array.from({ length }, () => value);
}

describe("SynchronizedTurnAudioRecorder", () => {
  it("freezes the exact VAD-controlled turn with bounded pre-roll", () => {
    const recorder = new SynchronizedTurnAudioRecorder({
      sampleRate: 8_000,
      channelCount: 2,
      preRollMs: 100,
      maxDurationMs: 1_000
    });
    recorder.push(samples(1_000, 0.1), samples(1_000, 0.05));
    recorder.begin();
    recorder.push(samples(400, 0.2), samples(400, 0.1));
    const turn = recorder.finish();
    expect(turn).not.toBeNull();
    expect(turn?.channelCount).toBe(2);
    expect(turn?.left).toHaveLength(1_200);
    expect(turn?.right).toHaveLength(1_200);
    expect(turn?.left[0]).toBeCloseTo(0.1);
    expect(turn?.left[1_199]).toBeCloseTo(0.2);
  });

  it("caps long turns in memory", () => {
    const recorder = new SynchronizedTurnAudioRecorder({
      sampleRate: 8_000,
      channelCount: 1,
      preRollMs: 0,
      maxDurationMs: 600
    });
    recorder.begin();
    recorder.push(samples(8_000, 0.1));
    expect(recorder.finish()?.mono).toHaveLength(4_800);
  });

  it("fails closed to mono when a reported stereo frame loses its second channel", () => {
    const recorder = new SynchronizedTurnAudioRecorder({ sampleRate: 8_000, channelCount: 2 });
    recorder.begin();
    recorder.push(samples(800, 0.1), samples(800, 0.05));
    recorder.push(samples(800, 0.1));
    const turn = recorder.finish();
    expect(turn).toMatchObject({ channelCount: 1, right: null });
  });

  it("does not return audio unless the shared VAD began a turn", () => {
    const recorder = new SynchronizedTurnAudioRecorder({ sampleRate: 8_000, channelCount: 1 });
    recorder.push(samples(800, 0.1));
    expect(recorder.finish()).toBeNull();
  });
});
