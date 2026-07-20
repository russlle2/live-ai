export const RUNTIME_PROTOCOL_VERSION_V2 = 2 as const;

export type RuntimeSpeakerV2 = "owner" | "remote" | "unknown";

export type RuntimePrivacyClassV2 =
  | "public"
  | "private"
  | "sensitive"
  | "restricted";

export type RuntimeProvenanceV2 =
  | "platform_identity"
  | "separated_channel"
  | "process_loopback"
  | "device_route"
  | "owner_voice"
  | "diarization"
  | "manual"
  | "unverified";

export type RuntimeSourceKindV2 =
  | "windows_microphone"
  | "windows_loopback"
  | "windows_process_loopback"
  | "chromium_tab"
  | "bluetooth_input"
  | "android_microphone"
  | "zoom_rtms"
  | "twilio_media"
  | "meet_media"
  | "manual_text"
  | "unknown";

export type RuntimeEventPayloadV2 =
  | {
      type: "source.connected";
      sourceKind: RuntimeSourceKindV2;
      authoritativeSpeaker?: RuntimeSpeakerV2;
    }
  | {
      type: "source.disconnected";
      reason: "ended" | "device_change" | "network" | "error" | "manual";
    }
  | {
      type: "speech.started";
      turnId: string;
      speaker: RuntimeSpeakerV2;
    }
  | {
      type: "speech.ended";
      turnId: string;
      reason: "silence" | "source_end" | "max_duration" | "manual" | "cancelled";
    }
  | {
      type: "transcript.partial";
      turnId: string;
      revision: number;
      text: string;
      stablePrefixLength: number;
      speaker: RuntimeSpeakerV2;
    }
  | {
      type: "turn.committed";
      turnId: string;
      text: string;
      speaker: RuntimeSpeakerV2;
      startedAt: string;
      endedAt: string;
    }
  | {
      type: "overlap.started";
      turnIds: string[];
    }
  | {
      type: "overlap.ended";
      turnIds: string[];
    }
  | {
      type: "interruption.detected";
      interruptedTurnId: string;
      interruptingTurnId: string;
    }
  | {
      type: "guidance.provisional" | "guidance.final";
      guidanceId: string;
      basedOnTurnIds: string[];
      validUntilMonotonicMs: number;
    }
  | {
      type: "guidance.cancelled" | "guidance.superseded";
      guidanceId: string;
      reason: string;
    };

export type RuntimeEventV2 = {
  protocolVersion: typeof RUNTIME_PROTOCOL_VERSION_V2;
  eventId: string;
  sessionId: string;
  sourceId: string;
  sequence: number;
  capturedAtMonotonicMs: number;
  capturedAt: string;
  receivedAt: string;
  privacyClass: RuntimePrivacyClassV2;
  provenance: RuntimeProvenanceV2;
  confidence: number;
  payload: RuntimeEventPayloadV2;
};

type UnknownRecord = Record<string, unknown>;

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,239}$/;
const REASON_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;

const PRIVACY_CLASSES = new Set<RuntimePrivacyClassV2>([
  "public",
  "private",
  "sensitive",
  "restricted"
]);

const PROVENANCE_VALUES = new Set<RuntimeProvenanceV2>([
  "platform_identity",
  "separated_channel",
  "process_loopback",
  "device_route",
  "owner_voice",
  "diarization",
  "manual",
  "unverified"
]);

const SPEAKERS = new Set<RuntimeSpeakerV2>(["owner", "remote", "unknown"]);

const SOURCE_KINDS = new Set<RuntimeSourceKindV2>([
  "windows_microphone",
  "windows_loopback",
  "windows_process_loopback",
  "chromium_tab",
  "bluetooth_input",
  "android_microphone",
  "zoom_rtms",
  "twilio_media",
  "meet_media",
  "manual_text",
  "unknown"
]);

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function record(value: unknown, label: string): UnknownRecord {
  if (!isRecord(value)) throw new TypeError(`${label} must be an object`);
  return value;
}

function exactKeys(
  value: UnknownRecord,
  required: readonly string[],
  optional: readonly string[] = []
): void {
  const allowed = new Set([...required, ...optional]);
  for (const key of required) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) {
      throw new TypeError(`missing required field: ${key}`);
    }
  }
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new TypeError(`unknown field: ${key}`);
  }
}

function id(value: unknown, label: string): string {
  if (typeof value !== "string" || !ID_PATTERN.test(value)) {
    throw new TypeError(`${label} must be a bounded protocol identifier`);
  }
  return value;
}

function reason(value: unknown): string {
  if (typeof value !== "string" || !REASON_PATTERN.test(value)) {
    throw new TypeError("reason must be a bounded reason code");
  }
  return value;
}

function finiteNumber(
  value: unknown,
  label: string,
  minimum = Number.NEGATIVE_INFINITY,
  maximum = Number.POSITIVE_INFINITY
): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < minimum ||
    value > maximum
  ) {
    throw new TypeError(`${label} must be a finite number`);
  }
  return value;
}

function nonnegativeInteger(value: unknown, label: string): number {
  const parsed = finiteNumber(value, label, 0, Number.MAX_SAFE_INTEGER);
  if (!Number.isSafeInteger(parsed)) throw new TypeError(`${label} must be an integer`);
  return parsed;
}

function timestamp(value: unknown, label: string): string {
  if (
    typeof value !== "string" ||
    value.length > 100 ||
    !Number.isFinite(Date.parse(value))
  ) {
    throw new TypeError(`${label} must be a valid timestamp`);
  }
  return value;
}

function boundedText(value: unknown, label: string, maximum: number): string {
  if (typeof value !== "string" || value.length > maximum) {
    throw new TypeError(`${label} must be a bounded string`);
  }
  return value;
}

function oneOf<T extends string>(
  value: unknown,
  allowed: ReadonlySet<T>,
  label: string
): T {
  if (typeof value !== "string" || !allowed.has(value as T)) {
    throw new TypeError(`${label} is not supported`);
  }
  return value as T;
}

function ids(value: unknown, label: string, minimum = 1, maximum = 8): string[] {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum) {
    throw new TypeError(`${label} must contain ${minimum}-${maximum} identifiers`);
  }
  const parsed = value.map((entry, index) => id(entry, `${label}[${index}]`));
  if (new Set(parsed).size !== parsed.length) {
    throw new TypeError(`${label} must not contain duplicates`);
  }
  return parsed;
}

function parsePayload(input: unknown): RuntimeEventPayloadV2 {
  const value = record(input, "payload");
  const type = value.type;
  if (typeof type !== "string") throw new TypeError("payload.type must be a string");

  switch (type) {
    case "source.connected": {
      exactKeys(value, ["type", "sourceKind"], ["authoritativeSpeaker"]);
      const authoritativeSpeaker = value.authoritativeSpeaker === undefined
        ? undefined
        : oneOf(value.authoritativeSpeaker, SPEAKERS, "authoritativeSpeaker");
      return {
        type,
        sourceKind: oneOf(value.sourceKind, SOURCE_KINDS, "sourceKind"),
        ...(authoritativeSpeaker ? { authoritativeSpeaker } : {})
      };
    }
    case "source.disconnected":
      exactKeys(value, ["type", "reason"]);
      return {
        type,
        reason: oneOf(
          value.reason,
          new Set(["ended", "device_change", "network", "error", "manual"] as const),
          "source disconnect reason"
        )
      };
    case "speech.started":
      exactKeys(value, ["type", "turnId", "speaker"]);
      return {
        type,
        turnId: id(value.turnId, "turnId"),
        speaker: oneOf(value.speaker, SPEAKERS, "speaker")
      };
    case "speech.ended":
      exactKeys(value, ["type", "turnId", "reason"]);
      return {
        type,
        turnId: id(value.turnId, "turnId"),
        reason: oneOf(
          value.reason,
          new Set(["silence", "source_end", "max_duration", "manual", "cancelled"] as const),
          "speech end reason"
        )
      };
    case "transcript.partial": {
      exactKeys(value, [
        "type",
        "turnId",
        "revision",
        "text",
        "stablePrefixLength",
        "speaker"
      ]);
      const text = boundedText(value.text, "partial transcript", 20_000);
      const stablePrefixLength = nonnegativeInteger(
        value.stablePrefixLength,
        "stablePrefixLength"
      );
      if (stablePrefixLength > text.length) {
        throw new TypeError("stablePrefixLength exceeds transcript length");
      }
      return {
        type,
        turnId: id(value.turnId, "turnId"),
        revision: nonnegativeInteger(value.revision, "revision"),
        text,
        stablePrefixLength,
        speaker: oneOf(value.speaker, SPEAKERS, "speaker")
      };
    }
    case "turn.committed": {
      exactKeys(value, [
        "type",
        "turnId",
        "text",
        "speaker",
        "startedAt",
        "endedAt"
      ]);
      const startedAt = timestamp(value.startedAt, "startedAt");
      const endedAt = timestamp(value.endedAt, "endedAt");
      if (Date.parse(endedAt) < Date.parse(startedAt)) {
        throw new TypeError("endedAt precedes startedAt");
      }
      return {
        type,
        turnId: id(value.turnId, "turnId"),
        text: boundedText(value.text, "committed transcript", 20_000),
        speaker: oneOf(value.speaker, SPEAKERS, "speaker"),
        startedAt,
        endedAt
      };
    }
    case "overlap.started":
    case "overlap.ended":
      exactKeys(value, ["type", "turnIds"]);
      return { type, turnIds: ids(value.turnIds, "turnIds", 2, 8) };
    case "interruption.detected": {
      exactKeys(value, ["type", "interruptedTurnId", "interruptingTurnId"]);
      const interruptedTurnId = id(value.interruptedTurnId, "interruptedTurnId");
      const interruptingTurnId = id(value.interruptingTurnId, "interruptingTurnId");
      if (interruptedTurnId === interruptingTurnId) {
        throw new TypeError("an interruption requires two distinct turns");
      }
      return { type, interruptedTurnId, interruptingTurnId };
    }
    case "guidance.provisional":
    case "guidance.final":
      exactKeys(value, [
        "type",
        "guidanceId",
        "basedOnTurnIds",
        "validUntilMonotonicMs"
      ]);
      return {
        type,
        guidanceId: id(value.guidanceId, "guidanceId"),
        basedOnTurnIds: ids(value.basedOnTurnIds, "basedOnTurnIds"),
        validUntilMonotonicMs: finiteNumber(
          value.validUntilMonotonicMs,
          "validUntilMonotonicMs",
          0
        )
      };
    case "guidance.cancelled":
    case "guidance.superseded":
      exactKeys(value, ["type", "guidanceId", "reason"]);
      return {
        type,
        guidanceId: id(value.guidanceId, "guidanceId"),
        reason: reason(value.reason)
      };
    default:
      throw new TypeError(`unsupported runtime event type: ${type}`);
  }
}

export function parseRuntimeEventV2(input: unknown): RuntimeEventV2 {
  const value = record(input, "runtime event");
  exactKeys(value, [
    "protocolVersion",
    "eventId",
    "sessionId",
    "sourceId",
    "sequence",
    "capturedAtMonotonicMs",
    "capturedAt",
    "receivedAt",
    "privacyClass",
    "provenance",
    "confidence",
    "payload"
  ]);

  if (value.protocolVersion !== RUNTIME_PROTOCOL_VERSION_V2) {
    throw new TypeError("unsupported runtime protocol version");
  }

  return {
    protocolVersion: RUNTIME_PROTOCOL_VERSION_V2,
    eventId: id(value.eventId, "eventId"),
    sessionId: id(value.sessionId, "sessionId"),
    sourceId: id(value.sourceId, "sourceId"),
    sequence: nonnegativeInteger(value.sequence, "sequence"),
    capturedAtMonotonicMs: finiteNumber(
      value.capturedAtMonotonicMs,
      "capturedAtMonotonicMs",
      0
    ),
    capturedAt: timestamp(value.capturedAt, "capturedAt"),
    receivedAt: timestamp(value.receivedAt, "receivedAt"),
    privacyClass: oneOf(value.privacyClass, PRIVACY_CLASSES, "privacyClass"),
    provenance: oneOf(value.provenance, PROVENANCE_VALUES, "provenance"),
    confidence: finiteNumber(value.confidence, "confidence", 0, 1),
    payload: parsePayload(value.payload)
  };
}
