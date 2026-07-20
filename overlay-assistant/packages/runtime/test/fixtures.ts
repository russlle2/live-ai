import type {
  RuntimeEventPayloadV2,
  RuntimeEventV2
} from "../src/events_v2.js";

export function event(
  sequence: number,
  payload: RuntimeEventPayloadV2,
  sourceId = "owner-source",
  overrides: Partial<RuntimeEventV2> = {}
): RuntimeEventV2 {
  return {
    protocolVersion: 2,
    eventId: `evt-${sourceId}-${sequence}`,
    sessionId: "session-1",
    sourceId,
    sequence,
    capturedAtMonotonicMs: sequence * 10,
    capturedAt: `2026-07-20T18:00:${String(sequence).padStart(2, "0")}.000Z`,
    receivedAt: `2026-07-20T18:00:${String(sequence).padStart(2, "0")}.010Z`,
    privacyClass: "private",
    provenance: sourceId === "mixed-mic" ? "unverified" : "separated_channel",
    confidence: sourceId === "mixed-mic" ? 0 : 1,
    payload,
    ...overrides
  };
}
