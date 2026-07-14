export class GoogleHttpBodyLimitError extends Error {
  constructor(readonly maxBytes: number) {
    super("Google response exceeded the configured byte limit");
    this.name = "GoogleHttpBodyLimitError";
  }
}

export class GoogleHttpTimeoutError extends Error {
  constructor() {
    super("Google request timed out");
    this.name = "GoogleHttpTimeoutError";
  }
}

export class GoogleHttpAbortedError extends Error {
  constructor() {
    super("Google request was cancelled");
    this.name = "GoogleHttpAbortedError";
  }
}

export async function readBoundedResponseBytes(
  response: Response,
  maxBytes: number
): Promise<Uint8Array> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw new GoogleHttpBodyLimitError(maxBytes);
  }
  if (!response.body) return new Uint8Array();

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new GoogleHttpBodyLimitError(maxBytes);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

export class GoogleHttpTransport {
  private readonly controllers = new Set<AbortController>();

  constructor(
    private readonly fetchImpl: typeof fetch,
    private readonly timeoutMs: number
  ) {}

  async run<T>(
    url: string | URL,
    init: RequestInit,
    consume: (response: Response) => Promise<T>
  ): Promise<T> {
    const controller = new AbortController();
    let timedOut = false;
    this.controllers.add(controller);
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.timeoutMs);
    try {
      const response = await this.fetchImpl(url, { ...init, signal: controller.signal });
      return await consume(response);
    } catch (error) {
      if (timedOut) throw new GoogleHttpTimeoutError();
      if (controller.signal.aborted) throw new GoogleHttpAbortedError();
      throw error;
    } finally {
      clearTimeout(timeout);
      this.controllers.delete(controller);
    }
  }

  abortAll(): void {
    for (const controller of this.controllers) controller.abort();
  }
}
