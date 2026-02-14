export type ConfidenceBand = "low" | "medium" | "high";

export type GuidanceMode = "assist" | "auto" | "off";

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
