import type { OverlayMessageV1 } from "./overlay_messages_v1.js";
import type {
  ConversationSpeakerV1,
  DeviceRoleV1,
  SessionProfileV1
} from "../types/session_v1.js";

export const WS_CLIENT_MESSAGE_TYPES_V1 = ["start", "flush", "stop", "ping"] as const;

export type CaptureProvenanceV1 =
  | "dedicated_owner_mic"
  | "dedicated_browser_tab"
  | "verified_owner_voice"
  | "directional_inference"
  | "manual_label"
  | "unverified";

export type WsClientMessageV1 =
  | {
      type: "start";
      session_id: string;
      tenantId: string;
      repId: string;
      token?: string;
      deviceRole?: DeviceRoleV1;
      profile?: SessionProfileV1;
    }
  | { type: "flush"; session_id: string }
  | { type: "stop"; session_id: string }
  | { type: "ping"; at: number };

export type TranscriptFinalV1 = {
  type: "transcript_final";
  session_id: string;
  seq: number;
  at: string;
  text: string;
  speaker: ConversationSpeakerV1;
  /** Capture origin. A separated remote/system-audio channel is always `lead`. */
  source: ConversationSpeakerV1;
  captureProvenance?: CaptureProvenanceV1;
  attributionConfidence?: number;
  attributionReason?: string;
};

export type CoachingDeliveryV1 = {
  /** Stable across cushion, provisional, and final phases for one response cycle. */
  guidanceId: string;
  phase: "cushion" | "provisional" | "final";
  aiGenerated: boolean;
  category?: string;
  confidence?: number;
  latencyMs?: number;
  memoryFactIds?: string[];
  feedbackStatus?: "unmarked" | "accepted" | "ignored";
  /** Deterministic greeting-to-goodbye stage, when one applies. */
  playbookStageId?: string;
};

export type DeliveryClassificationV1 = "exact" | "paraphrased" | "changed";

/**
 * Emitted only after a verified owner (`rep`) final transcript can be paired
 * with the exact final line that was shown. This powers visible delivery
 * feedback without putting comparison work on the coaching hot path.
 */
export type DeliveryObservationMessageV1 = {
  type: "delivery_observation";
  session_id: string;
  guidanceId: string;
  seq: number;
  at: string;
  suggestion: string;
  actual: string;
  feedbackStatus: "unmarked" | "accepted";
  comparison: {
    classification: DeliveryClassificationV1;
    similarity: number;
    lengthRatio: number;
    note: string;
  };
  observationCount: number;
};

export type WsServerMessageV1 =
  | {
      type: "ready";
      session_id: string;
      at: string;
      deviceRole?: DeviceRoleV1;
      profile?: SessionProfileV1;
    }
  | { type: "pong"; at: number }
  | TranscriptFinalV1
  | DeliveryObservationMessageV1
  | {
      type: "interruption_detected";
      session_id: string;
      at: string;
      interruptedTurnId: string;
      interruptingTurnId: string;
    }
  | {
      type: "overlay_message";
      session_id: string;
      at: string;
      message: OverlayMessageV1;
      coaching?: CoachingDeliveryV1;
    }
  | { type: "error"; at: string; message: string; code: string; session_id?: string };
