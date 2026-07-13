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
    text: "Say: \"I understand. Before I address cost, what outcome and budget range are you balancing? Then I can separate what we know from anything that needs a verified quote.\"",
    reason: "They mentioned cost or budget concerns",
    priority: 90
  },
  {
    id: "security_1",
    category: "objection:security",
    title: "Security concern",
    text: "Say: \"Great question, and I don\u2019t want to overstate our controls. Which requirement matters most\u2014data handling, access, retention, or audit evidence? I\u2019ll verify the exact documentation and get you a precise answer.\"",
    reason: "They brought up security or compliance",
    priority: 85
  },
  {
    id: "competitor_obj_1",
    category: "objection:competitor",
    title: "They use a competitor",
    text: "Say: \"That makes sense. What do you like most about what you\u2019re using now, and what has been frustrating? I can compare only the verified differences against the priorities you name.\"",
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
    text: "Say: \"Understood. What does your approval process usually require? If procurement or legal joins, I\u2019ll confirm which documents we can provide and give you an accurate next step.\"",
    reason: "They mentioned legal or procurement steps",
    priority: 76
  },
  {
    id: "decision_1",
    category: "intent:decision_process",
    title: "Clarify next steps",
    text: "Say: \"That\u2019s helpful. Who else needs to sign off, and what timeline are you working toward? Let\u2019s identify the next step, its owner, and anything that still needs verification.\"",
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
    text: "Say: \"Which systems are must-haves for you? I\u2019ll confirm the supported connection, data flow, and implementation constraints rather than assume compatibility.\"",
    reason: "They asked about integrations or APIs",
    priority: 70
  },
  {
    id: "competitor_1",
    category: "intent:competitor_comparison",
    title: "Show what's different",
    text: "Say: \"What matters most to you—speed, cost, support, or features? I\u2019ll compare the options against that priority and clearly mark anything I still need to verify.\"",
    reason: "They want to compare options",
    priority: 65
  },
  {
    id: "roi_1",
    category: "intent:roi",
    title: "Quantify the value",
    text: "Say: \"What does your team spend on this today in time and cost? We can build the assumptions together, then label which figures are measured and which still need verification.\"",
    reason: "They're weighing the value proposition",
    priority: 68
  },
  {
    id: "stakeholder_1",
    category: "intent:stakeholder",
    title: "Map the buying committee",
    text: "Say: \"Who else on your team would be involved in this decision? I\u2019d love to tailor a quick overview for each stakeholder so everyone sees the value from their angle.\"",
    reason: "They mentioned other people involved in the decision",
    priority: 72
  },
  {
    id: "pain_1",
    category: "intent:pain_point",
    title: "Dig into the pain",
    text: "Say: \"How is that impacting your team day-to-day? If we could solve that, what would it free you up to focus on instead?\"",
    reason: "They described a challenge or frustration",
    priority: 74
  },
  {
    id: "trial_1",
    category: "intent:trial",
    title: "Offer a proof of value",
    text: "Say: \"Would a clearly scoped evaluation help? Let\u2019s define the success criteria, timeline, and access needed, then I\u2019ll verify which trial terms are actually available.\"",
    reason: "They seem interested but hesitant to commit",
    priority: 62
  },
  {
    id: "fallback_1",
    category: "fallback",
    title: "Uncover their top priority",
    text: "Say: \"What\u2019s the single biggest thing you\u2019re trying to solve right now? I want to make sure we\u2019re focused on what matters most to you.\"",
    reason: "Uncover their core priority",
    priority: 50
  },
  {
    id: "fallback_2",
    category: "fallback",
    title: "Understand their timeline",
    text: "Say: \"What\u2019s driving the timeline on this? Are you evaluating now or is there a deadline you\u2019re working toward?\"",
    reason: "Understand their urgency and timeline",
    priority: 49
  },
  {
    id: "fallback_3",
    category: "fallback",
    title: "Connect to business impact",
    text: "Say: \"How does this fit into what your team is focused on this quarter? I want to make sure we tie this back to your goals.\"",
    reason: "Link the conversation to business outcomes",
    priority: 48
  },
  {
    id: "fallback_4",
    category: "fallback",
    title: "Ask about current process",
    text: "Say: \"Walk me through how your team handles this today \u2014 what\u2019s working well and where do things break down?\"",
    reason: "Understand their current workflow",
    priority: 47
  },
  {
    id: "fallback_5",
    category: "fallback",
    title: "Surface a success story",
    text: "Say: \"A relevant example could help, but I want to use one that truly matches your situation. Which result matters most so I can verify the right case study?\"",
    reason: "Build credibility with a relevant example",
    priority: 46
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
