export type CallStage = "discovery" | "evaluation" | "negotiation" | "closing";

// Moments are "what kind of situation is this?"
export type DetectedMoment =
  | "price"
  | "value"
  | "integration"
  | "security"
  | "competitor"
  | "timeline"
  | "stakeholder"
  | "deployment" // environment / deployment constraints questions
  | "unknown";

export interface SessionMemoryV1 {
  transcriptWindow: string[];
  stage: CallStage;
  activeMoments: Set<DetectedMoment>;
  lastSuggestionAt?: number; // epoch ms
}

export function createSessionMemory(): SessionMemoryV1 {
  return {
    transcriptWindow: [],
    stage: "discovery",
    activeMoments: new Set(),
  };
}

export function updateTranscript(memory: SessionMemoryV1, text: string) {
  memory.transcriptWindow.push(text);
  if (memory.transcriptWindow.length > 12) memory.transcriptWindow.shift();
}
