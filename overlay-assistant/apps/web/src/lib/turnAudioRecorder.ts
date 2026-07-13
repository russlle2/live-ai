export type RecordedTurnAudio = {
  mono: Float32Array;
  left: Float32Array;
  right: Float32Array | null;
  sampleRate: number;
  channelCount: 1 | 2;
  durationMs: number;
};

export type TurnAudioRecorderOptions = {
  sampleRate: number;
  channelCount: 1 | 2;
  preRollMs?: number;
  maxDurationMs?: number;
};

function concatenate(chunks: readonly Float32Array[], length: number): Float32Array {
  const output = new Float32Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    const count = Math.min(chunk.length, length - offset);
    if (count <= 0) break;
    output.set(chunk.subarray(0, count), offset);
    offset += count;
  }
  return output;
}

function rms(samples: Float32Array): number {
  if (!samples.length) return 0;
  let sum = 0;
  for (let index = 0; index < samples.length; index += 1) sum += samples[index] * samples[index];
  return Math.sqrt(sum / samples.length);
}

/**
 * A bounded in-memory recorder controlled by the same VAD that commits the
 * Realtime turn. This prevents an independently segmented voice clip from being
 * paired with the wrong transcript. No samples are persisted by this class.
 */
export class SynchronizedTurnAudioRecorder {
  readonly sampleRate: number;
  readonly channelCount: 1 | 2;
  private readonly preRollCapacity: number;
  private readonly maxSamples: number;
  private readonly preLeft: Float32Array;
  private readonly preRight: Float32Array | null;
  private preWriteIndex = 0;
  private preLength = 0;
  private active = false;
  private stereoAvailable: boolean;
  private activeSamples = 0;
  private readonly leftChunks: Float32Array[] = [];
  private readonly rightChunks: Float32Array[] = [];

  constructor(options: TurnAudioRecorderOptions) {
    if (!Number.isFinite(options.sampleRate) || options.sampleRate < 8_000 || options.sampleRate > 192_000) {
      throw new Error("Turn recorder sample rate is outside the supported range.");
    }
    const preRollMs = options.preRollMs ?? 150;
    const maxDurationMs = options.maxDurationMs ?? 8_000;
    if (preRollMs < 0 || preRollMs > 500 || maxDurationMs < 600 || maxDurationMs > 15_000) {
      throw new Error("Turn recorder duration settings are invalid.");
    }
    this.sampleRate = options.sampleRate;
    this.channelCount = options.channelCount;
    this.preRollCapacity = Math.round(options.sampleRate * preRollMs / 1_000);
    this.maxSamples = Math.round(options.sampleRate * maxDurationMs / 1_000);
    this.preLeft = new Float32Array(this.preRollCapacity);
    this.preRight = options.channelCount === 2 ? new Float32Array(this.preRollCapacity) : null;
    this.stereoAvailable = options.channelCount === 2;
  }

  push(leftInput: Float32Array, rightInput?: Float32Array | null): void {
    if (!leftInput.length) return;
    const right = this.channelCount === 2 && rightInput?.length === leftInput.length ? rightInput : null;
    if (this.channelCount === 2 && !right) this.stereoAvailable = false;

    if (this.active && this.activeSamples < this.maxSamples) {
      const count = Math.min(leftInput.length, this.maxSamples - this.activeSamples);
      this.leftChunks.push(new Float32Array(leftInput.subarray(0, count)));
      if (right && this.stereoAvailable) this.rightChunks.push(new Float32Array(right.subarray(0, count)));
      this.activeSamples += count;
    }

    for (let index = 0; index < leftInput.length && this.preRollCapacity > 0; index += 1) {
      this.preLeft[this.preWriteIndex] = leftInput[index];
      if (this.preRight) this.preRight[this.preWriteIndex] = right?.[index] ?? 0;
      this.preWriteIndex = (this.preWriteIndex + 1) % this.preRollCapacity;
      this.preLength = Math.min(this.preRollCapacity, this.preLength + 1);
    }
  }

  begin(): void {
    if (this.active) return;
    this.active = true;
    this.activeSamples = 0;
    this.leftChunks.length = 0;
    this.rightChunks.length = 0;
    this.stereoAvailable = this.channelCount === 2;
    if (!this.preLength) return;

    const left = this.copyPreRoll(this.preLeft);
    this.leftChunks.push(left);
    if (this.preRight) this.rightChunks.push(this.copyPreRoll(this.preRight));
    this.activeSamples = left.length;
  }

  finish(): RecordedTurnAudio | null {
    if (!this.active || !this.activeSamples) {
      this.cancel();
      return null;
    }
    const left = concatenate(this.leftChunks, this.activeSamples);
    const right = this.stereoAvailable && this.channelCount === 2 && this.rightChunks.length === this.leftChunks.length
      ? concatenate(this.rightChunks, this.activeSamples)
      : null;
    const mono = right && rms(right) > rms(left) ? new Float32Array(right) : new Float32Array(left);
    this.cancel();
    return {
      mono,
      left,
      right,
      sampleRate: this.sampleRate,
      channelCount: right ? 2 : 1,
      durationMs: mono.length * 1_000 / this.sampleRate
    };
  }

  cancel(): void {
    this.active = false;
    this.activeSamples = 0;
    this.leftChunks.length = 0;
    this.rightChunks.length = 0;
    this.stereoAvailable = this.channelCount === 2;
  }

  private copyPreRoll(channel: Float32Array): Float32Array {
    const output = new Float32Array(this.preLength);
    const start = (this.preWriteIndex - this.preLength + this.preRollCapacity) % Math.max(1, this.preRollCapacity);
    for (let index = 0; index < this.preLength; index += 1) {
      output[index] = channel[(start + index) % this.preRollCapacity];
    }
    return output;
  }
}
