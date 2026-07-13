import type { ScenarioModeV1 } from "@overlay-assistant/shared";

const DEFAULT_CUSHIONS: Record<ScenarioModeV1, string> = {
  interview: "Absolutely — let me think through that for a second.",
  insurance_sales: "That makes sense. Let me make sure I’m addressing the right concern.",
  it_support: "Got it. Let me confirm what you’re seeing so we solve the right issue.",
  inbound_service: "I understand. Give me one moment to make sure I handle this correctly.",
  negotiation: "I hear you. Let me make sure I understand the priority behind that.",
  general: "That’s a fair point. Give me one moment to think it through."
};

/** An instant, deterministic line shown while the tailored answer is generated. */
export function chooseCushion(mode: ScenarioModeV1, heard: string): string {
  const normalized = heard.toLowerCase();
  if (mode === "interview") {
    if (/tell me about|give (me )?an example|time when/.test(normalized)) {
      return "Absolutely — let me give you a clear example.";
    }
    if (/why (do|did|are|should|would)|what interests you/.test(normalized)) {
      return "That’s a good question. The short answer is…";
    }
  }
  if (mode === "it_support" && /error|not working|can'?t|unable/.test(normalized)) {
    return "I can help with that. Let me verify the symptom before we change anything.";
  }
  if ((mode === "insurance_sales" || mode === "negotiation") && /cost|price|expensive|budget/.test(normalized)) {
    return "That’s completely fair. Let’s make sure the value and the numbers both make sense.";
  }
  return DEFAULT_CUSHIONS[mode];
}
