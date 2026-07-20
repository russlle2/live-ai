import type { MemoryFactWriteInput } from "./memoryReview";
import type { RuntimeEventV2 } from "@overlay-assistant/runtime";

type RequestOptions = {
  method?: "GET" | "POST" | "DELETE";
  body?: Record<string, unknown>;
  token?: string | null;
};

async function requestJson<T>(path: string, httpBase?: string, options: RequestOptions = {}): Promise<T> {
  const base = httpBase || "http://localhost:8080";
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (options.token) headers.Authorization = `Bearer ${options.token}`;

  const res = await fetch(`${base}${path}`, {
    method: options.method ?? "GET",
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
    cache: "no-store"
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((json as any)?.message || (json as any)?.error || `request_failed_${res.status}`);
  }
  return json as T;
}

export async function postUiEvent(
  e: {
    tenantId: string;
    repId: string;
    sessionId: string;
    eventType: string;
    data?: Record<string, unknown>;
  },
  httpBase?: string,
  token?: string | null
) {
  try {
    await requestJson("/api/ui-event", httpBase, { method: "POST", body: e, token });
  } catch {
    // Silently fail — telemetry should never break the UX
    console.warn("[api] Failed to send UI event:", e.eventType);
  }
}

export async function postRuntimeEvent(
  event: RuntimeEventV2,
  httpBase?: string,
  token?: string | null
): Promise<void> {
  await requestJson("/api/runtime/events", httpBase, {
    method: "POST",
    body: event as unknown as Record<string, unknown>,
    token
  });
}

export async function login(
  credentials: { tenantId: string; repId: string; role?: "rep" | "admin" | "viewer"; accessCode?: string },
  httpBase?: string
): Promise<{ token: string; mode: "demo" | "jwt" }> {
  const data = await requestJson<{ ok: true; token: string; mode: "demo" | "jwt" }>("/api/auth/login", httpBase, {
    method: "POST",
    body: credentials
  });
  return { token: data.token, mode: data.mode };
}

export type RuntimeAutomationStatus = {
  apiKey: {
    configured: boolean;
    serverOnly: boolean;
    liveModel: string;
    transcriptionModel: string;
  };
  memory: {
    total: number;
    userVerified: number;
    byCategory: Record<string, number>;
    bySource: Record<string, number>;
    generatedAt?: string;
    automaticRetrieval: boolean;
  };
  coachingKnowledge: {
    total: number;
    byDomain: Record<string, number>;
    loaded: boolean;
    automaticRetrieval: boolean;
    separateFromPersonalMemory: boolean;
    error?: string;
  };
  transcripts: {
    automaticCapture: boolean;
    automaticLearning: boolean;
    learningIntervalTurns: number;
    automaticDeliveryComparison: boolean;
    automaticSpeakingStyleLearning: boolean;
    deliveryLearningMinimumPairs: number;
  };
  google: {
    configured: boolean;
    authorized: boolean;
    cachedSources: number;
    pendingExtraction: number;
    extractionBudget: {
      day: string;
      used: number;
      dailyLimit: number;
      perRunLimit: number;
    };
    sourceCapacity: {
      used: number;
      limit: number;
      full: boolean;
    };
    lastSyncAt?: string;
  };
  voice: {
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
    automaticEnrollment: boolean;
    rawAudioStored: false;
    primaryIdentity: "separate_channels";
  };
};

export async function getRuntimeAutomationStatus(
  httpBase?: string,
  token?: string | null
): Promise<RuntimeAutomationStatus> {
  const data = await requestJson<{ ok: true; automation: RuntimeAutomationStatus }>(
    "/api/runtime/status",
    httpBase,
    { token }
  );
  return data.automation;
}

export async function beginGoogleAuthorization(
  httpBase?: string,
  token?: string | null
): Promise<string> {
  const data = await requestJson<{ url: string }>("/api/google/oauth/start", httpBase, {
    method: "POST",
    token
  });
  if (!data.url) throw new Error("The server did not return a Google authorization URL.");
  return data.url;
}

export async function runGoogleMemorySync(
  httpBase?: string,
  token?: string | null
): Promise<void> {
  await requestJson("/api/google/sync", httpBase, { method: "POST", token });
}

export async function eraseAllPrivateData(
  httpBase?: string,
  token?: string | null
): Promise<{ warnings: string[] }> {
  const data = await requestJson<{ ok: true; warnings: string[] }>("/api/private-data", httpBase, {
    method: "DELETE",
    token,
    body: {
      confirmation: "ERASE MY PRIVATE DATA",
      scopes: ["all"]
    }
  });
  return { warnings: data.warnings ?? [] };
}

export async function getMemoryFacts(
  httpBase?: string,
  token?: string | null
): Promise<{ facts: unknown[]; total: number }> {
  const data = await requestJson<{ ok: true; facts?: unknown[]; total?: number }>(
    "/api/memory/facts?includeRestricted=true",
    httpBase,
    { token }
  );
  return {
    facts: Array.isArray(data.facts) ? data.facts : [],
    total: typeof data.total === "number" ? data.total : 0
  };
}

export type TranscriptArchiveResult = {
  sessionId: string;
  speaker: "rep" | "lead" | "unknown";
  text: string;
  at: string;
  mode: string;
  score: number;
};

export async function searchTranscriptArchive(
  query: string,
  httpBase?: string,
  token?: string | null,
  limit = 20
): Promise<TranscriptArchiveResult[]> {
  const params = new URLSearchParams({
    q: query.trim(),
    limit: String(limit)
  });
  const data = await requestJson<{
    ok: true;
    results?: TranscriptArchiveResult[];
  }>(`/api/archive/search?${params}`, httpBase, { token });
  return Array.isArray(data.results) ? data.results : [];
}

export async function verifyOrCorrectMemoryFact(
  fact: MemoryFactWriteInput,
  httpBase?: string,
  token?: string | null
): Promise<void> {
  await requestJson("/api/memory/facts", httpBase, {
    method: "POST",
    body: { facts: [fact] },
    token
  });
}

export async function deleteMemoryFact(
  id: string,
  httpBase?: string,
  token?: string | null
): Promise<void> {
  await requestJson(`/api/memory/facts/${encodeURIComponent(id)}`, httpBase, {
    method: "DELETE",
    token
  });
}
