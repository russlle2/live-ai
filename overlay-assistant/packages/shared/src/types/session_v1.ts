export const SCENARIO_MODES_V1 = [
  "interview",
  "insurance_sales",
  "it_support",
  "inbound_service",
  "negotiation",
  "general"
] as const;

export type ScenarioModeV1 = (typeof SCENARIO_MODES_V1)[number];
export type ConversationSpeakerV1 = "rep" | "lead" | "unknown";
export type DeviceRoleV1 = "audio_host" | "companion";

export type SessionProfileV1 = {
  mode: ScenarioModeV1;
  targetRole?: string;
  company?: string;
  goal?: string;
  preContext?: string;
};

export const DEFAULT_SESSION_PROFILE_V1: SessionProfileV1 = {
  mode: "interview",
  targetRole: "",
  company: "",
  goal: "Earn the next step by answering clearly, credibly, and naturally.",
  preContext: ""
};
