export type ConfidenceBand = "low" | "medium" | "high";

export type GuidanceMode = "assist" | "auto" | "off";

export type ClientDeviceType = "desktop" | "mobile" | "bluetooth_remote";

export type ClientRoleV1 = "host" | "controller" | "viewer";

export type CoachControlActionV1 =
  | "toggle_mute"
  | "set_guidance_mode"
  | "set_ai_depth"
  | "accept_current"
  | "dismiss_current"
  | "request_reframe"
  | "mark_helpful"
  | "mark_unhelpful";

export type GuidanceControls = {
  guidanceMode: GuidanceMode;
  guidanceMuted: boolean;
  aiDepth: "P0" | "P1" | "P2" | "P3"; // deterministic ladder
  showLowConfidence: boolean;
};

export type ExplanationV1 = {
  [key: string]: any;
  schema: "explanation_v1";
  ruleId?: string;
  reasons: string[]; // pre-sanitized, no transcript text
  evidenceIds?: string[]; // chunk IDs only
};

export type GuidanceItemV1 = {
  id: string;
  category: string;
  title: string;
  text: string;
  confidence: number;
  confidenceBand: ConfidenceBand;
  createdAt: string;
  explanation?: ExplanationV1;
};

export type OverlaySettingsStateV1 = {
  controls: GuidanceControls;
  status?: {
    failureCode?: string;
  };
};

export type OverlayStateV1 = {
  text?: string;
  guidance: { items: GuidanceItemV1[] };
  settings: OverlaySettingsStateV1;
};

export type CoachControlCommandV1 = {
  action: CoachControlActionV1;
  session_id: string;
  at: string;
  source: ClientDeviceType;
  value?: string | number | boolean | null;
};

export type SessionPolicyV1 = {
  compatibilityTargets: Array<"bluetooth" | "zoom" | "google_meet" | "google_workspace" | "server_webhook">;
  universalMode: boolean;
};

export type CoachLearningSignalV1 = {
  session_id: string;
  itemId?: string;
  outcome: "helpful" | "unhelpful" | "ignored";
  source: ClientDeviceType;
  at: string;
};

export type CoachCorrectionMetaV1 = {
  reason: "interpretation_shift" | "user_reframe_request";
  from?: {
    stage?: string;
    moment?: string;
    lineHash?: string;
  };
  to?: {
    stage?: string;
    moment?: string;
    lineHash?: string;
  };
  note: string;
};
