import { validateLocalAiBaseUrl } from "../../openai/client.js";

const DEFAULT_MAX_AUDIO_BYTES = 8 * 1024 * 1024;
const MAX_RESPONSE_BYTES = 64 * 1024;

export class LocalSttError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = "LocalSttError";
  }
}

export class LocalSttClient {
  readonly configured: boolean;
  readonly maxAudioBytes: number;
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: {
    baseUrl?: string;
    model?: string;
    apiKey?: string;
    timeoutMs?: number;
    maxAudioBytes?: number;
    fetchImpl?: typeof fetch;
  }) {
    const baseUrl = options.baseUrl?.trim() ?? "";
    const model = options.model?.trim() ?? "";
    if (Boolean(baseUrl) !== Boolean(model)) {
      throw new Error(
        "LOCAL_STT_BASE_URL and LOCAL_STT_MODEL must either both be set or both be omitted"
      );
    }
    this.baseUrl = baseUrl ? validateLocalAiBaseUrl(baseUrl) : "";
    this.model = model;
    this.configured = Boolean(this.baseUrl && this.model);
    this.apiKey = options.apiKey?.trim() ?? "";
    this.timeoutMs = boundedInteger(options.timeoutMs ?? 15_000, 250, 120_000);
    this.maxAudioBytes = boundedInteger(
      options.maxAudioBytes ?? DEFAULT_MAX_AUDIO_BYTES,
      44,
      64 * 1024 * 1024
    );
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async status(): Promise<{
    configured: boolean;
    available: boolean;
    model: string | null;
  }> {
    if (!this.configured) {
      return { configured: false, available: false, model: null };
    }
    try {
      const response = await this.request(
        "/models",
        { method: "GET" },
        Math.min(this.timeoutMs, 1_500)
      );
      await readBoundedJson(response);
      return {
        configured: true,
        available: response.ok,
        model: this.model
      };
    } catch {
      return {
        configured: true,
        available: false,
        model: this.model
      };
    }
  }

  async transcribe(
    wav: Uint8Array,
    options: { language?: string } = {}
  ): Promise<{ text: string; model: string }> {
    this.assertWav(wav);
    if (!this.configured) {
      throw new LocalSttError("Local transcription is not configured", 503);
    }
    const form = new FormData();
    const copied = new Uint8Array(wav.byteLength);
    copied.set(wav);
    form.set("file", new Blob([copied], { type: "audio/wav" }), "turn.wav");
    form.set("model", this.model);
    form.set("response_format", "json");
    if (options.language) form.set("language", options.language.slice(0, 16));

    const response = await this.request("/audio/transcriptions", {
      method: "POST",
      body: form
    });
    const payload = await readBoundedJson(response);
    if (!response.ok) {
      throw new LocalSttError(
        errorDetail(payload) ?? `Local transcription failed (${response.status})`,
        response.status
      );
    }
    const text = typeof payload.text === "string"
      ? payload.text.trim().slice(0, 20_000)
      : "";
    if (!text) {
      throw new LocalSttError(
        "Local transcription returned no usable text",
        502
      );
    }
    return { text, model: this.model };
  }

  private async request(
    path: string,
    init: RequestInit,
    timeoutMs = this.timeoutMs
  ): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const headers = new Headers(init.headers);
      headers.set("Accept", "application/json");
      if (this.apiKey) headers.set("Authorization", `Bearer ${this.apiKey}`);
      return await this.fetchImpl(`${this.baseUrl}${path}`, {
        ...init,
        headers,
        signal: controller.signal
      });
    } catch (error) {
      if (controller.signal.aborted) {
        throw new LocalSttError("Local transcription timed out", 504);
      }
      if (error instanceof LocalSttError) throw error;
      throw new LocalSttError("Local transcription service is unavailable", 502);
    } finally {
      clearTimeout(timeout);
    }
  }

  private assertWav(wav: Uint8Array): void {
    if (!(wav instanceof Uint8Array) || wav.byteLength < 44) {
      throw new LocalSttError("A PCM WAV body is required", 400);
    }
    if (wav.byteLength > this.maxAudioBytes) {
      throw new LocalSttError("Audio exceeds the local STT limit", 413);
    }
    const decoder = new TextDecoder();
    if (
      decoder.decode(wav.subarray(0, 4)) !== "RIFF" ||
      decoder.decode(wav.subarray(8, 12)) !== "WAVE"
    ) {
      throw new LocalSttError("A valid PCM WAV body is required", 400);
    }
  }
}

async function readBoundedJson(
  response: Response
): Promise<Record<string, unknown>> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) {
    await response.body?.cancel().catch(() => undefined);
    throw new LocalSttError("Local STT response exceeded its size limit", 502);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > MAX_RESPONSE_BYTES) {
    throw new LocalSttError("Local STT response exceeded its size limit", 502);
  }
  try {
    const value = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
    return value && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown>
      : {};
  } catch {
    throw new LocalSttError("Local STT returned invalid JSON", 502);
  }
}

function errorDetail(payload: Record<string, unknown>): string | undefined {
  if (typeof payload.error === "string") return payload.error.slice(0, 300);
  if (typeof payload.detail === "string") return payload.detail.slice(0, 300);
  const nested = payload.error;
  if (
    nested &&
    typeof nested === "object" &&
    typeof (nested as { message?: unknown }).message === "string"
  ) {
    return String((nested as { message: string }).message).slice(0, 300);
  }
  return undefined;
}

function boundedInteger(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) return minimum;
  return Math.min(maximum, Math.max(minimum, Math.trunc(value)));
}
