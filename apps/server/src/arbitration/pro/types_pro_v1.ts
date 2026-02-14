export type SalesStageV1 = "discovery" | "evaluation" | "decision" | "closing";

export type ToneIdV1 =
  | "neutral"
  | "friendly"
  | "skeptical"
  | "technical"
  | "executive"
  | "urgent"
  | "frustrated"
  | "playful";

export type ToneProfileV1 = {
  id: ToneIdV1;
  confidence: number; // 0..1
  notes: string[];
  style: {
    brevity: "short" | "normal";
    warmth: "low" | "neutral" | "high";
    directness: "soft" | "neutral" | "direct";
  };
};

export type ObjectionKeyV1 =
  | "price"
  | "value_roi"
  | "integration"
  | "security_compliance"
  | "competitor"
  | "timing"
  | "authority"
  | "legal_procurement"
  | "risk_trust"
  | "feature_fit"
  | "deployment_it";

export type ObjectionStackEntryV1 = {
  key: ObjectionKeyV1;
  score: number; // 0..1 (decays over time)
  count: number; // number of times seen
  lastSeenAt: number; // epoch ms
  lastSnippet?: string; // tiny safe excerpt (no secrets; still keep short)
  reasons: string[]; // rx ids only
};

export type ObjectionStackV1 = {
  entries: ObjectionStackEntryV1[];
  top: ObjectionStackEntryV1[];
  newKeys: ObjectionKeyV1[];
  updated: boolean;
};

export type MomentumV1 = {
  score: number; // 0..100
  delta: number; // -100..100 (recent change)
  level: "low" | "medium" | "high";
  rationale: string[]; // short reason codes
};

export type SilenceCueV1 =
  | { type: "pause_after_question"; seconds: number; reason: string }
  | { type: "hold_space"; seconds: number; reason: string }
  | { type: "let_them_talk"; seconds: number; reason: string };

export type ProMetaV1 = {
  stage: SalesStageV1;
  momentum: MomentumV1;
  objectionsTop: Array<Pick<ObjectionStackEntryV1, "key" | "score" | "count">>;
  tone: ToneProfileV1;
  suppressed?: boolean;
  suppressedReason?: string;
};
