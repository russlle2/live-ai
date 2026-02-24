import type { OverlayMessageV1 } from "./overlay_messages_v1";
import type {
  ClientDeviceType,
  ClientRoleV1,
  GuidanceControls,
  CoachControlCommandV1,
  CoachLearningSignalV1,
  CoachCorrectionMetaV1
} from "../types/core_types_v1";

export const WS_CLIENT_MESSAGE_TYPES_V1 = ["start", "flush", "stop", "ping", "control", "learning_signal"] as const;

export type WsClientMessageV1 =
  | { type: "start"; session_id: string; tenantId: string; repId: string; apiKey?: string; deviceType?: ClientDeviceType; clientName?: string; role?: ClientRoleV1 }
  | { type: "flush"; session_id: string }
  | { type: "stop"; session_id: string }
  | { type: "ping"; at: number }
  | ({ type: "control" } & CoachControlCommandV1)
  | ({ type: "learning_signal" } & CoachLearningSignalV1);

export type TranscriptFinalV1 = {
  type: "transcript_final";
  session_id: string;
  seq: number;
  at: string;
  text: string;
};

export type WsServerMessageV1 =
  | { type: "ready"; session_id: string; at: string }
  | { type: "pong"; at: number }
  | { type: "session_state"; session_id: string; at: string; state: { controls: GuidanceControls; connectedDevices: Array<{ id: string; type: ClientDeviceType; name?: string; role: ClientRoleV1 }> } }
  | { type: "correction"; session_id: string; at: string; correction: CoachCorrectionMetaV1 }
  | {
      type: "timeline_event";
      session_id: string;
      at: string;
      event: {
        id: number;
        createdAt: string;
        source: string;
        textExcerpt: string;
        entities: Array<{ type: string; value: string; confidence?: number }>;
        moments: string[];
        objections: string[];
        complianceRisks: Array<{ type: string; severity: string; phrase: string }>;
        confidence: number;
      };
    }
  | TranscriptFinalV1
  | { type: "overlay_message"; session_id: string; at: string; message: OverlayMessageV1 }
  | { type: "guidance_dashboard"; session_id: string; at: string; dashboard: Record<string, unknown> }
  | { type: "error"; at: string; message: string; code: string; session_id?: string };
