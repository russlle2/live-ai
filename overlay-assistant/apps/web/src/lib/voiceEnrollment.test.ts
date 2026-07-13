import { describe, expect, it } from "vitest";
import {
  CleanMultichannelVoiceSegmentGate,
  CleanVoiceSegmentGate,
  encodePcm16Wav,
  normalizeOwnerEnrollmentProgress,
  shouldCollectOwnerEnrollment
} from "./voiceEnrollment";

function chunk(length: number, amplitude: number): Float32Array {
  const output = new Float32Array(length);
  for (let index = 0; index < length; index += 1) {
    output[index] = amplitude * Math.sin(index / 5);
  }
  return output;
}

describe("owner voice enrollment gating", () => {
  it("resumes an interrupted profile and completes only at the required count", () => {
    expect(normalizeOwnerEnrollmentProgress({
      sampleCount: 2,
      requiredSampleCount: 3,
      enrollmentComplete: false
    })).toEqual({
      sampleCount: 2,
      requiredSampleCount: 3,
      enrollmentComplete: false,
      remainingSamples: 1
    });
    expect(normalizeOwnerEnrollmentProgress({
      sampleCount: 3,
      requiredSampleCount: 3,
      enrollmentComplete: true
    })).toMatchObject({ enrollmentComplete: true, remainingSamples: 0 });
  });

  it("does not trust a premature completion flag", () => {
    expect(normalizeOwnerEnrollmentProgress({
      sampleCount: 1,
      requiredSampleCount: 3,
      enrollmentComplete: true
    })).toMatchObject({ enrollmentComplete: false, remainingSamples: 2 });
  });

  it("only permits the verified local microphone source", () => {
    expect(shouldCollectOwnerEnrollment("rep", true)).toBe(true);
    expect(shouldCollectOwnerEnrollment("rep", false)).toBe(false);
    expect(shouldCollectOwnerEnrollment("lead", true)).toBe(false);
    expect(shouldCollectOwnerEnrollment("unknown", true)).toBe(false);
  });

  it("emits a clean speech segment after trailing silence", () => {
    const gate = new CleanVoiceSegmentGate({ sampleRate: 16_000 });
    const emitted: Float32Array[] = [];
    for (let index = 0; index < 14; index += 1) emitted.push(...gate.push(chunk(1_024, 0.08)));
    for (let index = 0; index < 8; index += 1) emitted.push(...gate.push(chunk(1_024, 0)));
    expect(emitted).toHaveLength(1);
    expect(emitted[0].length).toBeGreaterThanOrEqual(11_200);
    expect(emitted[0].length).toBeLessThan(24_000);
  });

  it("rejects heavily clipped audio", () => {
    const gate = new CleanVoiceSegmentGate({ sampleRate: 16_000 });
    const emitted: Float32Array[] = [];
    for (let index = 0; index < 14; index += 1) emitted.push(...gate.push(chunk(1_024, 1.5)));
    for (let index = 0; index < 8; index += 1) emitted.push(...gate.push(chunk(1_024, 0)));
    expect(emitted).toHaveLength(0);
  });

  it("supports continuous bounded segments for mixed-stream verification", () => {
    const gate = new CleanVoiceSegmentGate({ sampleRate: 16_000, maxSegments: 6 });
    const emitted: Float32Array[] = [];
    for (let turn = 0; turn < 6; turn += 1) {
      for (let index = 0; index < 14; index += 1) emitted.push(...gate.push(chunk(1_024, 0.08)));
      for (let index = 0; index < 8; index += 1) emitted.push(...gate.push(chunk(1_024, 0)));
    }
    expect(emitted).toHaveLength(6);
  });

  it("keeps stereo channels aligned to the exact verification segment", () => {
    const gate = new CleanMultichannelVoiceSegmentGate({ sampleRate: 16_000 });
    const emitted = [] as ReturnType<typeof gate.push>;
    for (let index = 0; index < 14; index += 1) {
      emitted.push(...gate.push(chunk(1_024, 0.08), chunk(1_024, 0.05)));
    }
    for (let index = 0; index < 8; index += 1) {
      emitted.push(...gate.push(chunk(1_024, 0), chunk(1_024, 0)));
    }
    expect(emitted).toHaveLength(1);
    expect(emitted[0].channelCount).toBe(2);
    expect(emitted[0].right).not.toBeNull();
    expect(emitted[0].left.length).toBe(emitted[0].mono.length);
    expect(emitted[0].right?.length).toBe(emitted[0].mono.length);
  });

  it("preserves mono verification while refusing to invent a second channel", () => {
    const gate = new CleanMultichannelVoiceSegmentGate({ sampleRate: 16_000 });
    const emitted = [] as ReturnType<typeof gate.push>;
    for (let index = 0; index < 14; index += 1) emitted.push(...gate.push(chunk(1_024, 0.08)));
    for (let index = 0; index < 8; index += 1) emitted.push(...gate.push(chunk(1_024, 0)));
    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toMatchObject({ channelCount: 1, right: null });
  });
});

describe("PCM WAV encoding", () => {
  it("resamples to bounded 16 kHz mono PCM16 WAV", () => {
    const wav = encodePcm16Wav(chunk(48_000, 0.2), 48_000);
    const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
    expect(new TextDecoder().decode(wav.subarray(0, 4))).toBe("RIFF");
    expect(new TextDecoder().decode(wav.subarray(8, 12))).toBe("WAVE");
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(24, true)).toBe(16_000);
    expect(view.getUint16(34, true)).toBe(16);
    expect(view.getUint32(40, true)).toBe(32_000);
    expect(wav.byteLength).toBe(32_044);
  });

  it("refuses an overlong segment instead of silently retaining it", () => {
    expect(() => encodePcm16Wav(new Float32Array(16_001), 16_000, { maxDurationSeconds: 1 })).toThrow(
      "duration limit"
    );
  });
});
