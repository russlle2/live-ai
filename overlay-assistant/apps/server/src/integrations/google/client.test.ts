import { describe, expect, it } from "vitest";
import { GoogleApiError, GoogleReadonlyClient } from "./client.js";
import type { GoogleOAuthManager } from "./oauth.js";

function fakeOAuth(): GoogleOAuthManager {
  return { getAccessToken: async () => "test-token" } as GoogleOAuthManager;
}

describe("bounded Google transport", () => {
  it("aborts a chunked Drive body as soon as its byte limit is exceeded", async () => {
    const fetchImpl = (async () => new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(700));
        controller.enqueue(new Uint8Array(700));
        controller.close();
      }
    }))) as typeof fetch;
    const client = new GoogleReadonlyClient(fakeOAuth(), {
      fetch: fetchImpl,
      maxTextResponseBytes: 1024
    });
    await expect(client.text("https://www.googleapis.com/drive/v3/files/test", 1024))
      .rejects.toMatchObject({ status: 413 } satisfies Partial<GoogleApiError>);
  });

  it("times out a stalled request and supports purge cancellation", async () => {
    const fetchImpl = (async (_input: string | URL | Request, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
      })) as typeof fetch;
    const timed = new GoogleReadonlyClient(fakeOAuth(), { fetch: fetchImpl, requestTimeoutMs: 100 });
    await expect(timed.json("https://gmail.googleapis.com/stalled")).rejects.toThrow("timed out");

    const cancelled = new GoogleReadonlyClient(fakeOAuth(), { fetch: fetchImpl, requestTimeoutMs: 10_000 });
    const pending = cancelled.json("https://gmail.googleapis.com/cancelled");
    await new Promise((resolve) => setTimeout(resolve, 0));
    cancelled.abortPendingRequests();
    await expect(pending).rejects.toThrow("cancelled");
  });
});
