import { GoogleOAuthManager } from "./oauth.js";
import {
  GoogleHttpBodyLimitError,
  GoogleHttpTransport,
  readBoundedResponseBytes
} from "./transport.js";

export class GoogleApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body?: unknown
  ) {
    super(message);
    this.name = "GoogleApiError";
  }
}

export type GoogleReadonlyClientOptions = {
  fetch?: typeof fetch;
  requestTimeoutMs?: number;
  maxJsonResponseBytes?: number;
  maxTextResponseBytes?: number;
};

export class GoogleReadonlyClient {
  private readonly transport: GoogleHttpTransport;
  private readonly maxJsonResponseBytes: number;
  private readonly maxTextResponseBytes: number;

  constructor(
    private readonly oauth: GoogleOAuthManager,
    options: GoogleReadonlyClientOptions = {}
  ) {
    this.transport = new GoogleHttpTransport(
      options.fetch ?? globalThis.fetch,
      boundedInteger(options.requestTimeoutMs ?? 15_000, 100, 120_000)
    );
    this.maxJsonResponseBytes = boundedInteger(
      options.maxJsonResponseBytes ?? 2 * 1024 * 1024,
      1024,
      8 * 1024 * 1024
    );
    this.maxTextResponseBytes = boundedInteger(
      options.maxTextResponseBytes ?? 1_000_000,
      1024,
      4 * 1024 * 1024
    );
  }

  async json<T>(url: string | URL): Promise<T> {
    return this.request(url, async (response) => {
      const body = await readBoundedResponseBytes(response, this.maxJsonResponseBytes);
      try {
        return JSON.parse(new TextDecoder().decode(body)) as T;
      } catch {
        throw new GoogleApiError("Google API returned invalid JSON", 502);
      }
    });
  }

  async text(url: string | URL, maxBytes = this.maxTextResponseBytes): Promise<string> {
    const byteLimit = boundedInteger(maxBytes, 1024, this.maxTextResponseBytes);
    return this.request(url, async (response) => {
      try {
        return new TextDecoder().decode(await readBoundedResponseBytes(response, byteLimit));
      } catch (error) {
        if (error instanceof GoogleHttpBodyLimitError) {
          throw new GoogleApiError("Google source exceeds the configured text size limit", 413);
        }
        throw error;
      }
    });
  }

  abortPendingRequests(): void {
    this.transport.abortAll();
  }

  private async request<T>(
    url: string | URL,
    consume: (response: Response) => Promise<T>
  ): Promise<T> {
    const accessToken = await this.oauth.getAccessToken();
    return this.transport.run(url, {
      method: "GET",
      headers: {
        authorization: `Bearer ${accessToken}`,
        accept: "application/json, text/plain;q=0.9, */*;q=0.1"
      }
    }, async (response) => {
      if (response.ok) return consume(response);

      let body: unknown;
      try {
        const bytes = await readBoundedResponseBytes(response, Math.min(this.maxJsonResponseBytes, 64 * 1024));
        const raw = new TextDecoder().decode(bytes);
        try {
          body = JSON.parse(raw);
        } catch {
          body = raw;
        }
      } catch (error) {
        body = error instanceof GoogleHttpBodyLimitError ? "response_body_too_large" : undefined;
      }
      const googleMessage = (body as { error?: { message?: string } } | undefined)?.error?.message;
      throw new GoogleApiError(
        googleMessage ?? `Google API request failed (${response.status})`,
        response.status,
        body
      );
    });
  }
}

function boundedInteger(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) return minimum;
  return Math.min(maximum, Math.max(minimum, Math.trunc(value)));
}
