export type ConfidenceBand = "low" | "medium" | "high";

export type CoachMeta = {
  stage?: string;
  moment?: string;
  microGoal?: string;
  hits?: string[];
  language?: string;
  usedProductPack?: boolean;
  usedFactsCount?: number;
  usedLLM?: boolean;
  confidence?: number;
  confidenceBand?: ConfidenceBand;
};

export type GuidanceItem = {
  id?: string;
  title?: string;
  category?: string;
  text?: string;
  suggestedText?: string;
  confidence?: number;
  confidenceBand?: ConfidenceBand;
  explanation?: any;
};

export type CoachPatch = {
  text?: string;
  settings?: any;
  guidance?: { items?: GuidanceItem[] };
};

export type EngineResult = {
  suppressed?: boolean;
  patch?: CoachPatch;
  meta?: CoachMeta;
  decision?: any;
};

export type ScenarioTurn = {
  // Turn template; can include "{product}" etc.
  template: string;
  weight?: number;
};

export type Scenario = {
  id: string;
  title: string;
  tags: string[];
  turns: ScenarioTurn[];
};

export type RunConfig = {
  minutes: number;
  sessions: number;
  turns: number;
  concurrency: number;
  seed: number;
  applyFacts: boolean;
  outRoot: string;
};
