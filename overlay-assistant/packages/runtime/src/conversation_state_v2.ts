import type {
  RuntimeEventV2,
  RuntimeProvenanceV2,
  RuntimeSpeakerV2
} from "./events_v2.js";

const MAX_COMMITTED_TURNS = 200;
const MAX_PROCESSED_EVENT_IDS = 4_096;
const SESSION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,239}$/;

export type ActiveTurnV2 = {
  turnId: string;
  sourceId: string;
  speaker: RuntimeSpeakerV2;
  startedAt: string;
  startedAtMonotonicMs: number;
  provenance: RuntimeProvenanceV2;
  confidence: number;
};

export type PartialTranscriptV2 = {
  turnId: string;
  sourceId: string;
  revision: number;
  text: string;
  stablePrefixLength: number;
  speaker: RuntimeSpeakerV2;
  updatedAt: string;
};

export type CommittedTurnV2 = {
  turnId: string;
  sourceId: string;
  text: string;
  speaker: RuntimeSpeakerV2;
  startedAt: string;
  endedAt: string;
  provenance: RuntimeProvenanceV2;
  confidence: number;
};

export type InterruptionV2 = {
  eventId: string;
  interruptedTurnId: string;
  interruptingTurnId: string;
  detectedAt: string;
};

export type ConversationStateV2 = {
  sessionId: string;
  activeTurns: ActiveTurnV2[];
  partials: Record<string, PartialTranscriptV2>;
  committedTurns: CommittedTurnV2[];
  overlapActive: boolean;
  reportedOverlapTurnIds: string[];
  lastInterruption: InterruptionV2 | null;
  processedEventIds: string[];
  sourceSequences: Record<string, number>;
};

export function initialConversationStateV2(sessionId: string): ConversationStateV2 {
  if (!SESSION_ID_PATTERN.test(sessionId)) {
    throw new TypeError("sessionId must be a bounded protocol identifier");
  }
  return {
    sessionId,
    activeTurns: [],
    partials: {},
    committedTurns: [],
    overlapActive: false,
    reportedOverlapTurnIds: [],
    lastInterruption: null,
    processedEventIds: [],
    sourceSequences: {}
  };
}

function acceptedBase(
  state: ConversationStateV2,
  event: RuntimeEventV2
): ConversationStateV2 | null {
  if (event.sessionId !== state.sessionId) {
    throw new Error(
      `runtime event session ${event.sessionId} does not match state session ${state.sessionId}`
    );
  }
  if (state.processedEventIds.includes(event.eventId)) return null;
  const previousSequence = state.sourceSequences[event.sourceId];
  if (previousSequence !== undefined && event.sequence <= previousSequence) return null;

  return {
    ...state,
    processedEventIds: [...state.processedEventIds, event.eventId].slice(
      -MAX_PROCESSED_EVENT_IDS
    ),
    sourceSequences: {
      ...state.sourceSequences,
      [event.sourceId]: event.sequence
    }
  };
}

function withOverlap(
  state: ConversationStateV2,
  activeTurns: ActiveTurnV2[],
  reportedOverlapTurnIds = state.reportedOverlapTurnIds
): ConversationStateV2 {
  return {
    ...state,
    activeTurns,
    reportedOverlapTurnIds,
    overlapActive: activeTurns.length > 1 || reportedOverlapTurnIds.length > 1
  };
}

function withoutPartial(
  partials: Record<string, PartialTranscriptV2>,
  turnId: string
): Record<string, PartialTranscriptV2> {
  if (!Object.prototype.hasOwnProperty.call(partials, turnId)) return partials;
  const next = { ...partials };
  delete next[turnId];
  return next;
}

export function reduceConversationStateV2(
  state: ConversationStateV2,
  event: RuntimeEventV2
): ConversationStateV2 {
  const base = acceptedBase(state, event);
  if (!base) return state;
  const payload = event.payload;

  switch (payload.type) {
    case "source.connected":
      return base;

    case "source.disconnected": {
      const removedTurnIds = new Set(
        base.activeTurns
          .filter((turn) => turn.sourceId === event.sourceId)
          .map((turn) => turn.turnId)
      );
      const partials = Object.fromEntries(
        Object.entries(base.partials).filter(
          ([turnId, partial]) =>
            partial.sourceId !== event.sourceId && !removedTurnIds.has(turnId)
        )
      );
      return {
        ...withOverlap(
          base,
          base.activeTurns.filter((turn) => turn.sourceId !== event.sourceId),
          base.reportedOverlapTurnIds.filter((turnId) => !removedTurnIds.has(turnId))
        ),
        partials
      };
    }

    case "speech.started": {
      if (base.activeTurns.some((turn) => turn.turnId === payload.turnId)) {
        return base;
      }
      const activeTurns = [
        ...base.activeTurns,
        {
          turnId: payload.turnId,
          sourceId: event.sourceId,
          speaker: payload.speaker,
          startedAt: event.capturedAt,
          startedAtMonotonicMs: event.capturedAtMonotonicMs,
          provenance: event.provenance,
          confidence: event.confidence
        }
      ];
      const interruptedOwner = payload.speaker === "remote"
        ? [...base.activeTurns]
          .reverse()
          .find((turn) => turn.speaker === "owner")
        : undefined;
      return {
        ...withOverlap(base, activeTurns),
        lastInterruption: interruptedOwner
          ? {
              eventId: event.eventId,
              interruptedTurnId: interruptedOwner.turnId,
              interruptingTurnId: payload.turnId,
              detectedAt: event.capturedAt
            }
          : base.lastInterruption
      };
    }

    case "speech.ended":
      return {
        ...withOverlap(
          base,
          base.activeTurns.filter((turn) => turn.turnId !== payload.turnId),
          base.reportedOverlapTurnIds.filter((turnId) => turnId !== payload.turnId)
        ),
        partials: withoutPartial(base.partials, payload.turnId)
      };

    case "transcript.partial": {
      const current = base.partials[payload.turnId];
      if (current && current.revision >= payload.revision) return base;
      return {
        ...base,
        partials: {
          ...base.partials,
          [payload.turnId]: {
            turnId: payload.turnId,
            sourceId: event.sourceId,
            revision: payload.revision,
            text: payload.text,
            stablePrefixLength: payload.stablePrefixLength,
            speaker: payload.speaker,
            updatedAt: event.capturedAt
          }
        }
      };
    }

    case "turn.committed": {
      const alreadyCommitted = base.committedTurns.some(
        (turn) => turn.turnId === payload.turnId
      );
      const committedTurns = alreadyCommitted
        ? base.committedTurns
        : [
            ...base.committedTurns,
            {
              turnId: payload.turnId,
              sourceId: event.sourceId,
              text: payload.text,
              speaker: payload.speaker,
              startedAt: payload.startedAt,
              endedAt: payload.endedAt,
              provenance: event.provenance,
              confidence: event.confidence
            }
          ].slice(-MAX_COMMITTED_TURNS);
      return {
        ...withOverlap(
          base,
          base.activeTurns.filter((turn) => turn.turnId !== payload.turnId),
          base.reportedOverlapTurnIds.filter((turnId) => turnId !== payload.turnId)
        ),
        committedTurns,
        partials: withoutPartial(base.partials, payload.turnId)
      };
    }

    case "overlap.started":
      return withOverlap(base, base.activeTurns, payload.turnIds);

    case "overlap.ended":
      return withOverlap(
        base,
        base.activeTurns,
        base.reportedOverlapTurnIds.filter(
          (turnId) => !payload.turnIds.includes(turnId)
        )
      );

    case "interruption.detected":
      return {
        ...base,
        lastInterruption: {
          eventId: event.eventId,
          interruptedTurnId: payload.interruptedTurnId,
          interruptingTurnId: payload.interruptingTurnId,
          detectedAt: event.capturedAt
        }
      };

    case "guidance.provisional":
    case "guidance.final":
    case "guidance.cancelled":
    case "guidance.superseded":
      return base;
  }
}
