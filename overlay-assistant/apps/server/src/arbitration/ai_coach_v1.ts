/**
 * ai_coach_v1.ts — OpenAI-powered contextual coaching engine.
 *
 * When OPENAI_API_KEY is set, this replaces the dumb regex templates
 * with real AI that understands the conversation context, product info,
 * and gives specific word-for-word coaching.
 *
 * Falls back to template-based arbitration when:
 *   - No API key configured
 *   - API call fails or times out
 *   - Rate limited
 */

import OpenAI from "openai";
import { CONFIG } from "../config";
import { emitLog } from "../obs/emitLog";
import { logTokenUsage } from "../middleware/token_usage";

let openai: OpenAI | null = null;

function getClient(): OpenAI | null {
  if (!CONFIG.openaiApiKey) return null;
  if (!openai) {
    openai = new OpenAI({ apiKey: CONFIG.openaiApiKey });
  }
  return openai;
}

export function isAiCoachEnabled(): boolean {
  return !!CONFIG.openaiApiKey;
}

type ConversationTurn = {
  speaker: "rep" | "lead" | "unknown";
  text: string;
};

type ProductContext = {
  productName?: string;
  differentiators?: string;
  competitors?: string;
  targetIndustry?: string;
  commonObjections?: string;
};

type CoachRequest = {
  currentText: string;
  speaker: "rep" | "lead" | "unknown";
  conversationHistory: ConversationTurn[];
  productContext?: ProductContext;
  tenantId: string;
  repId: string;
  sessionId: string;
};

type CoachResponse = {
  coaching: string;
  reasoning: string;
  category: string;
  aiGenerated: true;
  latencyMs: number;
};

function buildSystemPrompt(pc?: ProductContext): string {
  const productBlock = pc
    ? `
PRODUCT CONTEXT:
- Product: ${pc.productName || "Not specified"}
- Key differentiators: ${pc.differentiators || "Not specified"}
- Main competitors: ${pc.competitors || "Not specified"}
- Target industry: ${pc.targetIndustry || "Not specified"}
- Common objections: ${pc.commonObjections || "Not specified"}
`
    : "";

  return `You are an elite real-time sales coach. You're watching a live sales conversation and providing word-for-word coaching to the sales rep through a discreet overlay.

YOUR ROLE:
- Give the rep EXACTLY what to say next — word for word
- Be specific to what was just said in the conversation
- Reference the prospect's actual words and concerns
- Adapt to the product being sold
${productBlock}
RULES:
1. Start every coaching tip with "Say:" followed by the exact words to speak
2. Keep responses to 1-3 sentences — the rep needs to glance and speak, not read essays
3. Be conversational and natural — never robotic or salesy
4. If the prospect raised a concern, address THAT specific concern
5. If the rep spoke, coach on what to say NEXT based on the flow
6. Reference specific details from the conversation — never be generic
7. If you detect an objection, give a specific reframe for THAT objection
8. If it's an opening/intro, help position the value prop specifically
9. Never say "Tell me more about that" as generic filler — always be specific

RESPONSE FORMAT (JSON):
{
  "coaching": "Say: [exact words for the rep to say]",
  "reasoning": "[1 sentence explaining why this response works]",
  "category": "[one of: objection_handling, discovery, value_prop, closing, relationship_building, opening]"
}`;
}

function buildUserMessage(req: CoachRequest): string {
  const historyLines = req.conversationHistory
    .slice(-8) // last 8 turns for context
    .map((t) => `${t.speaker === "rep" ? "REP" : t.speaker === "lead" ? "PROSPECT" : "SPEAKER"}: ${t.text}`)
    .join("\n");

  const current = `${req.speaker === "rep" ? "REP" : req.speaker === "lead" ? "PROSPECT" : "SPEAKER"}: ${req.currentText}`;

  return `CONVERSATION SO FAR:
${historyLines ? historyLines + "\n" : ""}${current}

What should the rep say next? Remember: be specific to what was just said, not generic.`;
}

export async function getAiCoaching(req: CoachRequest): Promise<CoachResponse | null> {
  const client = getClient();
  if (!client) return null;

  const startMs = Date.now();

  try {
    const response = await client.chat.completions.create({
      model: CONFIG.openaiModel,
      messages: [
        { role: "system", content: buildSystemPrompt(req.productContext) },
        { role: "user", content: buildUserMessage(req) }
      ],
      response_format: { type: "json_object" },
      temperature: 0.7,
      max_tokens: 250,
    }, { timeout: 5000 });

    const latencyMs = Date.now() - startMs;
    const raw = response.choices[0]?.message?.content ?? "";

    let parsed: any;
    try {
      parsed = JSON.parse(raw);
    } catch {
      // If JSON parsing fails, use the raw text as coaching
      parsed = { coaching: raw, reasoning: "AI response", category: "general" };
    }

    emitLog({
      tenantId: req.tenantId,
      repId: req.repId,
      session_id: req.sessionId,
      service: "ai_coach",
      eventType: "ai_coaching_success",
      data: {
        latencyMs,
        model: CONFIG.openaiModel,
        category: parsed.category,
        tokensUsed: response.usage?.total_tokens
      }
    });

    // Log token usage for billing/auditing
    if (response.usage) {
      logTokenUsage({
        tenantId: req.tenantId,
        repId: req.repId,
        sessionId: req.sessionId,
        model: CONFIG.openaiModel,
        promptTokens: response.usage.prompt_tokens,
        completionTokens: response.usage.completion_tokens,
        totalTokens: response.usage.total_tokens,
        latencyMs,
        cached: false
      }).catch(() => {}); // fire-and-forget
    }

    return {
      coaching: parsed.coaching || "Say: \"Tell me more about your specific situation — what's the biggest challenge you're facing right now?\"",
      reasoning: parsed.reasoning || "",
      category: parsed.category || "general",
      aiGenerated: true,
      latencyMs
    };
  } catch (err: any) {
    const latencyMs = Date.now() - startMs;

    emitLog({
      tenantId: req.tenantId,
      repId: req.repId,
      session_id: req.sessionId,
      service: "ai_coach",
      eventType: "ai_coaching_error",
      level: "WARN",
      data: {
        latencyMs,
        error: err?.message?.slice(0, 200) ?? "unknown",
        model: CONFIG.openaiModel
      }
    });

    return null; // Caller will fall back to templates
  }
}
