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

/** Speaker role attribution */
export type SpeakerRoleV1 = "rep" | "customer" | "unknown";

/** A single speaker-attributed transcript entry */
export interface SpeakerTranscriptEntry {
  speaker: SpeakerRoleV1;
  text: string;
  at: string;
  confidence: number;
}

/** Per-speaker analytics tracked across the session */
export interface SpeakerStatsV1 {
  turns: number;
  words: number;
  avgEnergy: number;
}

export interface SessionMemoryV1 {
  transcriptWindow: string[];
  stage: CallStage;
  activeMoments: Set<DetectedMoment>;
  lastSuggestionAt?: number; // epoch ms

  /** Speaker-attributed transcript history (newest last) */
  speakerTranscript: SpeakerTranscriptEntry[];
  /** Last detected speaker */
  lastSpeaker: SpeakerRoleV1;
  /** Talk ratio: percentage of words said by rep */
  talkRatio: { rep: number; customer: number };
  /** Per-speaker stats */
  speakerStats: { rep: SpeakerStatsV1; customer: SpeakerStatsV1 };
  /** Last speaker change timestamp */
  lastSpeakerChangeAt?: number;
}

export function createSessionMemory(): SessionMemoryV1 {
  return {
    transcriptWindow: [],
    stage: "discovery",
    activeMoments: new Set(),
    speakerTranscript: [],
    lastSpeaker: "unknown",
    talkRatio: { rep: 50, customer: 50 },
    speakerStats: {
      rep: { turns: 0, words: 0, avgEnergy: 0 },
      customer: { turns: 0, words: 0, avgEnergy: 0 },
    },
  };
}

export function updateTranscript(memory: SessionMemoryV1, text: string, speaker?: SpeakerRoleV1, confidence?: number) {
  memory.transcriptWindow.push(text);
  if (memory.transcriptWindow.length > 12) memory.transcriptWindow.shift();

  // Speaker-attributed tracking
  const role = speaker ?? "unknown";
  const entry: SpeakerTranscriptEntry = {
    speaker: role,
    text,
    at: new Date().toISOString(),
    confidence: confidence ?? 0,
  };
  memory.speakerTranscript.push(entry);
  if (memory.speakerTranscript.length > 60) memory.speakerTranscript = memory.speakerTranscript.slice(-50);

  if (role !== "unknown") {
    if (role !== memory.lastSpeaker && memory.lastSpeaker !== "unknown") {
      memory.lastSpeakerChangeAt = Date.now();
    }
    memory.lastSpeaker = role;

    // Update per-speaker stats
    const wordCount = text.split(/\s+/).length;
    const stats = role === "rep" ? memory.speakerStats.rep : memory.speakerStats.customer;
    stats.turns += 1;
    stats.words += wordCount;

    // Update talk ratio
    const totalWords = memory.speakerStats.rep.words + memory.speakerStats.customer.words;
    if (totalWords > 0) {
      memory.talkRatio = {
        rep: Math.round((memory.speakerStats.rep.words / totalWords) * 100),
        customer: Math.round((memory.speakerStats.customer.words / totalWords) * 100),
      };
    }
  }
}

/**
 * Get the last N speaker-tagged transcript lines for display.
 */
export function getRecentSpeakerTranscript(memory: SessionMemoryV1, n = 20): SpeakerTranscriptEntry[] {
  return memory.speakerTranscript.slice(-n);
}
