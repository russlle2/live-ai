import { describe, expect, it } from "vitest";
import {
  decodeAudioFrameMessage,
  selectAudioFrameCaptureBackend
} from "./audioFrameCapture";

describe("audio frame capture backend", () => {
  it("prefers AudioWorklet whenever the browser exposes it", () => {
    expect(selectAudioFrameCaptureBackend({
      hasAudioWorklet: true,
      hasAudioWorkletNode: true,
      hasScriptProcessor: true
    })).toBe("audio_worklet");
  });

  it("uses the deprecated processor only as a compatibility fallback", () => {
    expect(selectAudioFrameCaptureBackend({
      hasAudioWorklet: false,
      hasAudioWorkletNode: false,
      hasScriptProcessor: true
    })).toBe("script_processor_fallback");
    expect(selectAudioFrameCaptureBackend({
      hasAudioWorklet: false,
      hasAudioWorkletNode: false,
      hasScriptProcessor: false
    })).toBe("unavailable");
  });
});

describe("AudioWorklet frame messages", () => {
  it("decodes one or two transferred Float32 channels", () => {
    const left = Float32Array.from([0.1, 0.2]);
    const right = Float32Array.from([0.3, 0.4]);
    const decoded = decodeAudioFrameMessage({
      type: "audio_frame",
      channels: [left.buffer, right.buffer]
    });

    expect(decoded?.left).toEqual(left);
    expect(decoded?.right).toEqual(right);
  });

  it.each([
    null,
    {},
    { type: "other", channels: [] },
    { type: "audio_frame", channels: [] },
    { type: "audio_frame", channels: [new ArrayBuffer(3)] },
    { type: "audio_frame", channels: [new ArrayBuffer(8), "bad"] }
  ])("rejects malformed worklet messages", (value) => {
    expect(decodeAudioFrameMessage(value)).toBeNull();
  });
});
