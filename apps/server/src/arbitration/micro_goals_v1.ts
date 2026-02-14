import type { CallStage, DetectedMoment, SessionMemoryV1 } from "./session_memory_v1";

export type MicroGoalV1 =
  | "clarify"
  | "define_requirements"
  | "reframe_value"
  | "differentiate"
  | "de_risk_security"
  | "advance_next_step"
  | "isolate_constraint"
  | "map_stakeholders"
  | "qualify_deployment";

export type MicroGoalPickV1 = { microGoal: MicroGoalV1; rationale: string };

export function pickMicroGoalV1(stage: CallStage, moment: DetectedMoment, memory: SessionMemoryV1): MicroGoalPickV1 {
  // Stage can override
  if (stage === "closing") {
    return { microGoal: "advance_next_step", rationale: "Stage=closing → drive next step + commitment." };
  }

  switch (moment) {
    case "integration":
      return { microGoal: "define_requirements", rationale: "Integration moment → define what “deep” means + map requirements." };
    case "security":
      return { microGoal: "de_risk_security", rationale: "Security moment → reduce risk + align to checklist." };
    case "competitor":
      return { microGoal: "differentiate", rationale: "Competitor moment → differentiate using their gaps + desired outcomes." };
    case "timeline":
      return { microGoal: "advance_next_step", rationale: "Timeline moment → pin decision date + define what must be true." };
    case "stakeholder":
      return { microGoal: "map_stakeholders", rationale: "Stakeholder moment → identify decision chain + concerns." };
    case "deployment":
      return { microGoal: "qualify_deployment", rationale: "Deployment/environment moment → clarify physical vs metaphor + constraints." };
    case "price":
    case "value":
      if (stage === "negotiation") {
        return { microGoal: "isolate_constraint", rationale: "Negotiation + price/value → isolate constraint (budget/terms) and scope." };
      }
      return { microGoal: "reframe_value", rationale: "Price/value moment → reframe + tailor to their comparison/outcome." };
    default:
      return { microGoal: "clarify", rationale: "Unknown moment → clarify outcome + risk so we don’t guess." };
  }
}
