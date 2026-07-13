import { describe, expect, it, vi } from "vitest";
import { SpeakerServiceClient, SpeakerServiceError } from "./speaker_service.js";

function wavBytes(length = 128): Uint8Array {
  const bytes = new Uint8Array(length);
  bytes.set(new TextEncoder().encode("RIFF"), 0);
  bytes.set(new TextEncoder().encode("WAVE"), 8);
  return bytes;
}

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

describe("SpeakerServiceClient", () => {
  it("forwards optional authorization to health", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
      status: "ok",
      ownerProfile: "enrolled",
      modelId: "test/model",
      modelRevision: "deadbeef",
      sampleCount: 3,
      requiredSampleCount: 3,
      enrollmentComplete: true,
      modelLoaded: true
    }));
    const client = new SpeakerServiceClient({
      baseUrl: "http://speaker.internal/",
      token: "secret-token",
      fetchImpl
    });
    await expect(client.health()).resolves.toMatchObject({ enabled: true, status: "ok", ownerProfile: "enrolled" });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("http://speaker.internal/health");
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer secret-token");
  });

  it("preserves an accepted partial enrollment for browser resume", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
      accepted: true,
      enrolled: false,
      enrollmentComplete: false,
      modelId: "test/model",
      modelRevision: "deadbeef",
      sampleCount: 2,
      requiredSampleCount: 3,
      audioSeconds: 1.1,
      replacedIncompatibleProfile: false,
      rawAudioStored: false
    }));
    const client = new SpeakerServiceClient({ baseUrl: "http://speaker.internal", fetchImpl });
    await expect(client.enroll(wavBytes())).resolves.toMatchObject({
      accepted: true,
      enrolled: false,
      enrollmentComplete: false,
      sampleCount: 2,
      requiredSampleCount: 3
    });
  });

  it("rejects an oversized enrollment before making a network request", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const client = new SpeakerServiceClient({
      baseUrl: "http://speaker.internal",
      maxAudioBytes: 64,
      fetchImpl
    });
    await expect(client.enroll(wavBytes(65))).rejects.toMatchObject({ status: 413 } satisfies Partial<SpeakerServiceError>);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("deletes the owner enrollment through the authenticated private service", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
      deleted: true,
      ownerProfile: "not_enrolled"
    }));
    const client = new SpeakerServiceClient({
      baseUrl: "http://speaker.internal",
      token: "private-speaker-token",
      fetchImpl
    });
    await expect(client.deleteEnrollment()).resolves.toEqual({
      deleted: true,
      ownerProfile: "not_enrolled"
    });
    expect(fetchImpl.mock.calls[0]?.[0]).toBe("http://speaker.internal/v1/owner");
    expect(fetchImpl.mock.calls[0]?.[1]?.method).toBe("DELETE");
    expect(new Headers(fetchImpl.mock.calls[0]?.[1]?.headers).get("Authorization"))
      .toBe("Bearer private-speaker-token");
  });

  it("accepts only an explicit above-threshold owner match", async () => {
    const lowConfidence = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
      label: "owner",
      similarity: 0.72,
      threshold: 0.9,
      reason: "owner_match",
      audioSeconds: 1.2
    }));
    const lowClient = new SpeakerServiceClient({ baseUrl: "http://speaker.internal", fetchImpl: lowConfidence });
    await expect(lowClient.classify(wavBytes())).resolves.toMatchObject({
      label: "unknown",
      decisionPolicy: "owner_or_unknown_only"
    });

    const highConfidence = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
      label: "owner",
      similarity: 0.94,
      threshold: 0.9,
      reason: "owner_match",
      audioSeconds: 1.2
    }));
    const highClient = new SpeakerServiceClient({ baseUrl: "http://speaker.internal", fetchImpl: highConfidence });
    await expect(highClient.classify(wavBytes())).resolves.toMatchObject({ label: "owner", serviceAvailable: true });
  });

  it("turns invalid labels and service failures into unknown", async () => {
    const invalid = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
      label: "other",
      similarity: 0.99,
      threshold: 0.9,
      reason: "owner_match"
    }));
    const invalidClient = new SpeakerServiceClient({ baseUrl: "http://speaker.internal", fetchImpl: invalid });
    await expect(invalidClient.classify(wavBytes())).resolves.toMatchObject({ label: "unknown" });

    const unavailable = vi.fn<typeof fetch>().mockRejectedValue(new Error("offline"));
    const unavailableClient = new SpeakerServiceClient({ baseUrl: "http://speaker.internal", fetchImpl: unavailable });
    await expect(unavailableClient.classify(wavBytes())).resolves.toMatchObject({
      label: "unknown",
      reason: "service_unavailable",
      serviceAvailable: false
    });
  });
});
