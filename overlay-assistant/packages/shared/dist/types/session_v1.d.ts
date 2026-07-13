export declare const SCENARIO_MODES_V1: readonly ["interview", "insurance_sales", "it_support", "inbound_service", "negotiation", "general"];
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
export declare const DEFAULT_SESSION_PROFILE_V1: SessionProfileV1;
