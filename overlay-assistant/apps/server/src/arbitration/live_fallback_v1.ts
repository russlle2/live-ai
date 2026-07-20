import type {
  ConversationSpeakerV1,
  ScenarioModeV1
} from "@overlay-assistant/shared";

const CUSHIONS: Record<ScenarioModeV1, string> = {
  interview:
    "Say: “That’s a thoughtful question—give me one second to choose the clearest example.”",
  insurance_sales:
    "Say: “Absolutely—let me make sure I address the part that matters most to you.”",
  it_support:
    "Say: “Got it—let me make sure I understand the exact behavior you’re seeing.”",
  inbound_service:
    "Say: “I understand—give me one moment and I’ll walk through this with you.”",
  negotiation:
    "Say: “I hear you—let me think through the fairest way to address that.”",
  general:
    "Say: “I hear you—give me one second to answer that clearly.”"
};

const FALLBACKS: Record<ScenarioModeV1, string> = {
  interview:
    "Say: “The clearest way to answer is with a real example: I first understood the problem, took ownership of the next step, and followed through—let me walk you through what I did.”",
  insurance_sales:
    "Say: “To make sure I’m helping, which matters most here: protecting the right risk, keeping the monthly cost comfortable, or understanding exactly how the coverage works?”",
  it_support:
    "Say: “Let’s narrow this down methodically: what changed, what did you expect to happen, and what exact error or behavior are you seeing?”",
  inbound_service:
    "Say: “I understand what happened. I’ll confirm the key details, explain the next step clearly, and stay focused on getting you to the right resolution.”",
  negotiation:
    "Say: “I understand your position. Which part—scope, timing, or price—would make the biggest difference if we solved it?”",
  general:
    "Say: “I want to answer the part that matters most—what outcome would make this conversation successful for you?”"
};

export function shouldCoachSpeaker(speaker: ConversationSpeakerV1): boolean {
  return speaker === "lead";
}

export function getDeterministicCushion(mode: ScenarioModeV1): string {
  return CUSHIONS[mode] ?? CUSHIONS.general;
}

export function getDeterministicFallback(mode: ScenarioModeV1): string {
  return FALLBACKS[mode] ?? FALLBACKS.general;
}

/** Prefer turn-specific deterministic arbitration before a generic stage line. */
export function selectDeterministicGuidance(
  items: readonly { text: string }[],
  playbookFallback: string
): string {
  const candidate = items.find((item) =>
    typeof item.text === "string" &&
    item.text.length <= 8_000 &&
    /^say\s*:/i.test(item.text.trim())
  )?.text.trim();
  return candidate || playbookFallback;
}
