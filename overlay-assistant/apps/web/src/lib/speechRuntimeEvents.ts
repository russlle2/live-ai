import {
  parseRuntimeEventV2,
  type RuntimeEventV2,
  type RuntimeProvenanceV2,
  type RuntimeSpeakerV2
} from "@overlay-assistant/runtime";

type SpeechEndReasonV2 = Extract<
  RuntimeEventV2["payload"],
  { type: "speech.ended" }
>["reason"];

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,239}$/;
let fallbackEventSequence = 0;

function defaultEventId(): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) return `event-${uuid}`;
  fallbackEventSequence =
    (fallbackEventSequence + 1) % Number.MAX_SAFE_INTEGER;
  return `event-${Date.now().toString(36)}-${fallbackEventSequence.toString(36)}`;
}

export class SpeechRuntimeEventFactoryV2 {
  private readonly sessionId: string;
  private readonly sourceId: string;
  private readonly speaker: RuntimeSpeakerV2;
  private readonly provenance: RuntimeProvenanceV2;
  private readonly confidence: number;
  private readonly monotonicNow: () => number;
  private readonly wallNow: () => Date;
  private readonly createEventId: () => string;
  private sequence = 0;
  private turnId: string | null = null;
  private startEvent: RuntimeEventV2 | null = null;

  constructor(options: {
    sessionId: string;
    sourceId: string;
    speaker: RuntimeSpeakerV2;
    provenance: RuntimeProvenanceV2;
    confidence: number;
    monotonicNow?: () => number;
    wallNow?: () => Date;
    createEventId?: () => string;
  }) {
    if (!ID_PATTERN.test(options.sessionId)) {
      throw new TypeError("sessionId must be a bounded protocol identifier");
    }
    if (!ID_PATTERN.test(options.sourceId)) {
      throw new TypeError("sourceId must be a bounded protocol identifier");
    }
    if (!Number.isFinite(options.confidence) ||
        options.confidence < 0 ||
        options.confidence > 1) {
      throw new TypeError("confidence must be between zero and one");
    }
    this.sessionId = options.sessionId;
    this.sourceId = options.sourceId;
    this.speaker = options.speaker;
    this.provenance = options.provenance;
    this.confidence = options.confidence;
    this.monotonicNow = options.monotonicNow ??
      (() => typeof performance === "undefined" ? Date.now() : performance.now());
    this.wallNow = options.wallNow ?? (() => new Date());
    this.createEventId = options.createEventId ?? defaultEventId;
  }

  start(): RuntimeEventV2 {
    if (this.startEvent) return this.startEvent;
    const eventId = this.createEventId();
    const turnId = `turn-${eventId}`;
    this.turnId = turnId;
    this.startEvent = this.event(eventId, {
      type: "speech.started",
      turnId,
      speaker: this.speaker
    });
    return this.startEvent;
  }

  end(reason: SpeechEndReasonV2): RuntimeEventV2 | null {
    if (!this.turnId) return null;
    const turnId = this.turnId;
    const event = this.event(this.createEventId(), {
      type: "speech.ended",
      turnId,
      reason
    });
    this.turnId = null;
    this.startEvent = null;
    return event;
  }

  get activeTurnId(): string | null {
    return this.turnId;
  }

  private event(
    eventId: string,
    payload: RuntimeEventV2["payload"]
  ): RuntimeEventV2 {
    this.sequence += 1;
    const captured = this.wallNow().toISOString();
    return parseRuntimeEventV2({
      protocolVersion: 2,
      eventId,
      sessionId: this.sessionId,
      sourceId: this.sourceId,
      sequence: this.sequence,
      capturedAtMonotonicMs: this.monotonicNow(),
      capturedAt: captured,
      receivedAt: captured,
      privacyClass: "private",
      provenance: this.provenance,
      confidence: this.confidence,
      payload
    });
  }
}
