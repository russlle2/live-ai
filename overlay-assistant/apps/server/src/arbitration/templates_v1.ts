import type { GuidanceItemV1 } from "@overlay-assistant/shared";

export type TemplateRule = {
  id: string;
  category: string;
  title: string;
  /** Word-for-word line the rep can say */
  text: string;
  /** Friendly reason shown to the user (plain language) */
  reason: string;
  priority: number;
};

export const TEMPLATE_RULES: TemplateRule[] = [
  {
    id: "pricing_1",
    category: "objection:pricing",
    title: "Budget pushback",
    text: "Say: \"I totally understand \u2014 let\u2019s figure out what works for your budget. What range were you thinking? Most of our clients see a 3x return in the first quarter, so it usually pays for itself pretty fast.\"",
    reason: "They mentioned cost or budget concerns",
    priority: 90
  },
  {
    id: "security_1",
    category: "objection:security",
    title: "Security concern",
    text: "Say: \"Great question \u2014 security is a top priority for us. I can send over our SOC 2 report and data handling docs right after this call. Want me to set up a quick 15-minute security review with our team?\"",
    reason: "They brought up security or compliance",
    priority: 85
  },
  {
    id: "competitor_obj_1",
    category: "objection:competitor",
    title: "They use a competitor",
    text: "Say: \"That makes sense \u2014 what do you like most about what you\u2019re using now, and what\u2019s been frustrating? I\u2019d love to show you how we handle those pain points differently.\"",
    reason: "They mentioned a competitor or existing tool",
    priority: 82
  },
  {
    id: "timing_1",
    category: "objection:timing",
    title: "Not the right time",
    text: "Say: \"Totally fair \u2014 timing matters. When would be a better time to revisit this? I can send a quick summary so it\u2019s easy to pick back up when you\u2019re ready.\"",
    reason: "They said it's not the right time",
    priority: 78
  },
  {
    id: "legal_1",
    category: "objection:legal_procurement",
    title: "Legal / procurement process",
    text: "Say: \"Understood \u2014 what does your approval process usually look like? If you can connect me with procurement or legal, I can get them what they need to speed things along.\"",
    reason: "They mentioned legal or procurement steps",
    priority: 76
  },
  {
    id: "decision_1",
    category: "intent:decision_process",
    title: "Clarify next steps",
    text: "Say: \"That\u2019s really helpful \u2014 who else would need to sign off on this? And what\u2019s the timeline you\u2019re working toward? I want to make sure we hit your deadline.\"",
    reason: "They're talking about the decision process",
    priority: 80
  },
  {
    id: "scheduling_1",
    category: "intent:scheduling",
    title: "Lock in the next meeting",
    text: "Say: \"Let\u2019s lock in a time \u2014 does Tuesday or Thursday work better for you? I\u2019ll send a calendar invite with a quick agenda so we can hit the ground running.\"",
    reason: "They're ready to schedule a follow-up",
    priority: 75
  },
  {
    id: "integration_1",
    category: "intent:integration_question",
    title: "Integration questions",
    text: "Say: \"We plug right into Salesforce, HubSpot, Slack, Jira \u2014 you name it. Which systems are must-haves for you? I can map out the integration in about 10 minutes and send you a diagram.\"",
    reason: "They asked about integrations or APIs",
    priority: 70
  },
  {
    id: "competitor_1",
    category: "intent:competitor_comparison",
    title: "Show what's different",
    text: "Say: \"What matters most to you \u2014 speed, cost, support, features? Let me walk you through exactly where we stand out compared to what you\u2019ve been looking at.\"",
    reason: "They want to compare options",
    priority: 65
  },
  {
    id: "fallback_1",
    category: "fallback",
    title: "Keep the conversation going",
    text: "Say: \"That\u2019s a great point \u2014 tell me more about that. What would the ideal solution look like for your team?\"",
    reason: "General conversation \u2014 ask a thoughtful question",
    priority: 50
  }
];

export function templateToGuidanceItem(
  rule: TemplateRule,
  confidence: number,
  confidenceBand: GuidanceItemV1["confidenceBand"],
  speaker?: string
): GuidanceItemV1 {
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
      reasons: [rule.reason, speaker ? `Speaker: ${speaker}` : "Speaker: unknown"],
      evidenceIds: []
    }
  };
}
