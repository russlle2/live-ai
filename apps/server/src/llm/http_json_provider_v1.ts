import { redactForLLMV1 } from "../arbitration/redaction_v1";

export type LlmRefineInputV1 = {
  language: string;
  stage: string;
  moment: string;
  microGoal: string;
  // Keep transcript short + redacted. Provide a snippet window.
  transcriptSnippet: string;
  baseSuggestion: { title: string; line: string; followUp: string; ifPushed: string };
  productFacts: {
    productName?: string;
    oneLiner?: string;
    differentiators?: string[];
    proofPoints?: string[];
    integrations?: string[];
    compliance?: string[];
    allowedClaims?: string[];
    forbiddenClaims?: string[];
    retrievedFacts?: { id: string; text: string }[];
  };
};

export type LlmRefineOutputV1 = {
  title?: string;
  line: string;
  followUp: string;
  ifPushed: string;
  language?: string;
};

function env(name: string): string {
  return (process.env[name] ?? "").trim();
}

export async function maybeRefineSuggestionV1(input: LlmRefineInputV1): Promise<LlmRefineOutputV1 | null> {
  const endpoint = env("LLM_ENDPOINT_URL");
  if (!endpoint) return null;

  const apiKey = env("LLM_API_KEY");
  const timeoutMs = Number(env("LLM_TIMEOUT_MS") || "8000");

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);

  const body = {
    schema: "coach_refine_request_v1",
    input: {
      ...input,
      transcriptSnippet: redactForLLMV1(input.transcriptSnippet).slice(0, 1800),
    },
    // Hard rules: DO NOT invent product facts. If not in productFacts/retrievedFacts, ask a question instead.
    rules: {
      noHallucinations: true,
      keepPrimaryLineShort: true,
      maxLineChars: 220,
      maxFollowUpChars: 220,
      maxIfPushedChars: 240,
    },
    outputSchema: {
      title: "string optional",
      line: "string",
      followUp: "string",
      ifPushed: "string",
      language: "string optional",
    },
  };

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!res.ok) return null;
    const json = (await res.json()) as any;

    // Accept either {output:{...}} or direct {line,...}
    const out = (json?.output ?? json) as any;
    if (!out || typeof out.line !== "string" || typeof out.followUp !== "string" || typeof out.ifPushed !== "string") return null;

    return {
      title: typeof out.title === "string" ? out.title : undefined,
      line: out.line,
      followUp: out.followUp,
      ifPushed: out.ifPushed,
      language: typeof out.language === "string" ? out.language : undefined,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}
