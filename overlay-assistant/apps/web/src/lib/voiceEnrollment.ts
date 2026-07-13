export const OWNER_ENROLLMENT_TARGET_SEGMENTS = 3;
export const OWNER_ENROLLMENT_INSTALLATION_KEY = "live-ai.owner-voice-enrolled.v1";

export type OwnerEnrollmentProgressInput = {
  sampleCount?: number;
  requiredSampleCount?: number;
  enrollmentComplete?: boolean;
};

export type OwnerEnrollmentProgress = {
  sampleCount: number;
  requiredSampleCount: number;
  enrollmentComplete: boolean;
  remainingSamples: number;
};

/** Normalize verifier progress so a partial profile can resume but never classify. */
export function normalizeOwnerEnrollmentProgress(
  input: OwnerEnrollmentProgressInput,
  fallbackRequired = OWNER_ENROLLMENT_TARGET_SEGMENTS
): OwnerEnrollmentProgress {
  const reportedRequired = Math.trunc(Number(input.requiredSampleCount));
  const normalizedFallback = Math.trunc(Number(fallbackRequired));
  const requiredSampleCount = Number.isFinite(reportedRequired)
    ? Math.min(10, Math.max(2, reportedRequired))
    : Number.isFinite(normalizedFallback)
      ? Math.min(10, Math.max(2, normalizedFallback))
      : OWNER_ENROLLMENT_TARGET_SEGMENTS;
  const reportedCount = Math.trunc(Number(input.sampleCount));
  const sampleCount = Number.isFinite(reportedCount)
    ? Math.min(requiredSampleCount, Math.max(0, reportedCount))
    : 0;
  const enrollmentComplete = input.enrollmentComplete === true
    && sampleCount >= requiredSampleCount;
  return {
    sampleCount,
    requiredSampleCount,
    enrollmentComplete,
    remainingSamples: Math.max(0, requiredSampleCount - sampleCount)
  };
}

export type EnrollmentAudioSource = "rep" | "lead" | "unknown";

export type VoiceEnrollmentPhase =
  | "idle"
  | "checking"
  | "collecting"
  | "uploading"
  | "enrolled"
  | "unavailable"
  | "failed";

export type VoiceEnrollmentStatus = {
  phase: VoiceEnrollmentPhase;
  message: string;
  collectedSegments: number;
  uploadedSegments: number;
  targetSegments: number;
  /** The deterministic channel labels remain authoritative if verification fails. */
  fallback: "separate_channels";
};

export const INITIAL_VOICE_ENROLLMENT_STATUS: VoiceEnrollmentStatus = {
  phase: "idle",
  message: "Owner-voice enrollment has not started.",
  collectedSegments: 0,
  uploadedSegments: 0,
  targetSegments: OWNER_ENROLLMENT_TARGET_SEGMENTS,
  fallback: "separate_channels"
};

export function shouldCollectOwnerEnrollment(
  source: EnrollmentAudioSource,
  hasVerifiedSourceSeparation: boolean
): boolean {
  return hasVerifiedSourceSeparation && source === "rep";
}

export type CleanVoiceSegmentGateOptions = {
  sampleRate: number;
  maxSegments?: number;
  minDurationMs?: number;
  maxDurationMs?: number;
  silenceToFinishMs?: number;
  tailMs?: number;
  startRms?: number;
  continueRms?: number;
  minAverageRms?: number;
  minVoicedRatio?: number;
  maxClippedRatio?: number;
};

type RequiredGateOptions = Required<CleanVoiceSegmentGateOptions>;

const DEFAULT_GATE_OPTIONS = {
  maxSegments: OWNER_ENROLLMENT_TARGET_SEGMENTS,
  minDurationMs: 700,
  maxDurationMs: 6_000,
  silenceToFinishMs: 420,
  tailMs: 120,
  startRms: 0.018,
  continueRms: 0.012,
  minAverageRms: 0.012,
  minVoicedRatio: 0.3,
  maxClippedRatio: 0.008
} as const;

function validateGateOptions(options: CleanVoiceSegmentGateOptions): RequiredGateOptions {
  if (!Number.isFinite(options.sampleRate) || options.sampleRate < 8_000 || options.sampleRate > 192_000) {
    throw new Error("Audio sample rate is outside the supported range.");
  }
  const merged: RequiredGateOptions = { ...DEFAULT_GATE_OPTIONS, ...options };
  if (merged.maxSegments < 1 || merged.maxSegments > 10_000) {
    throw new Error("Voice segment capture count is outside the supported range.");
  }
  if (merged.minDurationMs < 300 || merged.maxDurationMs <= merged.minDurationMs || merged.maxDurationMs > 15_000) {
    throw new Error("Voice segment duration limits are invalid.");
  }
  return merged;
}

function rms(samples: Float32Array): number {
  if (!samples.length) return 0;
  let squared = 0;
  for (let index = 0; index < samples.length; index += 1) {
    squared += samples[index] * samples[index];
  }
  return Math.sqrt(squared / samples.length);
}

function concatenate(chunks: readonly Float32Array[], length: number): Float32Array {
  const output = new Float32Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    const remaining = length - offset;
    if (remaining <= 0) break;
    const copyLength = Math.min(chunk.length, remaining);
    output.set(chunk.subarray(0, copyLength), offset);
    offset += copyLength;
  }
  return output;
}

export type CleanMultichannelVoiceSegment = {
  /** The cleaner of the available channels, used for speaker verification. */
  mono: Float32Array;
  left: Float32Array;
  right: Float32Array | null;
  channelCount: 1 | 2;
};

/**
 * Runs one VAD boundary over both microphone channels so voice identity and
 * direction are calculated from the exact same utterance. A missing/malformed
 * second channel still yields mono verification but can never yield direction.
 */
export class CleanMultichannelVoiceSegmentGate {
  private readonly options: RequiredGateOptions;
  private readonly leftChunks: Float32Array[] = [];
  private readonly rightChunks: Float32Array[] = [];
  private activeSamples = 0;
  private voicedSamples = 0;
  private lastVoicedSample = 0;
  private emittedSegments = 0;
  private stereoAvailable = true;

  constructor(options: CleanVoiceSegmentGateOptions) {
    this.options = validateGateOptions(options);
  }

  push(leftInput: Float32Array, rightInput?: Float32Array | null): CleanMultichannelVoiceSegment[] {
    if (!leftInput.length || this.emittedSegments >= this.options.maxSegments) return [];
    const usableRight = rightInput?.length === leftInput.length ? rightInput : null;
    const level = Math.max(rms(leftInput), usableRight ? rms(usableRight) : 0);
    if (!this.activeSamples && level < this.options.startRms) return [];

    const left = new Float32Array(leftInput);
    this.leftChunks.push(left);
    if (usableRight) this.rightChunks.push(new Float32Array(usableRight));
    else this.stereoAvailable = false;
    this.activeSamples += left.length;
    if (level >= this.options.continueRms) {
      this.voicedSamples += left.length;
      this.lastVoicedSample = this.activeSamples;
    }

    const silenceSamples = this.activeSamples - this.lastVoicedSample;
    const silenceLimit = Math.round(this.options.sampleRate * this.options.silenceToFinishMs / 1_000);
    const maxSamples = Math.round(this.options.sampleRate * this.options.maxDurationMs / 1_000);
    if (silenceSamples < silenceLimit && this.activeSamples < maxSamples) return [];

    const segment = this.finishCurrent();
    return segment ? [segment] : [];
  }

  flush(): CleanMultichannelVoiceSegment[] {
    if (!this.activeSamples || this.emittedSegments >= this.options.maxSegments) return [];
    const segment = this.finishCurrent();
    return segment ? [segment] : [];
  }

  private finishCurrent(): CleanMultichannelVoiceSegment | null {
    const tailSamples = Math.round(this.options.sampleRate * this.options.tailMs / 1_000);
    const trimmedLength = Math.min(this.activeSamples, this.lastVoicedSample + tailSamples);
    const left = concatenate(this.leftChunks, trimmedLength);
    const right = this.stereoAvailable && this.rightChunks.length === this.leftChunks.length
      ? concatenate(this.rightChunks, trimmedLength)
      : null;
    const voicedRatio = this.activeSamples ? this.voicedSamples / this.activeSamples : 0;
    this.resetCurrent();

    const minSamples = Math.round(this.options.sampleRate * this.options.minDurationMs / 1_000);
    const mono = right && rms(right) > rms(left) ? new Float32Array(right) : new Float32Array(left);
    if (mono.length < minSamples || rms(mono) < this.options.minAverageRms || voicedRatio < this.options.minVoicedRatio) {
      return null;
    }

    let clippedSamples = 0;
    let inspectedSamples = mono.length;
    for (let index = 0; index < left.length; index += 1) {
      if (Math.abs(left[index]) >= 0.985) clippedSamples += 1;
      if (right && Math.abs(right[index]) >= 0.985) clippedSamples += 1;
    }
    if (right) inspectedSamples *= 2;
    if (clippedSamples / inspectedSamples > this.options.maxClippedRatio) return null;

    this.emittedSegments += 1;
    return {
      mono,
      left,
      right,
      channelCount: right ? 2 : 1
    };
  }

  private resetCurrent() {
    this.leftChunks.length = 0;
    this.rightChunks.length = 0;
    this.activeSamples = 0;
    this.voicedSamples = 0;
    this.lastVoicedSample = 0;
    this.stereoAvailable = true;
  }
}

/**
 * A small local VAD/quality gate used only for owner enrollment. It never stores
 * chunks outside memory and emits at most four bounded speech segments.
 */
export class CleanVoiceSegmentGate {
  private readonly multichannelGate: CleanMultichannelVoiceSegmentGate;

  constructor(options: CleanVoiceSegmentGateOptions) {
    this.multichannelGate = new CleanMultichannelVoiceSegmentGate(options);
  }

  push(input: Float32Array): Float32Array[] {
    return this.multichannelGate.push(input).map((segment) => segment.mono);
  }

  flush(): Float32Array[] {
    return this.multichannelGate.flush().map((segment) => segment.mono);
  }
}

export type EncodePcm16WavOptions = {
  targetSampleRate?: number;
  maxDurationSeconds?: number;
};

function resampleLinear(samples: Float32Array, inputSampleRate: number, targetSampleRate: number): Float32Array {
  if (inputSampleRate === targetSampleRate) return new Float32Array(samples);
  const outputLength = Math.max(1, Math.floor(samples.length * targetSampleRate / inputSampleRate));
  const output = new Float32Array(outputLength);
  const ratio = inputSampleRate / targetSampleRate;
  for (let index = 0; index < outputLength; index += 1) {
    const position = index * ratio;
    const left = Math.floor(position);
    const right = Math.min(samples.length - 1, left + 1);
    const fraction = position - left;
    output[index] = samples[left] * (1 - fraction) + samples[right] * fraction;
  }
  return output;
}

/** Encode bounded mono audio as the 16 kHz PCM16 WAV accepted by the verifier. */
export function encodePcm16Wav(
  samples: Float32Array,
  inputSampleRate: number,
  options: EncodePcm16WavOptions = {}
): Uint8Array {
  const targetSampleRate = options.targetSampleRate ?? 16_000;
  const maxDurationSeconds = options.maxDurationSeconds ?? 8;
  if (!samples.length) throw new Error("Cannot encode an empty voice segment.");
  if (!Number.isFinite(inputSampleRate) || inputSampleRate < 8_000 || inputSampleRate > 192_000) {
    throw new Error("Input sample rate is outside the supported range.");
  }
  if (!Number.isInteger(targetSampleRate) || targetSampleRate < 8_000 || targetSampleRate > 48_000) {
    throw new Error("Target sample rate is outside the supported range.");
  }
  const maxInputSamples = Math.floor(inputSampleRate * maxDurationSeconds);
  if (samples.length > maxInputSamples) throw new Error("Voice segment exceeds the enrollment duration limit.");

  const resampled = resampleLinear(samples, inputSampleRate, targetSampleRate);
  const dataLength = resampled.length * 2;
  const output = new Uint8Array(44 + dataLength);
  const view = new DataView(output.buffer);
  const writeAscii = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index += 1) view.setUint8(offset + index, value.charCodeAt(index));
  };

  writeAscii(0, "RIFF");
  view.setUint32(4, 36 + dataLength, true);
  writeAscii(8, "WAVE");
  writeAscii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, targetSampleRate, true);
  view.setUint32(28, targetSampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(36, "data");
  view.setUint32(40, dataLength, true);
  for (let index = 0; index < resampled.length; index += 1) {
    const clamped = Math.max(-1, Math.min(1, resampled[index]));
    view.setInt16(44 + index * 2, clamped < 0 ? Math.round(clamped * 32768) : Math.round(clamped * 32767), true);
  }
  return output;
}

export type OwnerVoiceCapture = {
  stop: () => void;
  sampleRate: number;
  channelCount: 1 | 2;
};

export type VoiceSegmentChannels = Pick<CleanMultichannelVoiceSegment, "left" | "right" | "channelCount">;

export function startOwnerVoiceSegmentCapture(options: {
  stream: MediaStream;
  onSegment: (
    segment: Float32Array,
    inputSampleRate: number,
    channels: VoiceSegmentChannels
  ) => void;
  onError?: (error: Error) => void;
  maxSegments?: number;
}): OwnerVoiceCapture {
  const AudioContextCtor = window.AudioContext || (window as typeof window & {
    webkitAudioContext?: typeof AudioContext;
  }).webkitAudioContext;
  if (!AudioContextCtor) throw new Error("Web Audio is unavailable; owner-voice enrollment was skipped.");

  const context = new AudioContextCtor();
  const source = context.createMediaStreamSource(options.stream);
  // Requiring a reported two-channel capture prevents Web Audio's automatic
  // mono-to-stereo duplication from masquerading as directional evidence.
  const reportedChannels = options.stream.getAudioTracks()[0]?.getSettings().channelCount;
  const channelCount: 1 | 2 = typeof reportedChannels === "number" && reportedChannels >= 2 ? 2 : 1;
  const processor = context.createScriptProcessor(2_048, channelCount, 1);
  const silentOutput = context.createGain();
  silentOutput.gain.value = 0;
  const gate = new CleanMultichannelVoiceSegmentGate({
    sampleRate: context.sampleRate,
    maxSegments: options.maxSegments ?? OWNER_ENROLLMENT_TARGET_SEGMENTS
  });
  let stopped = false;

  processor.onaudioprocess = (event) => {
    if (stopped) return;
    try {
      const left = event.inputBuffer.getChannelData(0);
      const right = channelCount === 2 && event.inputBuffer.numberOfChannels >= 2
        ? event.inputBuffer.getChannelData(1)
        : null;
      const segments = gate.push(left, right);
      for (const segment of segments) {
        options.onSegment(segment.mono, context.sampleRate, {
          left: segment.left,
          right: segment.right,
          channelCount: segment.channelCount
        });
      }
    } catch (error) {
      options.onError?.(error instanceof Error ? error : new Error("Owner-voice capture failed."));
    }
  };
  source.connect(processor);
  processor.connect(silentOutput);
  silentOutput.connect(context.destination);
  if (context.state === "suspended") void context.resume().catch((error: unknown) => {
    options.onError?.(error instanceof Error ? error : new Error("Web Audio could not start."));
  });

  const stop = () => {
    if (stopped) return;
    stopped = true;
    processor.onaudioprocess = null;
    source.disconnect();
    processor.disconnect();
    silentOutput.disconnect();
    void context.close();
  };
  return { stop, sampleRate: context.sampleRate, channelCount };
}
