export type AudioFrameCaptureBackend =
  | "audio_worklet"
  | "script_processor_fallback"
  | "unavailable";

export type CapturedAudioFrame = {
  left: Float32Array;
  right: Float32Array | null;
};

export type AudioFrameCapture = {
  backend: Exclude<AudioFrameCaptureBackend, "unavailable">;
  stop: () => void;
};

const WORKLET_MODULE_URL = "/audio-frame-processor.js";
const DEFAULT_FRAME_SIZE = 2_048;
const MAX_FRAME_BYTES = 1024 * 1024;

export function selectAudioFrameCaptureBackend(capabilities: {
  hasAudioWorklet: boolean;
  hasAudioWorkletNode: boolean;
  hasScriptProcessor: boolean;
}): AudioFrameCaptureBackend {
  if (capabilities.hasAudioWorklet && capabilities.hasAudioWorkletNode) {
    return "audio_worklet";
  }
  return capabilities.hasScriptProcessor
    ? "script_processor_fallback"
    : "unavailable";
}

export function decodeAudioFrameMessage(value: unknown): CapturedAudioFrame | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const message = value as { type?: unknown; channels?: unknown };
  if (message.type !== "audio_frame" || !Array.isArray(message.channels)) return null;
  if (message.channels.length < 1 || message.channels.length > 2) return null;
  if (!message.channels.every((channel) =>
    channel instanceof ArrayBuffer &&
    channel.byteLength > 0 &&
    channel.byteLength <= MAX_FRAME_BYTES &&
    channel.byteLength % Float32Array.BYTES_PER_ELEMENT === 0
  )) {
    return null;
  }
  const left = new Float32Array(message.channels[0]);
  const right = message.channels[1]
    ? new Float32Array(message.channels[1])
    : null;
  if (right && right.length !== left.length) return null;
  return { left, right };
}

export async function startAudioFrameCapture(options: {
  audioContext: AudioContext;
  source: AudioNode;
  channelCount: 1 | 2;
  onFrame: (frame: CapturedAudioFrame) => void;
  onError?: (error: Error) => void;
  frameSize?: number;
}): Promise<AudioFrameCapture> {
  const frameSize = options.frameSize ?? DEFAULT_FRAME_SIZE;
  if (
    !Number.isSafeInteger(frameSize) ||
    frameSize < 128 ||
    frameSize > 16_384
  ) {
    throw new Error("Audio frame size is outside the supported range.");
  }
  const hasWorklet = Boolean(options.audioContext.audioWorklet);
  const hasWorkletNode = typeof globalThis.AudioWorkletNode === "function";
  const hasScriptProcessor =
    typeof options.audioContext.createScriptProcessor === "function";
  const backend = selectAudioFrameCaptureBackend({
    hasAudioWorklet: hasWorklet,
    hasAudioWorkletNode: hasWorkletNode,
    hasScriptProcessor
  });

  if (backend === "audio_worklet") {
    try {
      return await startWorkletCapture({ ...options, frameSize });
    } catch (error) {
      if (!hasScriptProcessor) {
        options.onError?.(
          error instanceof Error
            ? error
            : new Error("AudioWorklet capture could not start.")
        );
        throw error;
      }
    }
  }
  if (!hasScriptProcessor) {
    throw new Error("This browser has no supported off-main-thread audio capture path.");
  }
  return startScriptProcessorFallback({ ...options, frameSize });
}

async function startWorkletCapture(options: {
  audioContext: AudioContext;
  source: AudioNode;
  channelCount: 1 | 2;
  onFrame: (frame: CapturedAudioFrame) => void;
  onError?: (error: Error) => void;
  frameSize: number;
}): Promise<AudioFrameCapture> {
  await options.audioContext.audioWorklet.addModule(WORKLET_MODULE_URL);
  const node = new AudioWorkletNode(
    options.audioContext,
    "live-rhetoric-audio-frame-processor",
    {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
      channelCount: options.channelCount,
      channelCountMode: "explicit",
      processorOptions: {
        frameSize: options.frameSize,
        channelCount: options.channelCount
      }
    }
  );
  const silentOutput = options.audioContext.createGain();
  silentOutput.gain.value = 0;
  let stopped = false;

  node.port.onmessage = (event: MessageEvent<unknown>) => {
    if (stopped) return;
    const frame = decodeAudioFrameMessage(event.data);
    if (!frame) return;
    try {
      options.onFrame(frame);
    } catch (error) {
      options.onError?.(
        error instanceof Error
          ? error
          : new Error("AudioWorklet frame consumer failed.")
      );
    }
  };
  node.onprocessorerror = () => {
    options.onError?.(new Error("AudioWorklet frame capture stopped unexpectedly."));
  };
  options.source.connect(node);
  node.connect(silentOutput);
  silentOutput.connect(options.audioContext.destination);

  return {
    backend: "audio_worklet",
    stop: () => {
      if (stopped) return;
      stopped = true;
      node.port.onmessage = null;
      node.port.postMessage({ type: "stop" });
      try {
        options.source.disconnect(node);
      } catch {
        // The source may already have been disconnected by capture teardown.
      }
      node.disconnect();
      silentOutput.disconnect();
    }
  };
}

function startScriptProcessorFallback(options: {
  audioContext: AudioContext;
  source: AudioNode;
  channelCount: 1 | 2;
  onFrame: (frame: CapturedAudioFrame) => void;
  onError?: (error: Error) => void;
  frameSize: number;
}): AudioFrameCapture {
  const processor = options.audioContext.createScriptProcessor(
    options.frameSize,
    options.channelCount,
    1
  );
  const silentOutput = options.audioContext.createGain();
  silentOutput.gain.value = 0;
  let stopped = false;

  processor.onaudioprocess = (event) => {
    if (stopped) return;
    try {
      const left = new Float32Array(event.inputBuffer.getChannelData(0));
      const right = options.channelCount === 2 &&
        event.inputBuffer.numberOfChannels >= 2
        ? new Float32Array(event.inputBuffer.getChannelData(1))
        : null;
      options.onFrame({ left, right });
    } catch (error) {
      options.onError?.(
        error instanceof Error
          ? error
          : new Error("Compatibility audio capture failed.")
      );
    }
  };
  options.source.connect(processor);
  processor.connect(silentOutput);
  silentOutput.connect(options.audioContext.destination);

  return {
    backend: "script_processor_fallback",
    stop: () => {
      if (stopped) return;
      stopped = true;
      processor.onaudioprocess = null;
      try {
        options.source.disconnect(processor);
      } catch {
        // The source may already have been disconnected by capture teardown.
      }
      processor.disconnect();
      silentOutput.disconnect();
    }
  };
}
