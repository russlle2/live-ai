import type { OverlayMessageV1 } from "./overlay_messages_v1";

export const WS_CLIENT_MESSAGE_TYPES_V1 = ["start", "flush", "stop", "ping"] as const;

export type WsClientMessageV1 =
  | { type: "start"; session_id: string; tenantId: string; repId: string }
  | { type: "flush"; session_id: string }
  | { type: "stop"; session_id: string }
  | { type: "ping"; at: number };

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
  | TranscriptFinalV1
  | { type: "overlay_message"; session_id: string; at: string; message: OverlayMessageV1 }
  | { type: "error"; at: string; message: string; code: string; session_id?: string };
