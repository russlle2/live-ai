const DEFAULT_MAX_AUDIO_BYTES = 512 * 1024;
const MAX_RESPONSE_BYTES = 64 * 1024;

export type SpeakerServiceHealth = {
  enabled: boolean;
  status: "ok" | "degraded" | "disabled" | "unavailable";
  ownerProfile: "enrolled" | "enrolling" | "deleting" | "not_enrolled" | "incompatible" | "invalid" | "unknown";
  modelId?: string;
  modelRevision?: string;
  modelLoaded?: boolean;
  sampleCount: number;
  requiredSampleCount: number;
  enrollmentComplete: boolean;
  decisionPolicy: "owner_or_unknown_only";
};

export type SpeakerEnrollmentResult = {
  accepted: true;
  enrolled: boolean;
  modelId: string;
  modelRevision: string;
  sampleCount: number;
  requiredSampleCount: number;
  enrollmentComplete: boolean;
  audioSeconds: number;
  replacedIncompatibleProfile: boolean;
  rawAudioStored: false;
};

export type SpeakerClassificationResult = {
  label: "owner" | "unknown";
  similarity: number | null;
  threshold: number | null;
  reason: string;
  audioSeconds: number | null;
  decisionPolicy: "owner_or_unknown_only";
  serviceAvailable: boolean;
};

export class SpeakerServiceError extends Error {
  readonly status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = "SpeakerServiceError";
    this.status = status;
  }
}

export type SpeakerServiceClientOptions = {
  baseUrl?: string;
  token?: string;
  timeoutMs?: number;
  maxAudioBytes?: number;
  fetchImpl?: typeof fetch;
};

function boundedInteger(value: string | undefined, fallback: number, minimum: number, maximum: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.trunc(parsed)));
}

function normalizeBaseUrl(value: string | undefined): string {
  const trimmed = value?.trim();
  if (!trimmed) return "";
  const url = new URL(trimmed);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("SPEAKER_SERVICE_URL must use http or https.");
  }
  return url.toString().replace(/\/$/, "");
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function copiedArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const output = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(output).set(bytes);
  return output;
}

async function readBoundedJson(response: Response): Promise<Record<string, unknown>> {
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_RESPONSE_BYTES) {
    throw new SpeakerServiceError("Speaker service response exceeded its size limit.", 502);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > MAX_RESPONSE_BYTES) {
    throw new SpeakerServiceError("Speaker service response exceeded its size limit.", 502);
  }
  try {
    return asRecord(JSON.parse(new TextDecoder().decode(bytes)));
  } catch {
    throw new SpeakerServiceError("Speaker service returned invalid JSON.", 502);
  }
}

function errorDetail(payload: Record<string, unknown>): string | undefined {
  if (typeof payload.detail === "string") return payload.detail;
  if (typeof payload.message === "string") return payload.message;
  return undefined;
}

export class SpeakerServiceClient {
  readonly enabled: boolean;
  readonly maxAudioBytes: number;
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: SpeakerServiceClientOptions = {}) {
    this.baseUrl = normalizeBaseUrl(options.baseUrl ?? process.env.SPEAKER_SERVICE_URL);
    this.enabled = Boolean(this.baseUrl);
    this.token = (options.token ?? process.env.SPEAKER_SERVICE_API_TOKEN ?? "").trim();
    this.timeoutMs = options.timeoutMs ?? boundedInteger(process.env.SPEAKER_SERVICE_TIMEOUT_MS, 6_000, 500, 30_000);
    this.maxAudioBytes = options.maxAudioBytes ?? boundedInteger(
      process.env.SPEAKER_SERVICE_MAX_PAYLOAD_BYTES,
      DEFAULT_MAX_AUDIO_BYTES,
      44,
      8 * 1024 * 1024
    );
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async health(): Promise<SpeakerServiceHealth> {
    if (!this.enabled) {
      return {
        enabled: false,
        status: "disabled",
        ownerProfile: "unknown",
        sampleCount: 0,
        requiredSampleCount: 3,
        enrollmentComplete: false,
        decisionPolicy: "owner_or_unknown_only"
      };
    }
    try {
      const payload = await this.request("/health", { method: "GET" });
      const status = payload.status === "ok" ? "ok" : "degraded";
      const ownerProfile = payload.ownerProfile === "enrolled"
        || payload.ownerProfile === "enrolling"
        || payload.ownerProfile === "deleting"
        || payload.ownerProfile === "not_enrolled"
        || payload.ownerProfile === "incompatible"
        || payload.ownerProfile === "invalid"
        ? payload.ownerProfile
        : "unknown";
      const sampleCount = Math.max(0, Math.trunc(finiteNumber(payload.sampleCount) ?? 0));
      const requiredSampleCount = Math.max(2, Math.trunc(finiteNumber(payload.requiredSampleCount) ?? 3));
      return {
        enabled: true,
        status,
        ownerProfile,
        ...(typeof payload.modelId === "string" ? { modelId: payload.modelId } : {}),
        ...(typeof payload.modelRevision === "string" ? { modelRevision: payload.modelRevision } : {}),
        ...(typeof payload.modelLoaded === "boolean" ? { modelLoaded: payload.modelLoaded } : {}),
        sampleCount,
        requiredSampleCount,
        enrollmentComplete: payload.enrollmentComplete === true
          && ownerProfile === "enrolled"
          && sampleCount >= requiredSampleCount,
        decisionPolicy: "owner_or_unknown_only"
      };
    } catch {
      return {
        enabled: true,
        status: "unavailable",
        ownerProfile: "unknown",
        sampleCount: 0,
        requiredSampleCount: 3,
        enrollmentComplete: false,
        decisionPolicy: "owner_or_unknown_only"
      };
    }
  }

  async enroll(wav: Uint8Array): Promise<SpeakerEnrollmentResult> {
    this.assertAudioPayload(wav);
    if (!this.enabled) throw new SpeakerServiceError("Speaker verification is not configured.", 503);
    const payload = await this.request("/v1/owner/enroll", {
      method: "POST",
      headers: { "Content-Type": "audio/wav" },
      body: copiedArrayBuffer(wav)
    });
    if (payload.accepted !== true && payload.enrolled !== true) {
      throw new SpeakerServiceError("Speaker service did not accept the enrollment sample.", 502);
    }
    const sampleCount = Math.max(1, Math.trunc(finiteNumber(payload.sampleCount) ?? 1));
    const requiredSampleCount = Math.max(2, Math.trunc(finiteNumber(payload.requiredSampleCount) ?? 3));
    const enrollmentComplete = payload.enrollmentComplete === true
      && payload.enrolled === true
      && sampleCount >= requiredSampleCount;
    return {
      accepted: true,
      enrolled: enrollmentComplete,
      modelId: typeof payload.modelId === "string" ? payload.modelId : "unknown",
      modelRevision: typeof payload.modelRevision === "string" ? payload.modelRevision : "unknown",
      sampleCount,
      requiredSampleCount,
      enrollmentComplete,
      audioSeconds: Math.max(0, finiteNumber(payload.audioSeconds) ?? 0),
      replacedIncompatibleProfile: payload.replacedIncompatibleProfile === true,
      rawAudioStored: false
    };
  }

  async deleteEnrollment(): Promise<{ deleted: boolean; ownerProfile: "not_enrolled" }> {
    if (!this.enabled) return { deleted: false, ownerProfile: "not_enrolled" };
    const payload = await this.request("/v1/owner", { method: "DELETE" });
    if (payload.ownerProfile !== "not_enrolled") {
      throw new SpeakerServiceError("Speaker service did not confirm enrollment deletion.", 502);
    }
    return { deleted: payload.deleted === true, ownerProfile: "not_enrolled" };
  }

  /**
   * Classify fails closed. A response is owner only when the service supplies an
   * owner_match at or above its own threshold; malformed, low-confidence, and
   * unavailable results are all unknown and can never become "other".
   */
  async classify(wav: Uint8Array): Promise<SpeakerClassificationResult> {
    this.assertAudioPayload(wav);
    if (!this.enabled) return this.unknownClassification("service_disabled", false);
    try {
      const payload = await this.request("/v1/segments/classify", {
        method: "POST",
        headers: { "Content-Type": "audio/wav" },
        body: copiedArrayBuffer(wav)
      });
      const similarity = finiteNumber(payload.similarity);
      const threshold = finiteNumber(payload.threshold);
      const confidentOwner = payload.label === "owner"
        && payload.reason === "owner_match"
        && similarity !== null
        && threshold !== null
        && similarity >= threshold;
      return {
        label: confidentOwner ? "owner" : "unknown",
        similarity,
        threshold,
        reason: confidentOwner
          ? "owner_match"
          : typeof payload.reason === "string" ? payload.reason : "invalid_service_response",
        audioSeconds: finiteNumber(payload.audioSeconds),
        decisionPolicy: "owner_or_unknown_only",
        serviceAvailable: true
      };
    } catch {
      return this.unknownClassification("service_unavailable", false);
    }
  }

  private unknownClassification(reason: string, serviceAvailable: boolean): SpeakerClassificationResult {
    return {
      label: "unknown",
      similarity: null,
      threshold: null,
      reason,
      audioSeconds: null,
      decisionPolicy: "owner_or_unknown_only",
      serviceAvailable
    };
  }

  private assertAudioPayload(wav: Uint8Array) {
    if (!(wav instanceof Uint8Array) || wav.byteLength < 44) {
      throw new SpeakerServiceError("A non-empty PCM WAV body is required.", 400);
    }
    if (wav.byteLength > this.maxAudioBytes) {
      throw new SpeakerServiceError("Audio body exceeds the speaker-service proxy limit.", 413);
    }
  }

  private async request(path: string, init: RequestInit): Promise<Record<string, unknown>> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const headers = new Headers(init.headers);
      headers.set("Accept", "application/json");
      if (this.token) headers.set("Authorization", `Bearer ${this.token}`);
      const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        ...init,
        headers,
        signal: controller.signal
      });
      const payload = await readBoundedJson(response);
      if (!response.ok) {
        throw new SpeakerServiceError(
          errorDetail(payload) ?? `Speaker service request failed (${response.status}).`,
          response.status
        );
      }
      return payload;
    } catch (error) {
      if (error instanceof SpeakerServiceError) throw error;
      if (controller.signal.aborted) throw new SpeakerServiceError("Speaker service request timed out.", 504);
      throw new SpeakerServiceError("Speaker service is unavailable.", 502);
    } finally {
      clearTimeout(timeout);
    }
  }
}

export function createSpeakerServiceClient(options: SpeakerServiceClientOptions = {}): SpeakerServiceClient {
  return new SpeakerServiceClient(options);
}
