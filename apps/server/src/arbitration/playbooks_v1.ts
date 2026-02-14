import type { DetectedMoment, SessionMemoryV1 } from "./session_memory_v1";

export type PlaybookSuggestionV1 = {
  title: string;
  line: string;
  followUp: string;
  ifPushed: string;
};

export function pickPlaybookV1(moment: DetectedMoment, memory: SessionMemoryV1): PlaybookSuggestionV1 {
  // Stage-aware fallback
  if (moment === "unknown") {
    if (memory.stage === "evaluation") {
      return {
        title: "Confirm requirements + differentiate",
        line: "That makes sense. To compare fairly, what are the top 2 requirements that must be true for you?",
        followUp: "When you say “integration depth,” which system(s) and workflow matter most?",
        ifPushed: "If you tell me your top two requirements, I’ll map exactly where we win/lose in 60 seconds."
      };
    }
    if (memory.stage === "negotiation") {
      return {
        title: "Isolate constraint",
        line: "Before we change anything, what’s the single biggest constraint: budget, timeline, or internal approval?",
        followUp: "If we solve that one constraint, are you comfortable moving forward?",
        ifPushed: "If it’s budget we can scope down; if it’s approvals, we can equip you with a short stakeholder summary."
      };
    }
    if (memory.stage === "closing") {
      return {
        title: "Drive next step",
        line: "Sounds like we’re close—what’s the simplest next step to get this decided?",
        followUp: "Who needs to be involved and what’s the decision date?",
        ifPushed: "If you want, I can send a 3-bullet recap + propose two times for a final confirm call."
      };
    }
    return {
      title: "Clarify",
      line: "Can I ask one quick question so I don’t guess—what’s the main thing you’re trying to accomplish with this?",
      followUp: "And what’s the biggest risk you’re trying to avoid?",
      ifPushed: "If you tell me the outcome you care about most, I’ll keep this short and specific."
    };
  }

  switch (moment) {
    case "integration":
      return {
        title: "Define integration depth",
        line: "Totally—when you say “integration depth,” which systems are must-have (CRM, SSO, data warehouse), and what’s the workflow you need end-to-end?",
        followUp: "Is “deep” more about real-time sync, writeback, permissions/audit logs, or reliability under load?",
        ifPushed: "If you share your stack, we can map requirements to an exact yes/no list and a fastest path to verify in a short technical follow-up."
      };

    case "deployment":
      return {
        title: "Clarify deployment environment",
        line: "Quick clarifier—are you asking about physical deployment conditions (heat/humidity/storms), or is “Florida weather” a metaphor for volatility?",
        followUp: "If it’s physical: what exactly is being deployed (hardware, sensors, on-site devices) and where (indoor/outdoor/coastal)?",
        ifPushed: "If it’s metaphorical: tell me the real constraint you’re pointing to (reliability, uptime, connectivity), and I’ll answer directly."
      };

    case "price":
    case "value":
      return {
        title: "Reframe value + tailor",
        line: "Totally fair question. Before I answer, what are you comparing us to—another tool or doing it in-house?",
        followUp: "What outcome matters most in the next 30–60 days: speed, reliability, compliance, or cost control?",
        ifPushed: "If price is the main constraint, we can scope to the smallest plan that still solves the #1 outcome—want to see what that looks like?"
      };

    case "security":
      return {
        title: "De-risk security",
        line: "Makes sense—security is usually the deciding factor. What’s the top concern: access control, data retention, or auditability?",
        followUp: "Do you have a checklist (SOC2, SSO, DPA) we should align to so we don’t waste time?",
        ifPushed: "If it helps, we can start with a security overview and decide quickly if it’s a fit."
      };

    case "competitor":
      return {
        title: "Differentiate without trashing",
        line: "Got it—what do you like about what you’re using today, and what’s missing or frustrating?",
        followUp: "If you could fix one thing this month, what would it be?",
        ifPushed: "If the current tool is ‘good enough,’ the only reason to switch is a measurable win—want the 2–3 wins teams switch for?"
      };

    case "timeline":
      return {
        title: "Clarify timeline + next step",
        line: "To make this useful, what decision date are you working toward?",
        followUp: "What has to be true for you to feel confident saying yes by then?",
        ifPushed: "If timing is uncertain, we can set a small next step: 15 minutes to confirm fit and risks—worth doing?"
      };

    case "stakeholder":
      return {
        title: "Map stakeholders",
        line: "Who else needs to weigh in for this to move forward—security, legal, finance, or a manager?",
        followUp: "What’s their main concern likely to be?",
        ifPushed: "If we can get them a short summary + proof points, would you be open to inviting them to the next call?"
      };
  }
}
