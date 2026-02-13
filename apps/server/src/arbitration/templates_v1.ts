import type { GuidanceItemV1 } from "@overlay-assistant/shared";

export type TemplateRule = {
  id: string;
  category: string;
  title: string;
  text: string;
  priority: number;
};

export const TEMPLATE_RULES: TemplateRule[] = [
  {
    id: "pricing_1",
    category: "objection:pricing",
    title: "Handle pricing concern",
    text: "Ask what budget range they had in mind, then anchor on outcomes and ROI. Offer a scoped pilot if needed.",
    priority: 90
  },
  {
    id: "security_1",
    category: "objection:security",
    title: "Answer security/compliance",
    text: "Offer to share your security packet (SOC2, data retention, access controls) and propose a quick security review call with your team.",
    priority: 85
  },
  {
    id: "decision_1",
    category: "intent:decision_process",
    title: "Clarify decision process",
    text: "Ask: Who signs off? What are the steps (security, legal, procurement)? What timeline are we working toward?",
    priority: 80
  },
  {
    id: "scheduling_1",
    category: "intent:scheduling",
    title: "Lock the next step",
    text: "Propose 2 concrete time options and confirm attendees + agenda so the next call moves the deal forward.",
    priority: 75
  },
  {
    id: "integration_1",
    category: "intent:integration_question",
    title: "Address integrations",
    text: "Confirm required systems (CRM, ticketing, SSO). Offer to map the integration in 10 minutes and send a brief architecture diagram.",
    priority: 70
  },
  {
    id: "competitor_1",
    category: "intent:competitor_comparison",
    title: "Competitor comparison",
    text: "Ask what they like about the current solution and what’s missing. Then position your differentiators with a concrete example.",
    priority: 65
  }
];

export function templateToGuidanceItem(rule: TemplateRule, confidence: number, confidenceBand: GuidanceItemV1["confidenceBand"]): GuidanceItemV1 {
  return {
    id: `${rule.id}:${Date.now()}`,
    category: rule.category,
    title: rule.title,
    text: rule.text,
    confidence,
    confidenceBand,
    createdAt: new Date().toISOString(),
    explanation: {
      schema: "explanation_v1",
      ruleId: rule.id,
      reasons: ["template_match"],
      evidenceIds: []
    }
  };
}
