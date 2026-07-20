export type WebSocketBackpressureDecision =
  | "send"
  | "coalesce"
  | "disconnect";

const COALESCE_AFTER_BYTES = 256 * 1024;
const DISCONNECT_AFTER_BYTES = 1024 * 1024;

export function classifyWebSocketBackpressure(
  bufferedAmount: number
): WebSocketBackpressureDecision {
  if (!Number.isFinite(bufferedAmount) || bufferedAmount < 0) {
    return "disconnect";
  }
  if (bufferedAmount > DISCONNECT_AFTER_BYTES) return "disconnect";
  if (bufferedAmount > COALESCE_AFTER_BYTES) return "coalesce";
  return "send";
}
