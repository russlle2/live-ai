class LiveRhetoricAudioFrameProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const requestedSize = Number(options.processorOptions?.frameSize);
    const requestedChannels = Number(options.processorOptions?.channelCount);
    this.frameSize = Number.isSafeInteger(requestedSize)
      ? Math.min(16384, Math.max(128, requestedSize))
      : 2048;
    this.requestedChannels = requestedChannels === 2 ? 2 : 1;
    this.channels = 0;
    this.buffers = [];
    this.offset = 0;
    this.stopped = false;
    this.port.onmessage = (event) => {
      if (event.data?.type === "stop") this.stopped = true;
    };
  }

  reset(channelCount) {
    this.channels = channelCount;
    this.buffers = Array.from(
      { length: channelCount },
      () => new Float32Array(this.frameSize)
    );
    this.offset = 0;
  }

  emit() {
    const channels = this.buffers.map((buffer) => buffer.buffer);
    this.port.postMessage({ type: "audio_frame", channels }, channels);
    this.reset(this.channels);
  }

  process(inputs, outputs) {
    if (this.stopped) return false;
    const input = inputs[0];
    const output = outputs[0];
    for (const channel of output ?? []) channel.fill(0);
    if (!input?.[0]?.length) return true;

    const channelCount = Math.min(this.requestedChannels, input.length);
    if (channelCount !== this.channels) this.reset(channelCount);
    let inputOffset = 0;
    const inputLength = input[0].length;
    while (inputOffset < inputLength) {
      const count = Math.min(
        inputLength - inputOffset,
        this.frameSize - this.offset
      );
      for (let channel = 0; channel < channelCount; channel += 1) {
        this.buffers[channel].set(
          input[channel].subarray(inputOffset, inputOffset + count),
          this.offset
        );
      }
      this.offset += count;
      inputOffset += count;
      if (this.offset === this.frameSize) this.emit();
    }
    return true;
  }
}

registerProcessor(
  "live-rhetoric-audio-frame-processor",
  LiveRhetoricAudioFrameProcessor
);
