import { useCallback, useEffect, useRef, useState } from "react";
import type { RuntimeEventV2 } from "@overlay-assistant/runtime";
import {
  startAudioFrameCapture,
  type AudioFrameCapture
} from "./audioFrameCapture";
import {
  getTranscriptionRuntimeStatus,
  transcribeLocalTurn
} from "./api";
import {
  DirectionalSpeakerFusion,
  estimateStereoDirection,
  interpretOwnerVerifierResult,
  type DirectionEstimate
} from "./directionalSpeaker";
import { RealtimeCommitBinder } from "./realtimeCommitBinder";
import { SpeechRuntimeEventFactoryV2 } from "./speechRuntimeEvents";
import { StreamingVadV2 } from "./streamingVadV2";
import { SynchronizedTurnAudioRecorder, type RecordedTurnAudio } from "./turnAudioRecorder";
import {
  encodePcm16Wav,
  INITIAL_VOICE_ENROLLMENT_STATUS,
  normalizeOwnerEnrollmentProgress,
  OWNER_ENROLLMENT_INSTALLATION_KEY,
  OWNER_ENROLLMENT_TARGET_SEGMENTS,
  shouldCollectOwnerEnrollment,
  startOwnerVoiceSegmentCapture,
  type OwnerVoiceCapture,
  type VoiceEnrollmentStatus
} from "./voiceEnrollment";

export type AudioSource = "rep" | "lead" | "unknown";
export type CaptureMode =
  | "idle"
  | "starting"
  | "separated"
  | "mixed_unverified"
  | "stopping"
  | "error";

export type RealtimeInterim = {
  source: AudioSource;
  text: string;
};

type UseSeparatedRealtimeOptions = {
  enabled: boolean;
  httpBase: string;
  sessionId: string;
  getAuthToken: () => Promise<string>;
  twoPartyDirectionalMode?: boolean;
  onFinal: (text: string, source: AudioSource, attribution: RealtimeSpeakerAttribution) => void;
  onInterim?: (event: RealtimeInterim) => void;
  onRuntimeEvent?: (event: RuntimeEventV2) => void;
  onVoiceEnrollmentStatus?: (status: VoiceEnrollmentStatus) => void;
  onDirectionalStatus?: (status: DirectionalAudioStatus) => void;
};

type ActiveTranscriber = {
  close: () => void;
  source: AudioSource;
};

export type RealtimeAttributionProvenance =
  | "dedicated_owner_mic"
  | "dedicated_browser_tab"
  | "verified_owner_voice"
  | "directional_inference"
  | "unverified";

export type RealtimeSpeakerAttribution = {
  provenance: RealtimeAttributionProvenance;
  confidence: number;
  reason: string;
  localTurnId?: string;
  direction?: DirectionEstimate;
};

export type DirectionalAudioPhase =
  | "off"
  | "checking"
  | "voice_only"
  | "mono"
  | "calibrating"
  | "ready"
  | "conflict"
  | "unavailable";

export type DirectionalAudioStatus = {
  phase: DirectionalAudioPhase;
  message: string;
  requested: boolean;
  channelCount: 0 | 1 | 2;
  ownerDirection: "left" | "right" | null;
  ownerCalibrationObservations: number;
  lastReason?: string;
};

type TokenResponse = {
  value?: string;
  token?: string;
  clientSecret?: string;
  client_secret?: { value?: string } | string;
};

type SpeakerHealthResponse = {
  enabled?: boolean;
  status?: string;
  ownerProfile?: string;
  sampleCount?: number;
  requiredSampleCount?: number;
  enrollmentComplete?: boolean;
};

type SpeakerEnrollmentResponse = {
  accepted?: boolean;
  enrolled?: boolean;
  sampleCount?: number;
  requiredSampleCount?: number;
  enrollmentComplete?: boolean;
  message?: string;
  error?: string;
};

type SpeakerClassificationResponse = {
  label?: "owner" | "unknown";
  similarity?: number | null;
  threshold?: number | null;
  reason?: string;
  audioSeconds?: number | null;
  decisionPolicy?: string;
  serviceAvailable?: boolean;
};

type MixedSpeakerDecision = {
  source: AudioSource;
  attribution: RealtimeSpeakerAttribution;
};

const OPENAI_REALTIME_CALLS_URL = "https://api.openai.com/v1/realtime/calls";
const MIXED_VOICE_DECISION_WAIT_MS = 900;
const COMMIT_EVIDENCE_TTL_MS = 30_000;

const INITIAL_DIRECTIONAL_STATUS: DirectionalAudioStatus = {
  phase: "off",
  message: "Directional speaker inference is off.",
  requested: false,
  channelCount: 0,
  ownerDirection: null,
  ownerCalibrationObservations: 0
};

function unknownDecision(reason: string, localTurnId?: string, direction?: DirectionEstimate): MixedSpeakerDecision {
  return {
    source: "unknown",
    attribution: {
      provenance: "unverified",
      confidence: 0,
      reason,
      ...(localTurnId ? { localTurnId } : {}),
      ...(direction ? { direction } : {})
    }
  };
}

function extractClientSecret(payload: TokenResponse): string {
  if (typeof payload.value === "string") return payload.value;
  if (typeof payload.token === "string") return payload.token;
  if (typeof payload.clientSecret === "string") return payload.clientSecret;
  if (typeof payload.client_secret === "string") return payload.client_secret;
  if (payload.client_secret && typeof payload.client_secret.value === "string") {
    return payload.client_secret.value;
  }
  throw new Error("The server did not return a Realtime client secret.");
}

function stopStream(stream: MediaStream | null | undefined) {
  stream?.getTracks().forEach((track) => track.stop());
}

/**
 * Uses two independent browser capture paths instead of trying to infer identity
 * from one mixed waveform:
 *   - getUserMedia microphone => self
 *   - getDisplayMedia tab/system audio => other person
 *
 * If display audio is unavailable, the microphone can still be transcribed, but
 * its output is deliberately labelled unknown because it may hear both speakers.
 */
export function useSeparatedRealtimeTranscription(options: UseSeparatedRealtimeOptions) {
  const [mode, setMode] = useState<CaptureMode>("idle");
  const [message, setMessage] = useState("Audio capture is off.");
  const [voiceEnrollment, setVoiceEnrollment] = useState<VoiceEnrollmentStatus>(INITIAL_VOICE_ENROLLMENT_STATUS);
  const [directionalStatus, setDirectionalStatus] = useState<DirectionalAudioStatus>(INITIAL_DIRECTIONAL_STATUS);
  const activeRef = useRef<ActiveTranscriber[]>([]);
  const streamsRef = useRef<MediaStream[]>([]);
  const enrollmentCaptureRef = useRef<OwnerVoiceCapture | null>(null);
  const directionalFusionRef = useRef(new DirectionalSpeakerFusion());
  const enrollmentGenerationRef = useRef(0);
  const mountedRef = useRef(true);
  const callbackRef = useRef(options);

  useEffect(() => {
    callbackRef.current = options;
  }, [options]);

  const publishVoiceEnrollment = useCallback((status: VoiceEnrollmentStatus) => {
    if (!mountedRef.current) return;
    setVoiceEnrollment(status);
    callbackRef.current.onVoiceEnrollmentStatus?.(status);
  }, []);

  const publishDirectionalStatus = useCallback((status: DirectionalAudioStatus) => {
    if (!mountedRef.current) return;
    setDirectionalStatus(status);
    callbackRef.current.onDirectionalStatus?.(status);
  }, []);

  useEffect(() => {
    const resetPhysicalCalibration = () => {
      directionalFusionRef.current.reset();
      if (callbackRef.current.twoPartyDirectionalMode) {
        publishDirectionalStatus({
          ...INITIAL_DIRECTIONAL_STATUS,
          phase: "checking",
          requested: true,
          message: "Device position changed. Learning your fixed side again before directional labels resume."
        });
      }
    };
    window.addEventListener("orientationchange", resetPhysicalCalibration);
    navigator.mediaDevices?.addEventListener?.("devicechange", resetPhysicalCalibration);
    return () => {
      window.removeEventListener("orientationchange", resetPhysicalCalibration);
      navigator.mediaDevices?.removeEventListener?.("devicechange", resetPhysicalCalibration);
    };
  }, [publishDirectionalStatus]);

  const closeAll = useCallback(() => {
    enrollmentGenerationRef.current += 1;
    enrollmentCaptureRef.current?.stop();
    enrollmentCaptureRef.current = null;
    directionalFusionRef.current.reset();
    for (const transcriber of activeRef.current.splice(0)) transcriber.close();
    for (const stream of streamsRef.current.splice(0)) stopStream(stream);
  }, []);

  const stop = useCallback(() => {
    setMode("stopping");
    closeAll();
    setMode("idle");
    setMessage("Audio capture is off.");
    publishDirectionalStatus(INITIAL_DIRECTIONAL_STATUS);
    callbackRef.current.onInterim?.({ source: "unknown", text: "" });
  }, [closeAll, publishDirectionalStatus]);

  const classifyMixedTurn = useCallback(async (
    audio: RecordedTurnAudio,
    generation: number,
    localTurnId: string
  ): Promise<MixedSpeakerDecision> => {
    const requested = callbackRef.current.twoPartyDirectionalMode === true;
    const direction = estimateStereoDirection(audio.left, audio.right, audio.sampleRate);
    const currentCalibration = directionalFusionRef.current.getCalibration();
    const statusBase = {
      requested,
      channelCount: audio.channelCount as 1 | 2,
      ownerDirection: currentCalibration.ownerDirection,
      ownerCalibrationObservations: currentCalibration.ownerCalibrationObservations,
      lastReason: direction.reason
    };
    if (generation !== enrollmentGenerationRef.current || !mountedRef.current) {
      return unknownDecision("stale_capture_generation", localTurnId, direction);
    }

    // In explicit directional mode, invalid spatial evidence invalidates the
    // entire mixed attribution. Turn the mode off to retain owner-only voice
    // matching on a mono/dual-mono device.
    const strongSideDirection = (direction.direction === "left" || direction.direction === "right")
      && direction.confidence >= 0.75;
    if (requested && !strongSideDirection) {
      const phase: DirectionalAudioPhase = audio.channelCount < 2 || direction.reason === "dual_mono"
        ? "mono"
        : direction.reason === "ambiguous_overlap" || direction.reason === "conflicting_cues"
          ? "conflict"
          : "calibrating";
      publishDirectionalStatus({
        ...statusBase,
        phase,
        message: phase === "mono"
          ? "The browser exposed mono or duplicated audio; direction is unavailable and this speaker stays Unknown."
          : phase === "conflict"
            ? "Spatial cues conflict or speakers overlap; this speaker stays Unknown."
            : "No stable left/right position was found; this speaker stays Unknown."
      });
      return unknownDecision(`direction_${direction.reason}`, localTurnId, direction);
    }

    let wav: Uint8Array;
    try {
      wav = encodePcm16Wav(audio.mono, audio.sampleRate);
    } catch {
      publishDirectionalStatus({
        ...statusBase,
        phase: requested ? "calibrating" : "voice_only",
        message: "This turn was unsuitable for owner verification and remains Unknown."
      });
      return unknownDecision("voice_segment_invalid", localTurnId, direction);
    }

    let result: SpeakerClassificationResponse;
    try {
      const authToken = await callbackRef.current.getAuthToken();
      const wavBody = new ArrayBuffer(wav.byteLength);
      new Uint8Array(wavBody).set(wav);
      const response = await fetch(`${callbackRef.current.httpBase}/api/speaker/classify`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${authToken}`,
          "Content-Type": "audio/wav"
        },
        body: wavBody
      });
      result = (await response.json().catch(() => ({}))) as SpeakerClassificationResponse;
      if (!response.ok) throw new Error("speaker_verification_failed");
    } catch {
      publishDirectionalStatus({
        ...statusBase,
        phase: "unavailable",
        message: "Owner-voice verification is unavailable; mixed speech remains Unknown."
      });
      return unknownDecision("speaker_service_unavailable", localTurnId, direction);
    }
    if (generation !== enrollmentGenerationRef.current || !mountedRef.current) {
      return unknownDecision("stale_capture_generation", localTurnId, direction);
    }

    const voice = interpretOwnerVerifierResult(result);
    const fusion = directionalFusionRef.current.evaluate({
      provenance: "mixed_acoustic",
      direction,
      voiceIdentity: voice.identity,
      voiceConfidence: voice.confidence,
      twoPartyAcousticMode: requested
    });
    const nextStatusBase = {
      ...statusBase,
      ownerDirection: fusion.ownerDirection,
      ownerCalibrationObservations: fusion.ownerCalibrationObservations,
      lastReason: fusion.reason
    };

    if (result.serviceAvailable === false) {
      publishDirectionalStatus({
        ...nextStatusBase,
        phase: "unavailable",
        message: "Owner-voice verification is not configured; mixed speech remains Unknown."
      });
    } else if (!requested) {
      publishDirectionalStatus({
        ...nextStatusBase,
        phase: "voice_only",
        message: fusion.speaker === "owner"
          ? "Owner voice matched. Direction stays off until two-person mode is explicitly enabled."
          : "Owner-only voice matching is active; non-matches remain Unknown."
      });
    } else if (fusion.reason === "owner_direction_conflict" || fusion.reason === "voice_direction_conflict") {
      publishDirectionalStatus({
        ...nextStatusBase,
        phase: "conflict",
        message: "Voice and position disagree. Keep the device fixed; this speaker remains Unknown."
      });
    } else if (fusion.ownerDirection) {
      publishDirectionalStatus({
        ...nextStatusBase,
        phase: "ready",
        message: fusion.speaker === "lead"
          ? "Stable opposite-side speaker inferred after repeated evidence."
          : `Direction ready: your calibrated side is ${fusion.ownerDirection}.`
      });
    } else {
      publishDirectionalStatus({
        ...nextStatusBase,
        phase: "calibrating",
        message: `Learning your fixed side from verified voice ${fusion.ownerCalibrationObservations}/3.`
      });
    }

    if (fusion.speaker === "owner") {
      return {
        source: "rep",
        attribution: {
          provenance: "verified_owner_voice",
          confidence: fusion.confidence,
          reason: fusion.reason,
          localTurnId,
          direction
        }
      };
    }
    if (fusion.speaker === "lead") {
      return {
        source: "lead",
        attribution: {
          provenance: "directional_inference",
          confidence: fusion.confidence,
          reason: fusion.reason,
          localTurnId,
          direction
        }
      };
    }
    return unknownDecision(fusion.reason, localTurnId, direction);
  }, [publishDirectionalStatus]);

  const createLocalTranscriber = useCallback(async (
    stream: MediaStream,
    outputSource: AudioSource
  ) => {
    const audioTrack = stream.getAudioTracks()[0];
    if (!audioTrack) throw new Error("The selected local audio source has no audio track.");
    const AudioContextCtor = window.AudioContext || (window as typeof window & {
      webkitAudioContext?: typeof AudioContext;
    }).webkitAudioContext;
    if (!AudioContextCtor) throw new Error("Web Audio is required for local transcription.");

    const audioContext = new AudioContextCtor();
    if (audioContext.state === "suspended") void audioContext.resume().catch(() => undefined);
    const sourceNode = audioContext.createMediaStreamSource(stream);
    const mixedMode = outputSource === "unknown";
    const reportedChannels = audioTrack.getSettings().channelCount;
    const channelCount: 1 | 2 = typeof reportedChannels === "number" && reportedChannels >= 2 ? 2 : 1;
    const recorder = new SynchronizedTurnAudioRecorder({
      sampleRate: audioContext.sampleRate,
      channelCount,
      maxDurationMs: 15_000
    });
    const captureGeneration = enrollmentGenerationRef.current;
    const runtimeEvents = new SpeechRuntimeEventFactoryV2({
      sessionId: callbackRef.current.sessionId,
      sourceId: `local-${outputSource}`,
      speaker: outputSource === "rep"
        ? "owner"
        : outputSource === "lead"
          ? "remote"
          : "unknown",
      provenance: mixedMode ? "unverified" : "separated_channel",
      confidence: mixedMode ? 0 : 1
    });
    const vad = new StreamingVadV2({
      sampleRate: audioContext.sampleRate,
      minimumSpeechMs: 120,
      silenceToEndMs: 460,
      maximumSpeechMs: 15_000
    });
    const controllers = new Set<AbortController>();
    let turnSequence = 0;
    let stopped = false;
    let transcriptionQueue = Promise.resolve();

    const transcribe = (recorded: RecordedTurnAudio) => {
      turnSequence += 1;
      const localTurnId = `${captureGeneration}-${turnSequence}`;
      const decision = mixedMode
        ? classifyMixedTurn(recorded, captureGeneration, localTurnId)
        : Promise.resolve({
          source: outputSource,
          attribution: {
            provenance: outputSource === "rep"
              ? "dedicated_owner_mic" as const
              : "dedicated_browser_tab" as const,
            confidence: 1,
            reason: outputSource === "rep"
              ? "dedicated_owner_mic"
              : "dedicated_browser_tab"
          }
        });
      const wav = encodePcm16Wav(recorded.mono, recorded.sampleRate, {
        maxDurationSeconds: 15
      });
      callbackRef.current.onInterim?.({
        source: outputSource,
        text: "Transcribing locally…"
      });
      transcriptionQueue = transcriptionQueue.catch(() => undefined).then(async () => {
        if (stopped || captureGeneration !== enrollmentGenerationRef.current) return;
        const controller = new AbortController();
        controllers.add(controller);
        try {
          const token = await callbackRef.current.getAuthToken();
          const [transcript, speakerDecision] = await Promise.all([
            transcribeLocalTurn(
              wav,
              callbackRef.current.httpBase,
              token,
              controller.signal
            ),
            decision
          ]);
          if (
            !stopped &&
            captureGeneration === enrollmentGenerationRef.current &&
            mountedRef.current
          ) {
            callbackRef.current.onFinal(
              transcript.text,
              speakerDecision.source,
              speakerDecision.attribution
            );
          }
        } finally {
          controllers.delete(controller);
          callbackRef.current.onInterim?.({ source: outputSource, text: "" });
        }
      }).catch((error: unknown) => {
        if (!stopped) {
          setMessage(
            error instanceof Error
              ? error.message
              : "Local transcription failed."
          );
        }
      });
    };

    let frameCapture: AudioFrameCapture;
    try {
      frameCapture = await startAudioFrameCapture({
        audioContext,
        source: sourceNode,
        channelCount,
        onFrame: ({ left, right }) => {
          recorder.push(left, right);
          for (const vadEvent of vad.push(left)) {
            if (vadEvent === "speech_started") {
              callbackRef.current.onRuntimeEvent?.(runtimeEvents.start());
              recorder.begin();
            } else if (vadEvent === "speech_ended") {
              const ended = runtimeEvents.end("silence");
              if (ended) callbackRef.current.onRuntimeEvent?.(ended);
              const recorded = recorder.finish();
              if (recorded) transcribe(recorded);
            } else {
              const cancelled = runtimeEvents.end("cancelled");
              if (cancelled) callbackRef.current.onRuntimeEvent?.(cancelled);
              recorder.cancel();
            }
          }
        },
        onError: (error) => setMessage(error.message)
      });
    } catch (error) {
      sourceNode.disconnect();
      void audioContext.close();
      throw error;
    }

    if (mixedMode) {
      publishDirectionalStatus({
        phase: "voice_only",
        message: "Local mixed-audio transcription is active; uncertain speakers remain Unknown.",
        requested: callbackRef.current.twoPartyDirectionalMode === true,
        channelCount,
        ownerDirection: null,
        ownerCalibrationObservations: 0
      });
    }

    const close = () => {
      if (stopped) return;
      stopped = true;
      for (const controller of controllers) controller.abort();
      controllers.clear();
      const ended = runtimeEvents.end("source_end");
      if (ended) callbackRef.current.onRuntimeEvent?.(ended);
      vad.reset();
      recorder.cancel();
      frameCapture.stop();
      sourceNode.disconnect();
      void audioContext.close();
    };
    activeRef.current.push({ close, source: outputSource });
  }, [classifyMixedTurn, publishDirectionalStatus]);

  const createTranscriber = useCallback(
    async (stream: MediaStream, tokenSource: "rep" | "lead", outputSource: AudioSource) => {
      const authToken = await callbackRef.current.getAuthToken();
      const tokenResponse = await fetch(`${callbackRef.current.httpBase}/api/realtime/token`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`
        },
        body: JSON.stringify({
          session_id: callbackRef.current.sessionId,
          source: tokenSource
        })
      });

      const tokenPayload = (await tokenResponse.json().catch(() => ({}))) as TokenResponse & {
        message?: string;
        error?: string;
      };
      if (!tokenResponse.ok) {
        throw new Error(tokenPayload.message || tokenPayload.error || `Realtime token failed (${tokenResponse.status}).`);
      }
      const ephemeralKey = extractClientSecret(tokenPayload);

      const peer = new RTCPeerConnection();
      const events = peer.createDataChannel("oai-events");
      const audioTrack = stream.getAudioTracks()[0];
      if (!audioTrack) throw new Error(`No ${tokenSource === "lead" ? "shared" : "microphone"} audio track was available.`);
      peer.addTrack(audioTrack, stream);

      const mixedMode = outputSource === "unknown";
      const captureGeneration = enrollmentGenerationRef.current;
      const runtimeEvents = new SpeechRuntimeEventFactoryV2({
        sessionId: callbackRef.current.sessionId,
        sourceId: `realtime-${tokenSource}-${outputSource}`,
        speaker: outputSource === "rep"
          ? "owner"
          : outputSource === "lead"
            ? "remote"
            : "unknown",
        provenance: mixedMode ? "unverified" : "separated_channel",
        confidence: mixedMode ? 0 : 1
      });
      const commitBinder = new RealtimeCommitBinder<MixedSpeakerDecision>();
      let partial = "";
      let recorder: SynchronizedTurnAudioRecorder | null = null;
      let frameCapture: AudioFrameCapture | null = null;
      let committedForTurn = false;
      let localTurnSequence = 0;

      events.addEventListener("message", (event) => {
        try {
          const data = JSON.parse(String(event.data)) as Record<string, unknown>;
          const type = typeof data.type === "string" ? data.type : "";
          if (type === "input_audio_buffer.committed" && mixedMode) {
            commitBinder.bindNext(typeof data.item_id === "string" ? data.item_id : null);
          }
          if (type === "conversation.item.input_audio_transcription.delta") {
            const delta = typeof data.delta === "string" ? data.delta : "";
            partial += delta;
            callbackRef.current.onInterim?.({ source: outputSource, text: partial.trimStart() });
          }
          if (type === "conversation.item.input_audio_transcription.completed") {
            const completed = typeof data.transcript === "string" ? data.transcript.trim() : partial.trim();
            partial = "";
            callbackRef.current.onInterim?.({ source: outputSource, text: "" });
            if (completed) {
              const itemId = typeof data.item_id === "string" ? data.item_id : null;
              const pending = mixedMode ? commitBinder.take(itemId) : null;
              void (async () => {
                const decision = mixedMode
                  ? pending
                    ? await Promise.race<MixedSpeakerDecision>([
                      pending.decision.catch(() => unknownDecision("speaker_decision_failed", pending.localTurnId)),
                      new Promise<MixedSpeakerDecision>((resolve) => {
                        window.setTimeout(() => resolve(unknownDecision("speaker_decision_timeout", pending.localTurnId)), MIXED_VOICE_DECISION_WAIT_MS);
                      })
                    ])
                    : unknownDecision(itemId ? "missing_commit_evidence" : "missing_realtime_item_id")
                  : {
                    source: outputSource,
                    attribution: {
                      provenance: outputSource === "rep" ? "dedicated_owner_mic" : "dedicated_browser_tab",
                      confidence: 1,
                      reason: outputSource === "rep" ? "dedicated_owner_mic" : "dedicated_browser_tab"
                    }
                  } satisfies MixedSpeakerDecision;
                if (captureGeneration === enrollmentGenerationRef.current && mountedRef.current) {
                  callbackRef.current.onFinal(completed, decision.source, decision.attribution);
                }
              })();
            }
          }
          if (type === "error") {
            const nested = data.error && typeof data.error === "object" ? data.error as Record<string, unknown> : undefined;
            const detail = typeof nested?.message === "string" ? nested.message : "Realtime transcription reported an error.";
            setMessage(detail);
          }
        } catch {
          // Ignore malformed transport events; a later valid completion can still arrive.
        }
      });

      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      const answerResponse = await fetch(OPENAI_REALTIME_CALLS_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${ephemeralKey}`,
          "Content-Type": "application/sdp"
        },
        body: offer.sdp
      });
      if (!answerResponse.ok) {
        const detail = await answerResponse.text().catch(() => "");
        peer.close();
        throw new Error(`Realtime connection failed (${answerResponse.status})${detail ? `: ${detail.slice(0, 160)}` : "."}`);
      }
      await peer.setRemoteDescription({ type: "answer", sdp: await answerResponse.text() });

      // Manual commits are driven by audio-time VAD frames from AudioWorklet,
      // not requestAnimationFrame, so background-tab throttling cannot stall turns.
      const AudioContextCtor = window.AudioContext || (window as typeof window & {
        webkitAudioContext?: typeof AudioContext;
      }).webkitAudioContext;
      if (!AudioContextCtor) {
        events.close();
        peer.close();
        throw new Error("Web Audio is required for reliable turn detection.");
      }
      const audioContext = new AudioContextCtor();
      if (audioContext.state === "suspended") void audioContext.resume().catch(() => undefined);
      const sourceNode = audioContext.createMediaStreamSource(stream);
      const reportedChannels = audioTrack.getSettings().channelCount;
      const recorderChannelCount: 1 | 2 = mixedMode && typeof reportedChannels === "number" && reportedChannels >= 2 ? 2 : 1;
      if (mixedMode) {
        recorder = new SynchronizedTurnAudioRecorder({
          sampleRate: audioContext.sampleRate,
          channelCount: recorderChannelCount
        });
      }

      let pendingCommit = false;
      let pendingRecorded: RecordedTurnAudio | null = null;
      const sendCommit = (recorded: RecordedTurnAudio | null) => {
        if (events.readyState !== "open") return;
        if (mixedMode) {
          localTurnSequence += 1;
          const localTurnId = `${captureGeneration}-${localTurnSequence}`;
          commitBinder.enqueue({
            localTurnId,
            committedAt: Date.now(),
            decision: recorded
              ? classifyMixedTurn(recorded, captureGeneration, localTurnId)
              : Promise.resolve(unknownDecision("no_synchronized_pcm", localTurnId))
          });
        }
        events.send(JSON.stringify({ type: "input_audio_buffer.commit" }));
        committedForTurn = true;
        pendingCommit = false;
        pendingRecorded = null;
      };
      const commit = () => {
        const recorded = mixedMode ? recorder?.finish() ?? null : null;
        if (events.readyState !== "open") {
          pendingCommit = true;
          pendingRecorded = recorded;
          committedForTurn = true;
          return;
        }
        sendCommit(recorded);
      };
      events.addEventListener("open", () => {
        if (pendingCommit) sendCommit(pendingRecorded);
      });

      const vad = new StreamingVadV2({
        sampleRate: audioContext.sampleRate,
        minimumSpeechMs: 120,
        silenceToEndMs: 460,
        maximumSpeechMs: 15_000
      });
      try {
        frameCapture = await startAudioFrameCapture({
          audioContext,
          source: sourceNode,
          channelCount: recorderChannelCount,
          onFrame: ({ left, right }) => {
            recorder?.push(left, right);
            for (const vadEvent of vad.push(left)) {
              if (vadEvent === "speech_started") {
                callbackRef.current.onRuntimeEvent?.(runtimeEvents.start());
                recorder?.begin();
                committedForTurn = false;
              } else if (vadEvent === "speech_ended" && !committedForTurn) {
                const ended = runtimeEvents.end("silence");
                if (ended) callbackRef.current.onRuntimeEvent?.(ended);
                commit();
              } else if (vadEvent === "speech_cancelled") {
                const cancelled = runtimeEvents.end("cancelled");
                if (cancelled) callbackRef.current.onRuntimeEvent?.(cancelled);
                recorder?.cancel();
                committedForTurn = true;
                if (events.readyState === "open") {
                  events.send(JSON.stringify({ type: "input_audio_buffer.clear" }));
                }
              }
            }
          },
          onError: () => {
            setMessage("Low-level audio analysis stopped; automatic turn commits are unavailable.");
          }
        });
      } catch (error) {
        sourceNode.disconnect();
        void audioContext.close();
        events.close();
        peer.close();
        throw error;
      }
      if (mixedMode) {
        const requested = callbackRef.current.twoPartyDirectionalMode === true;
        publishDirectionalStatus({
          phase: requested ? recorderChannelCount === 2 ? "checking" : "mono" : "voice_only",
          message: requested
            ? recorderChannelCount === 2
              ? "Stereo input found. Learning your fixed side from verified owner turns."
              : "The browser exposed mono input; directional inference will remain Unknown."
            : "Owner-only voice matching is active; directional inference is off.",
          requested,
          channelCount: recorderChannelCount,
          ownerDirection: null,
          ownerCalibrationObservations: 0
        });
      }

      if (events.readyState === "open" && pendingCommit) {
        sendCommit(pendingRecorded);
      }
      const evidenceExpiryTimer = window.setInterval(() => {
        commitBinder.expireBefore(Date.now() - COMMIT_EVIDENCE_TTL_MS);
      }, 5_000);

      const close = () => {
        window.clearInterval(evidenceExpiryTimer);
        commitBinder.clear();
        const ended = runtimeEvents.end("source_end");
        if (ended) callbackRef.current.onRuntimeEvent?.(ended);
        vad.reset();
        pendingCommit = false;
        pendingRecorded = null;
        recorder?.cancel();
        frameCapture?.stop();
        sourceNode.disconnect();
        void audioContext.close();
        if (events.readyState === "open") {
          events.send(JSON.stringify({ type: "input_audio_buffer.clear" }));
        }
        events.close();
        peer.close();
      };
      activeRef.current.push({ close, source: outputSource });
    },
    [classifyMixedTurn, publishDirectionalStatus]
  );

  const beginAutomaticVoiceEnrollment = useCallback(async (
    micStream: MediaStream,
    sessionId: string,
    generation: number
  ) => {
    // This function is called only after both independent transcribers are live.
    // Do not weaken this gate: a mixed/unknown stream must never become enrollment.
    if (!shouldCollectOwnerEnrollment("rep", true)) return;

    let existingSampleCount = 0;
    let requiredSampleCount = OWNER_ENROLLMENT_TARGET_SEGMENTS;
    const baseStatus = () => ({
      collectedSegments: 0,
      uploadedSegments: existingSampleCount,
      targetSegments: requiredSampleCount,
      fallback: "separate_channels" as const
    });
    const fail = (error: unknown, phase: "unavailable" | "failed" = "failed") => {
      enrollmentCaptureRef.current?.stop();
      enrollmentCaptureRef.current = null;
      publishVoiceEnrollment({
        ...baseStatus(),
        phase,
        message: `${error instanceof Error ? error.message : "Owner-voice enrollment failed."} Separate audio channels remain active.`
      });
    };

    publishVoiceEnrollment({
      ...baseStatus(),
      phase: "checking",
      message: "Checking the private owner-voice profile…"
    });

    let authToken: string;
    try {
      authToken = await callbackRef.current.getAuthToken();
      const healthResponse = await fetch(`${callbackRef.current.httpBase}/api/speaker/health`, {
        headers: { Authorization: `Bearer ${authToken}` }
      });
      const health = (await healthResponse.json().catch(() => ({}))) as SpeakerHealthResponse & {
        message?: string;
        error?: string;
      };
      if (!healthResponse.ok) {
        throw new Error(health.message || health.error || `Speaker verifier health check failed (${healthResponse.status}).`);
      }
      if (generation !== enrollmentGenerationRef.current || !mountedRef.current) return;
      const healthProgress = normalizeOwnerEnrollmentProgress(health);
      requiredSampleCount = healthProgress.requiredSampleCount;
      existingSampleCount = health.ownerProfile === "enrolling" || health.ownerProfile === "enrolled"
        ? healthProgress.sampleCount
        : 0;
      if (
        health.ownerProfile === "enrolled"
        && healthProgress.enrollmentComplete
        && existingSampleCount >= requiredSampleCount
      ) {
        try {
          localStorage.setItem(OWNER_ENROLLMENT_INSTALLATION_KEY, "enrolled");
        } catch {
          // The server profile is authoritative when browser storage is blocked.
        }
        publishVoiceEnrollment({
          ...baseStatus(),
          phase: "enrolled",
          message: "Owner voice is enrolled; raw enrollment audio is not retained."
        });
        return;
      }
      if (health.enabled === false || health.status === "disabled" || health.status === "unavailable") {
        throw new Error("The optional speaker verifier is unavailable.");
      }
    } catch (error) {
      if (generation === enrollmentGenerationRef.current) fail(error, "unavailable");
      return;
    }

    const attemptKey = `live-ai.owner-voice-attempt.v1:${sessionId}`;
    try {
      if (sessionStorage.getItem(attemptKey) === "attempted") {
        publishVoiceEnrollment({
          ...baseStatus(),
          phase: "failed",
          message: "Owner-voice enrollment already ran in this session and will retry automatically in the next session. Separate audio channels remain active."
        });
        return;
      }
      sessionStorage.setItem(attemptKey, "attempted");
      localStorage.removeItem(OWNER_ENROLLMENT_INSTALLATION_KEY);
    } catch {
      // Enrollment still works when private browsing blocks Web Storage.
    }

    let collectedSegments = 0;
    let uploadedSegments = existingSampleCount;
    let terminal = false;
    let uploadQueue = Promise.resolve();
    const currentStatus = (phase: VoiceEnrollmentStatus["phase"], statusMessage: string): VoiceEnrollmentStatus => ({
      phase,
      message: statusMessage,
      collectedSegments,
      uploadedSegments,
      targetSegments: requiredSampleCount,
      fallback: "separate_channels"
    });
    const stopEnrollment = () => {
      terminal = true;
      enrollmentCaptureRef.current?.stop();
      enrollmentCaptureRef.current = null;
    };
    const failEnrollment = (error: unknown) => {
      if (terminal || generation !== enrollmentGenerationRef.current) return;
      stopEnrollment();
      publishVoiceEnrollment(currentStatus(
        "failed",
        `${error instanceof Error ? error.message : "Owner-voice enrollment failed."} It will retry in a future session; separate audio channels remain active.`
      ));
    };

    try {
      enrollmentCaptureRef.current = await startOwnerVoiceSegmentCapture({
        stream: micStream,
        maxSegments: normalizeOwnerEnrollmentProgress({
          sampleCount: uploadedSegments,
          requiredSampleCount
        }).remainingSamples || 1,
        onError: failEnrollment,
        onSegment: (segment, inputSampleRate) => {
          if (terminal || generation !== enrollmentGenerationRef.current) return;
          collectedSegments += 1;
          let wav: Uint8Array;
          try {
            wav = encodePcm16Wav(segment, inputSampleRate);
          } catch (error) {
            failEnrollment(error);
            return;
          }
          publishVoiceEnrollment(currentStatus(
            "uploading",
            `Uploading clean owner-voice segment ${uploadedSegments + 1} of ${requiredSampleCount}…`
          ));

          uploadQueue = uploadQueue.then(async () => {
            if (terminal || generation !== enrollmentGenerationRef.current) return;
            const wavBody = new ArrayBuffer(wav.byteLength);
            new Uint8Array(wavBody).set(wav);
            const response = await fetch(`${callbackRef.current.httpBase}/api/speaker/enroll`, {
              method: "POST",
              headers: {
                Authorization: `Bearer ${authToken}`,
                "Content-Type": "audio/wav"
              },
              body: wavBody
            });
            const result = (await response.json().catch(() => ({}))) as SpeakerEnrollmentResponse;
            // The Blob and its source array become unreachable after this request;
            // neither browser storage nor the backend proxy persists raw audio.
            if (!response.ok || result.accepted !== true) {
              throw new Error(result.message || result.error || `Owner-voice enrollment failed (${response.status}).`);
            }
            const resultProgress = normalizeOwnerEnrollmentProgress(result, requiredSampleCount);
            if (resultProgress.sampleCount < 1) {
              throw new Error("Speaker verifier returned an invalid enrollment count.");
            }
            uploadedSegments = resultProgress.sampleCount;
            requiredSampleCount = resultProgress.requiredSampleCount;
            if (
              result.enrolled === true
              && resultProgress.enrollmentComplete
            ) {
              try {
                localStorage.setItem(OWNER_ENROLLMENT_INSTALLATION_KEY, "enrolled");
              } catch {
                // The service profile remains authoritative.
              }
              stopEnrollment();
              publishVoiceEnrollment(currentStatus(
                "enrolled",
                "Owner voice enrolled automatically from three clean microphone turns; raw audio was discarded."
              ));
              return;
            }
            publishVoiceEnrollment(currentStatus(
              "collecting",
              `Owner-voice profile ${uploadedSegments} of ${requiredSampleCount}; speak naturally for the remaining samples.`
            ));
          }).catch(failEnrollment);
        }
      });
      publishVoiceEnrollment(currentStatus(
        "collecting",
        existingSampleCount > 0
          ? `Resuming owner-voice enrollment at ${existingSampleCount} of ${requiredSampleCount}; speak naturally for the remaining samples.`
          : `Speak naturally. The app will collect ${requiredSampleCount} clean local-microphone turns automatically.`
      ));
    } catch (error) {
      failEnrollment(error);
    }
  }, [publishVoiceEnrollment]);

  const start = useCallback(async () => {
    if (!options.enabled || mode === "starting" || mode === "separated") return;
    if (!navigator.mediaDevices?.getUserMedia) {
      setMode("error");
      setMessage("This browser cannot open a microphone. Use the laptop audio host or typed input instead.");
      return;
    }

    closeAll();
    setMode("starting");
    setMessage("Choose the Google Meet/Zoom tab, Zoom window, or system screen and enable Share audio.");
    const directionalRequested = callbackRef.current.twoPartyDirectionalMode === true;
    publishDirectionalStatus({
      ...INITIAL_DIRECTIONAL_STATUS,
      phase: directionalRequested ? "checking" : "off",
      requested: directionalRequested,
      message: directionalRequested
        ? "Requesting a true stereo microphone for fixed-side speaker calibration."
        : "Directional speaker inference is off."
    });

    // Start both permission prompts from the click event. This preserves the
    // transient browser activation required by getDisplayMedia.
    const micPromise = navigator.mediaDevices.getUserMedia({
      audio: directionalRequested
        ? {
          channelCount: { ideal: 2 },
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false
        }
        : { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: false
    });
    const displayPromise: Promise<MediaStream> = navigator.mediaDevices.getDisplayMedia
      ? navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false
        },
        // Chrome treats these as picker hints. The user still makes the choice,
        // and a source is accepted only when it actually returns an audio track.
        selfBrowserSurface: "exclude",
        systemAudio: "include",
        surfaceSwitching: "include",
        monitorTypeSurfaces: "include"
      } as DisplayMediaStreamOptions)
      : Promise.reject(new DOMException("Shared application audio is unavailable on this browser.", "NotSupportedError"));
    const [micResult, displayResult] = await Promise.allSettled([micPromise, displayPromise]);

    if (!mountedRef.current) {
      if (micResult.status === "fulfilled") stopStream(micResult.value);
      if (displayResult.status === "fulfilled") stopStream(displayResult.value);
      return;
    }

    const micStream = micResult.status === "fulfilled" ? micResult.value : null;
    const displayStream = displayResult.status === "fulfilled" ? displayResult.value : null;
    if (micStream) streamsRef.current.push(micStream);
    if (displayStream) streamsRef.current.push(displayStream);

    const sharedAudioAvailable = Boolean(displayStream?.getAudioTracks().length);
    try {
      if (!micStream && !sharedAudioAvailable) {
        throw new Error("Microphone and shared audio permissions were not granted.");
      }
      const authToken = await callbackRef.current.getAuthToken();
      const transcriptionStatus = await getTranscriptionRuntimeStatus(
        callbackRef.current.httpBase,
        authToken
      );
      const useLocalTranscription = transcriptionStatus.local.available;
      if (
        !useLocalTranscription &&
        !transcriptionStatus.cloud.configured
      ) {
        throw new Error(
          "Neither local nor cloud transcription is available. Start the local STT service or configure OpenAI."
        );
      }

      if (micStream && sharedAudioAvailable && displayStream) {
        if (useLocalTranscription) {
          await Promise.all([
            createLocalTranscriber(micStream, "rep"),
            createLocalTranscriber(displayStream, "lead")
          ]);
        } else {
          await Promise.all([
            createTranscriber(micStream, "rep", "rep"),
            createTranscriber(displayStream, "lead", "lead")
          ]);
        }
        displayStream.getVideoTracks().forEach((track) => {
          track.addEventListener("ended", () => {
            if (mountedRef.current) {
              stop();
              setMessage("Tab/window sharing ended. Start audio again to restore verified source separation.");
            }
          }, { once: true });
        });
        setMode("separated");
        setMessage(
          `Separated ${useLocalTranscription ? "local" : "cloud"} transcription: microphone is you; shared tab/system audio is the other person.`
        );
        publishDirectionalStatus({
          ...INITIAL_DIRECTIONAL_STATUS,
          message: "Dedicated microphone and remote tracks are authoritative; direction is not needed."
        });
        const enrollmentGeneration = enrollmentGenerationRef.current;
        void beginAutomaticVoiceEnrollment(micStream, callbackRef.current.sessionId, enrollmentGeneration);
        return;
      }

      if (micStream) {
        if (useLocalTranscription) {
          await createLocalTranscriber(micStream, "unknown");
        } else {
          await createTranscriber(micStream, "rep", "unknown");
        }
        setMode("mixed_unverified");
        setMessage(directionalRequested
          ? "Mixed directional mode: verified owner voice calibrates your fixed side; only repeated, strong opposite-side evidence can become Other. Conflicts stay Unknown."
          : "Mixed fallback: the private owner embedding automatically verifies strong owner matches as You; every non-match stays Unknown and cannot trigger mistaken coaching.");
        return;
      }

      throw new Error("The shared call had audio, but microphone access was not granted. Speaker separation requires both sources.");
    } catch (error) {
      closeAll();
      setMode("error");
      setMessage(error instanceof Error ? error.message : "Could not start audio capture.");
    }
  }, [beginAutomaticVoiceEnrollment, closeAll, createLocalTranscriber, createTranscriber, mode, options.enabled, publishDirectionalStatus, stop]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      closeAll();
    };
  }, [closeAll]);

  return {
    mode,
    message,
    voiceEnrollment,
    directionalStatus,
    isActive: mode === "separated" || mode === "mixed_unverified",
    start,
    stop
  };
}
