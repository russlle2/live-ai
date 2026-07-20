import { describe, expect, it, vi } from "vitest";
import {
  LocalSttClient,
  LocalSttError
} from "./local_stt_service.js";

function wavBytes(length = 128): Uint8Array {
  const bytes = new Uint8Array(length);
  bytes.set(new TextEncoder().encode("RIFF"), 0);
  bytes.set(new TextEncoder().encode("WAVE"), 8);
  return bytes;
}

describe("LocalSttClient", () => {
  it("reports disabled without a complete local configuration", async () => {
    const client = new LocalSttClient({ baseUrl: "", model: "" });
    await expect(client.status()).resolves.toEqual({
      configured: false,
      available: false,
      model: null
    });
  });

  it("checks a loopback model endpoint with a bounded request", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ data: [{ id: "large-v3-turbo" }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      })
    );
    const client = new LocalSttClient({
      baseUrl: "http://127.0.0.1:8178/v1",
      model: "large-v3-turbo",
      fetchImpl
    });

    await expect(client.status()).resolves.toEqual({
      configured: true,
      available: true,
      model: "large-v3-turbo"
    });
    expect(fetchImpl.mock.calls[0]?.[0]).toBe("http://127.0.0.1:8178/v1/models");
  });

  it("sends transient WAV data through the OpenAI-compatible transcription endpoint", async () => {
    let submitted: FormData | undefined;
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
      submitted = init?.body as FormData;
      return new Response(JSON.stringify({ text: "Local transcript result." }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    });
    const client = new LocalSttClient({
      baseUrl: "http://localhost:8178/v1/",
      model: "large-v3-turbo",
      fetchImpl
    });

    await expect(client.transcribe(wavBytes(), { language: "en" }))
      .resolves.toEqual({ text: "Local transcript result.", model: "large-v3-turbo" });
    expect(fetchImpl.mock.calls[0]?.[0]).toBe(
      "http://localhost:8178/v1/audio/transcriptions"
    );
    expect(submitted?.get("model")).toBe("large-v3-turbo");
    expect(submitted?.get("language")).toBe("en");
    expect(submitted?.get("file")).toBeInstanceOf(Blob);
  });

  it("rejects invalid audio before any network request", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const client = new LocalSttClient({
      baseUrl: "http://127.0.0.1:8178/v1",
      model: "large-v3-turbo",
      maxAudioBytes: 64,
      fetchImpl
    });
    await expect(client.transcribe(wavBytes(65))).rejects.toMatchObject({
      status: 413
    } satisfies Partial<LocalSttError>);
    await expect(client.transcribe(new Uint8Array(20))).rejects.toMatchObject({
      status: 400
    } satisfies Partial<LocalSttError>);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("fails closed for non-loopback endpoints and malformed responses", async () => {
    expect(() => new LocalSttClient({
      baseUrl: "http://192.168.1.20:8178/v1",
      model: "large-v3-turbo"
    })).toThrow(/loopback/i);

    const client = new LocalSttClient({
      baseUrl: "http://127.0.0.1:8178/v1",
      model: "large-v3-turbo",
      fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(
        new Response(JSON.stringify({ text: "" }), { status: 200 })
      )
    });
    await expect(client.transcribe(wavBytes())).rejects.toMatchObject({
      status: 502
    } satisfies Partial<LocalSttError>);
  });
});
