export type StreamingVadEventV2 =
  | "speech_started"
  | "speech_ended"
  | "speech_cancelled";

export type StreamingVadOptionsV2 = {
  sampleRate: number;
  minimumSpeechMs?: number;
  silenceToEndMs?: number;
  maximumSpeechMs?: number;
  minimumStartRms?: number;
  minimumContinueRms?: number;
  noiseFloorAlpha?: number;
};

function rms(samples: Float32Array): number {
  if (!samples.length) return 0;
  let sum = 0;
  for (let index = 0; index < samples.length; index += 1) {
    sum += samples[index] * samples[index];
  }
  return Math.sqrt(sum / samples.length);
}

export class StreamingVadV2 {
  private readonly sampleRate: number;
  private readonly minimumSpeechMs: number;
  private readonly silenceToEndMs: number;
  private readonly maximumSpeechMs: number;
  private readonly minimumStartRms: number;
  private readonly minimumContinueRms: number;
  private readonly noiseFloorAlpha: number;
  private isActive = false;
  private speechMs = 0;
  private voicedMs = 0;
  private silenceMs = 0;
  private adaptiveNoiseFloor = 0.004;

  constructor(options: StreamingVadOptionsV2) {
    if (
      !Number.isFinite(options.sampleRate) ||
      options.sampleRate < 8_000 ||
      options.sampleRate > 192_000
    ) {
      throw new Error("Streaming VAD sample rate is outside the supported range.");
    }
    this.sampleRate = options.sampleRate;
    this.minimumSpeechMs = options.minimumSpeechMs ?? 120;
    this.silenceToEndMs = options.silenceToEndMs ?? 460;
    this.maximumSpeechMs = options.maximumSpeechMs ?? 30_000;
    this.minimumStartRms = options.minimumStartRms ?? 0.012;
    this.minimumContinueRms = options.minimumContinueRms ?? 0.008;
    this.noiseFloorAlpha = options.noiseFloorAlpha ?? 0.05;
    if (
      this.minimumSpeechMs < 40 ||
      this.minimumSpeechMs > 5_000 ||
      this.silenceToEndMs < 100 ||
      this.silenceToEndMs > 5_000 ||
      this.maximumSpeechMs < this.minimumSpeechMs ||
      this.maximumSpeechMs > 120_000 ||
      this.minimumStartRms <= 0 ||
      this.minimumContinueRms <= 0 ||
      this.noiseFloorAlpha <= 0 ||
      this.noiseFloorAlpha > 1
    ) {
      throw new Error("Streaming VAD options are invalid.");
    }
  }

  push(samples: Float32Array): StreamingVadEventV2[] {
    if (!samples.length) return [];
    const durationMs = samples.length * 1_000 / this.sampleRate;
    const level = rms(samples);
    const startThreshold = Math.max(
      this.minimumStartRms,
      this.adaptiveNoiseFloor * 3
    );
    const continueThreshold = Math.max(
      this.minimumContinueRms,
      this.adaptiveNoiseFloor * 2
    );

    if (!this.isActive) {
      if (level < startThreshold) {
        this.adaptiveNoiseFloor =
          this.adaptiveNoiseFloor * (1 - this.noiseFloorAlpha) +
          level * this.noiseFloorAlpha;
        return [];
      }
      this.isActive = true;
      this.speechMs = durationMs;
      this.voicedMs = durationMs;
      this.silenceMs = 0;
      return ["speech_started"];
    }

    this.speechMs += durationMs;
    if (level >= continueThreshold) {
      this.voicedMs += durationMs;
      this.silenceMs = 0;
    } else {
      this.silenceMs += durationMs;
    }

    if (this.speechMs >= this.maximumSpeechMs) {
      this.reset();
      return ["speech_ended"];
    }
    if (this.silenceMs < this.silenceToEndMs) return [];

    const event: StreamingVadEventV2 =
      this.voicedMs >= this.minimumSpeechMs
        ? "speech_ended"
        : "speech_cancelled";
    this.reset();
    return [event];
  }

  reset(): void {
    this.isActive = false;
    this.speechMs = 0;
    this.voicedMs = 0;
    this.silenceMs = 0;
  }

  get active(): boolean {
    return this.isActive;
  }

  get elapsedSpeechMs(): number {
    return this.speechMs;
  }

  get noiseFloor(): number {
    return this.adaptiveNoiseFloor;
  }
}
