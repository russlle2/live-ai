import { createHash } from "node:crypto";
import OpenAI from "openai";
import { CONFIG } from "../config.js";

let client: OpenAI | null = null;

export function getOpenAIClient(): OpenAI | null {
  if (!CONFIG.openaiApiKey) return null;
  if (!client) client = new OpenAI({ apiKey: CONFIG.openaiApiKey });
  return client;
}

export function isOpenAIConfigured(): boolean {
  return Boolean(CONFIG.openaiApiKey);
}

/** Hash app identities before sending the stable safety identifier to OpenAI. */
export function openAISafetyIdentifier(...parts: string[]): string {
  return createHash("sha256")
    .update(parts.filter(Boolean).join(":"))
    .digest("hex")
    .slice(0, 64);
}
