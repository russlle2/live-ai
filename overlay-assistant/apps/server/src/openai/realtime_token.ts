import type { ClientSecretCreateParams } from "openai/resources/realtime/client-secrets";
import { CONFIG } from "../config.js";
import { getOpenAIClient } from "./client.js";

export type RealtimeCaptureSource = "rep" | "lead";

/**
 * Build a transcription-only session. Turn detection is deliberately disabled:
 * each independently captured channel commits its own buffer, which is what makes
 * the speaker label deterministic instead of a diarization guess.
 */
export function buildRealtimeTranscriptionSession(source: RealtimeCaptureSource) {
  return {
    type: "transcription" as const,
    audio: {
      input: {
        ...(source === "rep"
          ? { noise_reduction: { type: "near_field" as const } }
          : {}),
        transcription: {
          model: CONFIG.openaiTranscriptionModel,
          language: "en",
          // gpt-realtime-whisper supports an explicit transcription delay. The
          // installed SDK's generated type can lag this field, so the create call
          // below narrows the complete request at the API boundary.
          delay: CONFIG.openaiTranscriptionDelay
        },
        turn_detection: null
      }
    }
  };
}

export async function createRealtimeTranscriptionClientSecret(params: {
  source: RealtimeCaptureSource;
  safetyIdentifier: string;
  timeoutMs?: number;
}): Promise<{
  value: string;
  expiresAt: number;
  session: unknown;
}> {
  const client = getOpenAIClient();
  if (!client) throw new Error("openai_not_configured");

  const body = {
    expires_after: {
      anchor: "created_at" as const,
      seconds: CONFIG.openaiRealtimeTokenTtlSeconds
    },
    session: buildRealtimeTranscriptionSession(params.source)
  };

  // `delay` is already supported by the live API but is newer than the generated
  // AudioTranscription interface in some SDK releases.
  const result = await client.realtime.clientSecrets.create(
    body as unknown as ClientSecretCreateParams,
    {
      timeout: params.timeoutMs ?? CONFIG.openaiRequestTimeoutMs,
      headers: { "OpenAI-Safety-Identifier": params.safetyIdentifier }
    }
  );

  return {
    value: result.value,
    expiresAt: result.expires_at,
    session: result.session
  };
}
