import { createHash } from "node:crypto";
import OpenAI from "openai";
import { CONFIG } from "../config.js";

let client: OpenAI | null = null;
let coachingClient: OpenAI | null = null;
let coachingClientKey = "";

export type CoachingProviderConfig =
  | {
      kind: "local";
      baseUrl: string;
      apiKey: string;
      model: string;
    }
  | {
      kind: "cloud";
      apiKey: string;
      model: string;
    };

export function validateLocalAiBaseUrl(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("LOCAL_AI_BASE_URL must be a valid loopback http(s) URL");
  }
  const hostname = parsed.hostname.toLowerCase();
  if (
    (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
    !["localhost", "127.0.0.1", "::1", "[::1]"].includes(hostname) ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error("LOCAL_AI_BASE_URL must use a loopback http(s) endpoint");
  }
  return parsed.toString().replace(/\/$/, "");
}

export function resolveCoachingProviderConfig(input: {
  localBaseUrl: string;
  localModel: string;
  localApiKey?: string;
  cloudApiKey: string;
  cloudModel: string;
}): CoachingProviderConfig | null {
  const localBaseUrl = input.localBaseUrl.trim();
  const localModel = input.localModel.trim();
  if (Boolean(localBaseUrl) !== Boolean(localModel)) {
    throw new Error(
      "LOCAL_AI_BASE_URL and LOCAL_COACH_MODEL must either both be set or both be omitted"
    );
  }
  if (localBaseUrl && localModel) {
    return {
      kind: "local",
      baseUrl: validateLocalAiBaseUrl(localBaseUrl),
      apiKey: input.localApiKey?.trim() || "local-only",
      model: localModel
    };
  }
  if (input.cloudApiKey) {
    return {
      kind: "cloud",
      apiKey: input.cloudApiKey,
      model: input.cloudModel
    };
  }
  return null;
}

export function getOpenAIClient(): OpenAI | null {
  if (!CONFIG.openaiApiKey) return null;
  if (!client) client = new OpenAI({ apiKey: CONFIG.openaiApiKey });
  return client;
}

export function isOpenAIConfigured(): boolean {
  return Boolean(CONFIG.openaiApiKey);
}

export function getCoachingProviderConfig(): CoachingProviderConfig | null {
  return resolveCoachingProviderConfig({
    localBaseUrl: CONFIG.localAiBaseUrl,
    localModel: CONFIG.localCoachModel,
    localApiKey: CONFIG.localAiApiKey,
    cloudApiKey: CONFIG.openaiApiKey,
    cloudModel: CONFIG.openaiModel
  });
}

export function getCoachingOpenAIClient(): OpenAI | null {
  const provider = getCoachingProviderConfig();
  if (!provider) return null;
  const key = JSON.stringify(provider);
  if (!coachingClient || coachingClientKey !== key) {
    coachingClient = new OpenAI({
      apiKey: provider.apiKey,
      ...(provider.kind === "local" ? { baseURL: provider.baseUrl } : {})
    });
    coachingClientKey = key;
  }
  return coachingClient;
}

export function isCoachingConfigured(): boolean {
  return getCoachingProviderConfig() !== null;
}

/** Hash app identities before sending the stable safety identifier to OpenAI. */
export function openAISafetyIdentifier(...parts: string[]): string {
  return createHash("sha256")
    .update(parts.filter(Boolean).join(":"))
    .digest("hex")
    .slice(0, 64);
}
