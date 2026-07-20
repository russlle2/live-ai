import React, { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RuntimeEventV2 } from "@overlay-assistant/runtime";
import type {
  CoachingDeliveryV1,
  ConversationPlaybookStageIdV1,
  ConversationSpeakerV1,
  DeliveryObservationMessageV1,
  DeviceRoleV1,
  OverlayMessageV1,
  OverlayStateV1,
  ScenarioModeV1,
  SessionProfileV1,
  WsServerMessageV1
} from "@overlay-assistant/shared";
import { buildConversationPlaybookV1, DEFAULT_SESSION_PROFILE_V1, SCENARIO_MODES_V1, sanitizePatch_v1 } from "@overlay-assistant/shared";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { MemoryReviewPanel } from "./components/MemoryReviewPanel";
import { OverlayPreview } from "./components/OverlayPreview";
import { useToast } from "./components/Toast";
import {
  beginGoogleAuthorization,
  eraseAllPrivateData,
  getRuntimeAutomationStatus,
  login,
  postRuntimeEvent,
  postUiEvent,
  runGoogleMemorySync,
  type RuntimeAutomationStatus
} from "./lib/api";
import { chooseCushion } from "./lib/cushions";
import {
  useSeparatedRealtimeTranscription,
  type AudioSource,
  type RealtimeInterim,
  type RealtimeSpeakerAttribution
} from "./lib/useSeparatedRealtimeTranscription";
import "./styles.css";

const FaqPage = lazy(() => import("./components/FaqPage").then((module) => ({ default: module.FaqPage })));

type ConnectionStatus = "disconnected" | "connecting" | "ready";
type SuggestionStage = "idle" | "opening" | "cushion" | "tailored" | "template";
type TranscriptEntry = {
  text: string;
  speaker: ConversationSpeakerV1;
  at: string;
  provenance: "separated" | "voice_match" | "directional" | "manual" | "unverified" | "session";
};

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

const PERSONAL_TENANT_ID = "personal";
const PERSONAL_REP_ID = "owner";
const PROFILE_STORAGE_KEY = "live-rhetoric-session-profile-v1";
const ACCESS_CODE_SESSION_KEY = "live-rhetoric-access-code";
const DIRECTIONAL_MODE_STORAGE_KEY = "live-rhetoric-two-party-direction-v1";

const SCENARIO_LABELS: Record<ScenarioModeV1, string> = {
  interview: "Job interview",
  insurance_sales: "Insurance sales",
  it_support: "IT support",
  inbound_service: "Inbound service",
  negotiation: "Negotiation",
  general: "General conversation"
};

const DEFAULT_STATE: OverlayStateV1 = {
  guidance: { items: [] },
  settings: {
    controls: {
      guidanceMode: "assist",
      guidanceMuted: false,
      aiDepth: "P0",
      showLowConfidence: false
    }
  }
};

function newSessionId() {
  const cryptoId = globalThis.crypto?.randomUUID?.().replaceAll("-", "").slice(0, 12);
  return `live_${cryptoId || Math.random().toString(36).slice(2, 14)}`;
}

function loadProfile(): SessionProfileV1 {
  try {
    const stored = JSON.parse(sessionStorage.getItem(PROFILE_STORAGE_KEY) || "null") as Partial<SessionProfileV1> | null;
    if (stored && SCENARIO_MODES_V1.includes(stored.mode as ScenarioModeV1)) {
      return { ...DEFAULT_SESSION_PROFILE_V1, ...stored, mode: stored.mode as ScenarioModeV1 };
    }
  } catch {
    // Ignore malformed local preferences.
  }
  return { ...DEFAULT_SESSION_PROFILE_V1 };
}

function getInitialSession(): { sessionId: string; role: DeviceRoleV1 } {
  const params = new URLSearchParams(window.location.search);
  const requestedSession = params.get("session")?.trim();
  return {
    sessionId: requestedSession || newSessionId(),
    role: params.get("role") === "companion" || requestedSession ? "companion" : "audio_host"
  };
}

function apiLocations() {
  const configured = String(import.meta.env.VITE_API_BASE || "").replace(/\/$/, "");
  if (configured) {
    const parsed = new URL(configured, window.location.origin);
    return {
      httpBase: parsed.origin,
      wsUrl: `${parsed.protocol === "https:" ? "wss:" : "ws:"}//${parsed.host}/ws`
    };
  }

  const { hostname, protocol, port, origin } = window.location;
  const codespace = hostname.match(/^(.+)-(\d+)(\.app\.github\.dev)$/);
  if (codespace) {
    const serverHost = `${codespace[1]}-8080${codespace[3]}`;
    return { httpBase: `https://${serverHost}`, wsUrl: `wss://${serverHost}/ws` };
  }
  if (port === "5173") {
    const httpProtocol = protocol === "https:" ? "https:" : "http:";
    const wsProtocol = protocol === "https:" ? "wss:" : "ws:";
    return {
      httpBase: `${httpProtocol}//${hostname || "localhost"}:8080`,
      wsUrl: `${wsProtocol}//${hostname || "localhost"}:8080/ws`
    };
  }
  return {
    httpBase: origin,
    wsUrl: `${protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}/ws`
  };
}

function normalizeSpeaker(value: unknown): ConversationSpeakerV1 {
  return value === "rep" || value === "lead" ? value : "unknown";
}

export function App() {
  const initial = useMemo(getInitialSession, []);
  const isLikelyMobile = useMemo(
    () => /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent) || window.matchMedia("(max-width: 650px)").matches,
    []
  );
  const [profile, setProfile] = useState<SessionProfileV1>(loadProfile);
  const [deviceRole, setDeviceRole] = useState<DeviceRoleV1>(initial.role);
  const [sessionId, setSessionId] = useState(initial.sessionId);
  const [showOnboarding, setShowOnboarding] = useState(true);
  const [wsStatus, setWsStatus] = useState<ConnectionStatus>("disconnected");
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [overlayState, setOverlayState] = useState<OverlayStateV1>(DEFAULT_STATE);
  const [suggestionStage, setSuggestionStage] = useState<SuggestionStage>("idle");
  const [activeGuidanceId, setActiveGuidanceId] = useState<string | null>(null);
  const [typedText, setTypedText] = useState("");
  const [typedSpeaker, setTypedSpeaker] = useState<ConversationSpeakerV1>("lead");
  const [interims, setInterims] = useState<Partial<Record<AudioSource, string>>>({});
  const [error, setError] = useState<string | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [authToken, setAuthToken] = useState<string | null>(null);
  const [aiMode, setAiMode] = useState<"ai" | "templates" | "unknown">("unknown");
  const [sessionStart, setSessionStart] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState("0:00");
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [memoryReviewOpen, setMemoryReviewOpen] = useState(false);
  const [accessCode, setAccessCode] = useState(() => sessionStorage.getItem(ACCESS_CODE_SESSION_KEY) || "");
  const [localBootstrapCode, setLocalBootstrapCode] = useState<string | null>(null);
  const [automation, setAutomation] = useState<RuntimeAutomationStatus | null>(null);
  const [automationBusy, setAutomationBusy] = useState(false);
  const [purgeBusy, setPurgeBusy] = useState(false);
  const [deliveryObservations, setDeliveryObservations] = useState<DeliveryObservationMessageV1[]>([]);
  const [activePlaybookStageId, setActivePlaybookStageId] = useState<ConversationPlaybookStageIdV1>("greeting");
  const [twoPartyDirectionalMode, setTwoPartyDirectionalMode] = useState(() => {
    try {
      return localStorage.getItem(DIRECTIONAL_MODE_STORAGE_KEY) === "enabled";
    } catch {
      return false;
    }
  });

  const { httpBase, wsUrl } = useMemo(apiLocations, []);
  const conversationPlaybook = useMemo(() => buildConversationPlaybookV1(profile), [profile]);
  const { addToast, ToastContainer } = useToast();
  const wsRef = useRef<WebSocket | null>(null);
  const tokenRef = useRef<string | null>(null);
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shouldReconnectRef = useRef(false);
  const runtimeEventQueueRef = useRef<Promise<void>>(Promise.resolve());
  const transcriptEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    tokenRef.current = authToken;
  }, [authToken]);

  useEffect(() => {
    sessionStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(profile));
  }, [profile]);

  useEffect(() => {
    try {
      localStorage.setItem(DIRECTIONAL_MODE_STORAGE_KEY, twoPartyDirectionalMode ? "enabled" : "disabled");
    } catch {
      // The current in-memory choice still applies when storage is blocked.
    }
  }, [twoPartyDirectionalMode]);

  useEffect(() => {
    if (accessCode) sessionStorage.setItem(ACCESS_CODE_SESSION_KEY, accessCode);
    else sessionStorage.removeItem(ACCESS_CODE_SESSION_KEY);
  }, [accessCode]);

  useEffect(() => {
    if (accessCode) return;
    const controller = new AbortController();
    fetch(`${httpBase}/api/auth/bootstrap`, {
      cache: "no-store",
      signal: controller.signal
    })
      .then(async (response) => response.ok ? response.json() : null)
      .then((payload) => {
        const generated = typeof payload?.accessCode === "string" ? payload.accessCode : "";
        if (generated.length >= 12) {
          setAccessCode(generated);
          setLocalBootstrapCode(generated);
        }
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [accessCode, httpBase]);

  useEffect(() => {
    const handleInstall = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", handleInstall);
    return () => window.removeEventListener("beforeinstallprompt", handleInstall);
  }, []);

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [transcript]);

  useEffect(() => {
    if (!sessionStart) {
      setElapsed("0:00");
      return;
    }
    const tick = () => {
      const total = Math.floor((Date.now() - sessionStart) / 1000);
      setElapsed(`${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`);
    };
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [sessionStart]);

  const ensureAuth = useCallback(async () => {
    if (tokenRef.current) return tokenRef.current;
    const result = await login({
      tenantId: PERSONAL_TENANT_ID,
      repId: PERSONAL_REP_ID,
      role: "admin",
      accessCode: accessCode || undefined
    }, httpBase);
    tokenRef.current = result.token;
    setAuthToken(result.token);
    return result.token;
  }, [accessCode, httpBase]);

  const refreshAutomation = useCallback(async () => {
    const token = await ensureAuth();
    const status = await getRuntimeAutomationStatus(httpBase, token);
    setAutomation(status);
    return status;
  }, [ensureAuth, httpBase]);

  const connectGoogle = useCallback(async () => {
    if (automationBusy) return;
    setAutomationBusy(true);
    try {
      const token = await ensureAuth();
      const url = await beginGoogleAuthorization(httpBase, token);
      window.location.assign(url);
    } catch (connectionError) {
      setError(connectionError instanceof Error ? connectionError.message : "Google authorization could not start.");
      setAutomationBusy(false);
    }
  }, [automationBusy, ensureAuth, httpBase]);

  const syncGoogleNow = useCallback(async () => {
    if (automationBusy) return;
    setAutomationBusy(true);
    try {
      const token = await ensureAuth();
      await runGoogleMemorySync(httpBase, token);
      await refreshAutomation();
      addToast("success", "Gmail and Drive memory are up to date.", 3000);
    } catch (syncError) {
      setError(syncError instanceof Error ? syncError.message : "Google memory sync failed.");
    } finally {
      setAutomationBusy(false);
    }
  }, [addToast, automationBusy, ensureAuth, httpBase, refreshAutomation]);

  useEffect(() => {
    const controller = new AbortController();
    ensureAuth()
      .then((token) => fetch(`${httpBase}/api/ai-status`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
        signal: controller.signal
      }))
      .then((response) => {
        if (!response.ok) throw new Error(`AI status returned ${response.status}`);
        return response.json();
      })
      .then((data) => setAiMode(data.aiCoachEnabled ? "ai" : "templates"))
      .catch(() => {
        if (!controller.signal.aborted) setAiMode("templates");
      });
    return () => controller.abort();
  }, [ensureAuth, httpBase]);

  useEffect(() => {
    if (wsStatus !== "ready") return;
    let cancelled = false;
    const update = () => {
      void refreshAutomation()
        .then((status) => {
          if (!cancelled && status.google.authorized) setAutomation(status);
        })
        .catch(() => undefined);
    };
    update();
    const timer = window.setInterval(update, 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [refreshAutomation, wsStatus]);

  useEffect(() => {
    if (wsStatus !== "ready") return;
    const url = new URL(window.location.href);
    if (url.searchParams.get("google") !== "connected") return;
    url.searchParams.delete("google");
    window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
    addToast("success", "Google connected. Gmail and Drive catch-up is running automatically.", 5000);
    void syncGoogleNow();
  }, [addToast, syncGoogleNow, wsStatus]);

  const appendTranscript = useCallback((entry: TranscriptEntry) => {
    setTranscript((current) => {
      const duplicate = current.slice(-6).some((existing) =>
        existing.text.trim().toLowerCase() === entry.text.trim().toLowerCase() &&
        existing.speaker === entry.speaker &&
        Math.abs(Date.parse(existing.at) - Date.parse(entry.at)) < 8_000
      );
      return duplicate ? current : [...current, entry].slice(-120);
    });
  }, []);

  const applyOverlayMessage = useCallback((
    message: OverlayMessageV1,
    coaching?: Pick<CoachingDeliveryV1, "guidanceId" | "phase" | "aiGenerated" | "playbookStageId">
  ) => {
    if (message.type === "settings") {
      const controls = (message.settings as { controls?: OverlayStateV1["settings"]["controls"] }).controls;
      if (controls) setOverlayState((current) => ({ ...current, settings: { ...current.settings, controls } }));
      return;
    }
    if (message.type !== "patch") return;
    const result = sanitizePatch_v1(message.patch);
    if (!result.ok) {
      setError("A malformed coaching update was safely ignored.");
      return;
    }
    if (typeof result.patch.text === "string") {
      setOverlayState((current) => ({ ...current, text: result.patch.text } as OverlayStateV1));
      if (coaching?.guidanceId) setActiveGuidanceId(coaching.guidanceId);
      setSuggestionStage(
        coaching?.playbookStageId === "greeting" && coaching.phase === "final"
          ? "opening"
          : coaching?.phase === "cushion"
            ? "cushion"
            : coaching?.aiGenerated === false || aiMode === "templates"
              ? "template"
              : "tailored"
      );
      if (conversationPlaybook.stages.some((stage) => stage.id === coaching?.playbookStageId)) {
        setActivePlaybookStageId(coaching!.playbookStageId as ConversationPlaybookStageIdV1);
      }
    }
  }, [aiMode, conversationPlaybook.stages]);

  const connect = useCallback(async () => {
    if (wsRef.current && wsRef.current.readyState <= WebSocket.OPEN) return;
    setError(null);
    setWsStatus("connecting");
    shouldReconnectRef.current = true;
    try {
      const token = await ensureAuth();
      const socket = new WebSocket(wsUrl);
      wsRef.current = socket;
      socket.onopen = () => {
        socket.send(JSON.stringify({
          type: "start",
          session_id: sessionId,
          tenantId: PERSONAL_TENANT_ID,
          repId: PERSONAL_REP_ID,
          token,
          deviceRole,
          ...(deviceRole === "audio_host" ? { profile } : {})
        }));
      };
      socket.onmessage = (event) => {
        try {
          const message = JSON.parse(String(event.data)) as WsServerMessageV1;
          if (message.type === "ready") {
            if (message.profile) setProfile(message.profile);
            setWsStatus("ready");
            setSessionStart((current) => current || Date.now());
            setError(null);
            return;
          }
          if (message.type === "transcript_final") {
            const speaker = normalizeSpeaker((message as { speaker?: unknown; source?: unknown }).speaker ??
              (message as { source?: unknown }).source);
            appendTranscript({
              text: message.text,
              speaker,
              at: message.at || new Date().toISOString(),
              provenance: "session"
            });
            return;
          }
          if (message.type === "delivery_observation") {
            setDeliveryObservations((current) => [...current, message].slice(-24));
            return;
          }
          if (message.type === "interruption_detected") {
            setOverlayState((current) => ({ ...current, text: "" } as OverlayStateV1));
            setActiveGuidanceId(null);
            setSuggestionStage("idle");
            return;
          }
          if (message.type === "overlay_message") {
            applyOverlayMessage(message.message, message.coaching);
            return;
          }
          if (message.type === "error") setError(message.message || "The live session reported an error.");
        } catch {
          // Ignore malformed WebSocket messages.
        }
      };
      socket.onclose = () => {
        wsRef.current = null;
        setWsStatus("disconnected");
        if (shouldReconnectRef.current) {
          reconnectRef.current = setTimeout(() => void connect(), 2_500);
        }
      };
      socket.onerror = () => setError("The live connection was interrupted. Reconnecting…");
    } catch (caught) {
      setWsStatus("disconnected");
      setError(caught instanceof Error ? caught.message : "Could not authenticate this personal session.");
    }
  }, [appendTranscript, applyOverlayMessage, deviceRole, ensureAuth, profile, sessionId, wsUrl]);

  const sendText = useCallback(async (
    rawText: string,
    speaker: ConversationSpeakerV1,
    provenance: TranscriptEntry["provenance"] = "manual",
    attribution?: RealtimeSpeakerAttribution
  ) => {
    const text = rawText.trim();
    if (!text) return;
    appendTranscript({ text, speaker, at: new Date().toISOString(), provenance });

    if (speaker === "lead") {
      setOverlayState((current) => ({ ...current, text: chooseCushion(profile.mode, text) } as OverlayStateV1));
      setActiveGuidanceId(null);
      setSuggestionStage("cushion");
    }

    try {
      const token = await ensureAuth();
      const response = await fetch(`${httpBase}/api/demo/transcript_final`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          session_id: sessionId,
          text,
          speaker,
          ...(speaker === "unknown" ? {} : { source: speaker }),
          captureProvenance: attribution?.provenance ?? (provenance === "manual" ? "manual_label" : "unverified"),
          ...(typeof attribution?.confidence === "number" ? { attributionConfidence: attribution.confidence } : {}),
          ...(attribution?.reason ? { attributionReason: attribution.reason } : {}),
          profile
        })
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({})) as { message?: string; error?: string };
        throw new Error(payload.message || payload.error || `Transcript failed (${response.status}).`);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not send the transcript.");
    }
  }, [appendTranscript, ensureAuth, httpBase, profile, sessionId]);

  const handleRealtimeFinal = useCallback((
    text: string,
    source: AudioSource,
    attribution: RealtimeSpeakerAttribution
  ) => {
    const provenance: TranscriptEntry["provenance"] = attribution.provenance === "directional_inference"
      ? "directional"
      : attribution.provenance === "verified_owner_voice"
        ? "voice_match"
        : attribution.provenance === "dedicated_owner_mic" || attribution.provenance === "dedicated_browser_tab"
          ? "separated"
          : "unverified";
    void sendText(text, source, provenance, attribution);
  }, [sendText]);

  const handleRealtimeInterim = useCallback((event: RealtimeInterim) => {
    setInterims((current) => ({ ...current, [event.source]: event.text }));
  }, []);

  const handleRuntimeEvent = useCallback((event: RuntimeEventV2) => {
    if (
      event.payload.type === "speech.started" &&
      event.payload.speaker === "remote"
    ) {
      setOverlayState((current) => ({ ...current, text: "" } as OverlayStateV1));
      setActiveGuidanceId(null);
      setSuggestionStage("idle");
    }
    runtimeEventQueueRef.current = runtimeEventQueueRef.current
      .catch(() => undefined)
      .then(async () => {
        const token = await ensureAuth();
        await postRuntimeEvent(event, httpBase, token);
      })
      .catch(() => {
        setError("Live speech-state synchronization was interrupted.");
      });
  }, [ensureAuth, httpBase]);

  const realtime = useSeparatedRealtimeTranscription({
    enabled: deviceRole === "audio_host" && wsStatus === "ready",
    httpBase,
    sessionId,
    getAuthToken: ensureAuth,
    twoPartyDirectionalMode,
    onFinal: handleRealtimeFinal,
    onInterim: handleRealtimeInterim,
    onRuntimeEvent: handleRuntimeEvent
  });

  const purgePrivateData = useCallback(async () => {
    if (purgeBusy) return;
    const confirmation = window.prompt(
      "This permanently erases app memory, transcript/style logs, local Gmail/Drive authorization and cache, the owner voice embedding, and database metadata. Type ERASE MY PRIVATE DATA to continue."
    );
    if (confirmation !== "ERASE MY PRIVATE DATA") return;

    setPurgeBusy(true);
    try {
      const token = await ensureAuth();
      realtime.stop();
      shouldReconnectRef.current = false;
      if (reconnectRef.current) clearTimeout(reconnectRef.current);
      wsRef.current?.close();
      const result = await eraseAllPrivateData(httpBase, token);
      setTranscript([]);
      setDeliveryObservations([]);
      setAutomation(null);
      setActiveGuidanceId(null);
      setMemoryReviewOpen(false);
      setAuthToken(null);
      tokenRef.current = null;
      setAccessCode("");
      setProfile({ ...DEFAULT_SESSION_PROFILE_V1 });
      setTwoPartyDirectionalMode(false);
      sessionStorage.removeItem(PROFILE_STORAGE_KEY);
      localStorage.removeItem(DIRECTIONAL_MODE_STORAGE_KEY);
      sessionStorage.removeItem(ACCESS_CODE_SESSION_KEY);
      setWsStatus("disconnected");
      setSessionStart(null);
      setShowOnboarding(true);
      window.alert(result.warnings.length > 0
        ? `Private app data was erased, with follow-up required: ${result.warnings.join(", ")}.`
        : "Private app data was erased. Google must be reconnected and the owner voice re-enrolled before those features can resume.");
    } catch (purgeError) {
      setError(purgeError instanceof Error ? purgeError.message : "Private data could not be erased.");
    } finally {
      setPurgeBusy(false);
    }
  }, [ensureAuth, httpBase, purgeBusy, realtime]);

  useEffect(() => {
    return () => {
      shouldReconnectRef.current = false;
      if (reconnectRef.current) clearTimeout(reconnectRef.current);
      wsRef.current?.close();
    };
  }, []);

  const begin = useCallback(() => {
    if (deviceRole === "companion" && !sessionId.trim()) {
      setError("Enter the session ID shown on your laptop.");
      return;
    }
    setShowOnboarding(false);
    void connect();
  }, [connect, deviceRole, sessionId]);

  const newSession = useCallback(() => {
    realtime.stop();
    shouldReconnectRef.current = false;
    if (reconnectRef.current) clearTimeout(reconnectRef.current);
    wsRef.current?.close();
    setSessionId(newSessionId());
    setTranscript([]);
    setDeliveryObservations([]);
    setOverlayState(DEFAULT_STATE);
    setActiveGuidanceId(null);
    setSuggestionStage("idle");
    setActivePlaybookStageId("greeting");
    setSessionStart(null);
    setWsStatus("disconnected");
    setShowOnboarding(true);
  }, [realtime]);

  const submitTyped = useCallback(() => {
    const value = typedText.trim();
    if (!value) return;
    setTypedText("");
    void sendText(value, typedSpeaker, "manual");
  }, [sendText, typedSpeaker, typedText]);

  const companionLink = useMemo(() => {
    const url = new URL(window.location.href);
    url.search = "";
    url.searchParams.set("session", sessionId);
    url.searchParams.set("role", "companion");
    return url.toString();
  }, [sessionId]);

  const copySession = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(companionLink);
      addToast("success", "Companion link copied", 2500);
    } catch {
      addToast("info", `Session ID: ${sessionId}`, 5000);
    }
  }, [addToast, companionLink, sessionId]);

  const installApp = useCallback(async () => {
    if (!installPrompt) return;
    await installPrompt.prompt();
    await installPrompt.userChoice;
    setInstallPrompt(null);
  }, [installPrompt]);

  const onShown = async (guidanceId: string) => {
    if (!guidanceId) return;
    await postUiEvent({ tenantId: PERSONAL_TENANT_ID, repId: PERSONAL_REP_ID, sessionId, eventType: "suggestion_shown", data: { guidanceId } }, httpBase, tokenRef.current);
  };
  const onApply = async (guidanceId: string) => {
    if (!guidanceId) return;
    await postUiEvent({ tenantId: PERSONAL_TENANT_ID, repId: PERSONAL_REP_ID, sessionId, eventType: "suggestion_applied", data: { guidanceId } }, httpBase, tokenRef.current);
    addToast("success", "Marked as used", 1800);
  };
  const onDismiss = async (guidanceId: string) => {
    if (guidanceId) {
      await postUiEvent({ tenantId: PERSONAL_TENANT_ID, repId: PERSONAL_REP_ID, sessionId, eventType: "suggestion_dismissed", data: { guidanceId } }, httpBase, tokenRef.current);
    }
    setOverlayState((current) => ({
      ...current,
      text: "",
      guidance: { items: [] }
    } as OverlayStateV1));
    setActiveGuidanceId(null);
    setSuggestionStage("idle");
  };
  const onMuteToggle = async () => {
    const nextMuted = !overlayState.settings.controls.guidanceMuted;
    setOverlayState((current) => ({
      ...current,
      settings: {
        ...current.settings,
        controls: {
          ...current.settings.controls,
          guidanceMuted: nextMuted
        }
      }
    }));
    await postUiEvent({
      tenantId: PERSONAL_TENANT_ID,
      repId: PERSONAL_REP_ID,
      sessionId,
      eventType: nextMuted ? "mute_on" : "mute_off"
    }, httpBase, tokenRef.current);
  };

  if (showOnboarding) {
    return (
      <div className="onboarding-shell">
        <main className="onboarding-card">
          <div className="brand-mark" aria-hidden="true">LR</div>
          <p className="eyebrow">Your private performance aide</p>
          <h1>Live Rhetoric</h1>
          <p className="onboarding-lede">
            Real-time words for interviews, service calls, technical support, insurance conversations, and negotiations.
          </p>

          <div className="role-picker" role="radiogroup" aria-label="Choose this device’s role">
            <button
              type="button"
              role="radio"
              aria-checked={deviceRole === "audio_host"}
              className={deviceRole === "audio_host" ? "role-card role-card--active" : "role-card"}
              onClick={() => setDeviceRole("audio_host")}
            >
              <strong>{isLikelyMobile ? "Phone listening host" : "Laptop meeting host"}</strong>
              <span>{isLikelyMobile ? "Use the foreground microphone for an external speakerphone or in-room conversation." : "Capture my mic and Zoom/Google Meet tab or system audio separately."}</span>
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={deviceRole === "companion"}
              className={deviceRole === "companion" ? "role-card role-card--active" : "role-card"}
              onClick={() => setDeviceRole("companion")}
            >
              <strong>Phone companion</strong>
              <span>Join a laptop session and keep the best response in view.</span>
            </button>
          </div>

          {deviceRole === "companion" ? (
            <div className="profile-grid">
              <label className="field field--wide">
                <span>Session ID from laptop</span>
                <input value={sessionId} onChange={(event) => setSessionId(event.target.value.trim())} placeholder="live_…" autoCapitalize="none" />
              </label>
              <label className="field field--wide">
                <span>Private access code (if enabled)</span>
                <input type="password" value={accessCode} onChange={(event) => setAccessCode(event.target.value)} placeholder="Access code" autoComplete="current-password" />
              </label>
            </div>
          ) : (
            <div className="profile-grid">
              <label className="field">
                <span>Conversation type</span>
                <select value={profile.mode} onChange={(event) => setProfile((current) => ({ ...current, mode: event.target.value as ScenarioModeV1 }))}>
                  {SCENARIO_MODES_V1.map((mode) => <option key={mode} value={mode}>{SCENARIO_LABELS[mode]}</option>)}
                </select>
              </label>
              <label className="field">
                <span>Target role</span>
                <input value={profile.targetRole || ""} onChange={(event) => setProfile((current) => ({ ...current, targetRole: event.target.value }))} placeholder="Remote IT support specialist" />
              </label>
              <label className="field">
                <span>Company or audience</span>
                <input value={profile.company || ""} onChange={(event) => setProfile((current) => ({ ...current, company: event.target.value }))} placeholder="Company name (optional)" />
              </label>
              <label className="field">
                <span>Outcome I want</span>
                <input value={profile.goal || ""} onChange={(event) => setProfile((current) => ({ ...current, goal: event.target.value }))} placeholder="Reach the second interview" />
              </label>
              <label className="field field--wide">
                <span>Useful context</span>
                <textarea value={profile.preContext || ""} onChange={(event) => setProfile((current) => ({ ...current, preContext: event.target.value }))} placeholder="Job posting priorities, likely objections, call purpose…" rows={3} />
              </label>
              <label className="field field--wide">
                <span>Private access code (if enabled)</span>
                <input type="password" value={accessCode} onChange={(event) => setAccessCode(event.target.value)} placeholder="Access code" autoComplete="current-password" />
              </label>
            </div>
          )}

          {deviceRole === "audio_host" && (
            <label className="directional-opt-in">
              <input
                type="checkbox"
                checked={twoPartyDirectionalMode}
                onChange={(event) => setTwoPartyDirectionalMode(event.target.checked)}
              />
              <span>
                <strong>Two fixed speakers + stereo direction</strong>
                <small>Use only when exactly two people stay on opposite sides of a stationary stereo phone or microphone. It needs three verified samples of your side and two stable opposite-side turns; mono, overlap, movement, or conflicts stay Unknown.</small>
              </span>
            </label>
          )}

          {deviceRole === "audio_host" && localBootstrapCode && (
            <div className="pairing-code">
              <span><strong>Private phone pairing code</strong><small>Generated once and stored only in private local state.</small></span>
              <code>{localBootstrapCode}</code>
              <button type="button" onClick={() => void navigator.clipboard.writeText(localBootstrapCode)}>Copy</button>
            </div>
          )}

          <div className="truth-note">
            <strong>Speaker identity:</strong> Zoom/Meet tab audio and your microphone are separate on a supported laptop browser. Phone or room audio is mixed; owner voice is checked first, calibrated direction is secondary, and uncertain or conflicting speech is never silently treated as the other person.
          </div>

          {error && <div className="inline-error" role="alert">{error}</div>}
          <button className="primary-action" type="button" onClick={begin}>
            {deviceRole === "companion" ? "Join companion view" : "Open live session"}
          </button>
        </main>
      </div>
    );
  }

  const captureTone = realtime.mode === "separated" ? "verified" : realtime.mode === "mixed_unverified" || realtime.mode === "error" ? "warning" : "neutral";
  const voiceAutomationLabel = realtime.voiceEnrollment.phase === "enrolled" || automation?.voice.enrollmentComplete
    ? "Owner enrolled"
    : realtime.voiceEnrollment.phase === "collecting" || realtime.voiceEnrollment.phase === "uploading"
      ? `Learning ${realtime.voiceEnrollment.uploadedSegments}/${realtime.voiceEnrollment.targetSegments}`
      : automation?.voice.ownerProfile === "enrolling"
        ? `Learning ${automation.voice.sampleCount}/${automation.voice.requiredSampleCount}`
        : "Channel-safe fallback";

  return (
    <div className={`app-shell app-shell--${deviceRole}`}>
      <ToastContainer />
      <a className="skip-link" href="#guidance">Skip to guidance</a>

      <header className="app-header">
        <div className="brand-lockup">
          <div className="brand-mark brand-mark--small" aria-hidden="true">LR</div>
          <div>
            <strong>Live Rhetoric</strong>
            <span>{SCENARIO_LABELS[profile.mode]}{profile.targetRole ? ` · ${profile.targetRole}` : ""}</span>
          </div>
        </div>
        <div className="header-actions">
          <span className={`connection connection--${wsStatus}`}><i />{wsStatus === "ready" ? "Live" : wsStatus === "connecting" ? "Connecting" : "Offline"}</span>
          <span className="elapsed" aria-label={`Session duration ${elapsed}`}>{elapsed}</span>
          {installPrompt && <button className="quiet-button" onClick={installApp}>Install</button>}
          <button className="quiet-button" onClick={() => setHelpOpen(true)}>Help</button>
          <button className="quiet-button" onClick={newSession}>New</button>
        </div>
      </header>

      {error && (
        <div className="error-strip" role="alert">
          <span>{error}</span>
          <button onClick={() => setError(null)} aria-label="Dismiss error">×</button>
        </div>
      )}

      <div className="session-strip">
        <button className="session-code" onClick={copySession} title="Copy companion link">
          <span>Session</span><code>{sessionId}</code><b>Copy link</b>
        </button>
        <button className="details-button" onClick={() => setDetailsOpen((current) => !current)} aria-expanded={detailsOpen}>
          {detailsOpen ? "Hide setup" : "Brief & automation"}
        </button>
      </div>

      {detailsOpen && <section className="automation-strip" aria-label="Automatic private runtime data">
        <div className={`automation-item ${automation?.apiKey.configured ? "automation-item--ready" : "automation-item--warning"}`}>
          <span>API key</span>
          <strong>{automation ? automation.apiKey.configured ? "Loaded at startup" : "Not configured" : "Checking…"}</strong>
          <small>Server only</small>
        </div>
        <div className="automation-item automation-item--ready">
          <span>Memory</span>
          <strong>{automation ? `${automation.memory.total} facts stored` : "Checking…"}</strong>
          <small>{automation ? `${automation.memory.userVerified} owner-verified` : "Loaded automatically"}</small>
          <button type="button" onClick={() => setMemoryReviewOpen(true)}>Review facts</button>
        </div>
        <div className={`automation-item ${automation?.coachingKnowledge.loaded ? "automation-item--ready" : "automation-item--warning"}`}>
          <span>Coaching library</span>
          <strong>{automation ? `${automation.coachingKnowledge.total} reviewed contrasts` : "Checking…"}</strong>
          <small>Good vs. weak · separate from memory</small>
        </div>
        <div className="automation-item automation-item--ready">
          <span>Transcripts</span>
          <strong>Capture + delivery learning on</strong>
          <small>{deliveryObservations.length > 0 ? `${deliveryObservations.length} speaking comparisons this session` : "Learns memory every 6 turns"}</small>
        </div>
        <div className={`automation-item ${automation?.google.authorized ? "automation-item--ready" : "automation-item--warning"}`}>
          <span>Gmail + Drive</span>
          <strong>
            {!automation
              ? "Checking…"
              : automation.google.authorized
              ? automation.google.sourceCapacity.full
                ? "Source limit reached"
                : automation.google.extractionBudget.used >= automation.google.extractionBudget.dailyLimit
                  ? "Daily learning budget reached"
                  : automation.google.pendingExtraction > 0
                    ? `Learning ${automation.google.pendingExtraction} sources`
                    : "Background sync on"
              : automation.google.configured
                ? "One-time consent needed"
                : "One-time OAuth client needed"}
          </strong>
          {automation?.google.authorized ? (
            <button type="button" onClick={() => void syncGoogleNow()} disabled={automationBusy}>
              {automationBusy ? "Refreshing…" : "Refresh early"}
            </button>
          ) : automation?.google.configured ? (
            <button type="button" onClick={() => void connectGoogle()} disabled={automationBusy}>
              {automationBusy ? "Opening…" : "Connect once"}
            </button>
          ) : (
            <small>Then refresh is silent</small>
          )}
        </div>
        <div className={`automation-item ${voiceAutomationLabel === "Owner enrolled" ? "automation-item--ready" : ""}`}>
          <span>Voice identity</span>
          <strong>{voiceAutomationLabel}</strong>
          <small>Raw clips discarded</small>
        </div>
        <div className="automation-item automation-item--danger">
          <span>Privacy controls</span>
          <strong>Owner-controlled deletion</strong>
          <button type="button" onClick={() => void purgePrivateData()} disabled={purgeBusy}>
            {purgeBusy ? "Erasing…" : "Erase all private data…"}
          </button>
        </div>
      </section>}

      {detailsOpen && (
        <section className="session-brief" aria-label="Session brief">
          <div><span>Mode</span><strong>{SCENARIO_LABELS[profile.mode]}</strong></div>
          <div><span>Company</span><strong>{profile.company || "Not set"}</strong></div>
          <div><span>Goal</span><strong>{profile.goal || "Clear, credible next step"}</strong></div>
          {deviceRole === "audio_host" && (
            <div>
              <span>Voice profile</span>
              <strong>{realtime.voiceEnrollment.phase === "enrolled" ? "Enrolled automatically" : realtime.voiceEnrollment.phase === "collecting" || realtime.voiceEnrollment.phase === "uploading" ? "Learning automatically" : "Separate-channel fallback"}</strong>
            </div>
          )}
          {profile.preContext && <p>{profile.preContext}</p>}
        </section>
      )}

      <main className="workspace">
        <section className="guide-panel" id="guidance" aria-label="Live response guidance">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Say this next</p>
              <h1>Response guide</h1>
            </div>
            <span className={`engine-badge engine-badge--${suggestionStage}`}>
              {suggestionStage === "opening" ? "Opening line" : suggestionStage === "cushion" ? "Instant bridge" : suggestionStage === "tailored" ? "Tailored" : suggestionStage === "template" ? "Local fallback" : aiMode === "ai" ? "AI ready" : "Ready"}
            </span>
          </div>
          <OverlayPreview
            state={overlayState}
            stage={suggestionStage}
            guidanceId={activeGuidanceId ?? undefined}
            onShown={onShown}
            onApply={onApply}
            onDismiss={onDismiss}
            onMuteToggle={onMuteToggle}
          />
          <details className="conversation-path">
            <summary>
              <span>Exact path: greeting to goodbye</span>
              <small>{conversationPlaybook.stages.length} built-in lines</small>
            </summary>
            <ol>
              {conversationPlaybook.stages.map((stage) => (
                <li key={stage.id} className={stage.id === activePlaybookStageId ? "conversation-path__active" : ""}>
                  <div><b>{stage.order}</b><strong>{stage.title}</strong>{stage.id === activePlaybookStageId && <em>Now</em>}</div>
                  <p>{stage.say}</p>
                </li>
              ))}
            </ol>
          </details>
        </section>

        <section className="conversation-panel" aria-label="Conversation transcript">
          <div className="section-heading">
            <div>
              <p className="eyebrow">What was said</p>
              <h2>Conversation</h2>
            </div>
            <span className={`source-badge source-badge--${captureTone}`}>{deviceRole === "companion" ? "Companion" : realtime.mode === "separated" ? "Sources separated" : realtime.mode === "mixed_unverified" ? "Mixed · unverified" : "Audio off"}</span>
          </div>

          {deviceRole === "audio_host" && (
            <div className={`capture-card capture-card--${captureTone}`}>
              <div>
                <strong>{realtime.mode === "separated" ? "Two-source listening is active" : realtime.mode === "starting" ? "Starting audio…" : isLikelyMobile ? "Start phone listening" : "Start Zoom, Meet, or call audio"}</strong>
                <p>{realtime.message}</p>
                {realtime.isActive && (
                  <>
                    <p className={`capture-substatus capture-substatus--${realtime.voiceEnrollment.phase}`}>
                      Voice profile: {realtime.voiceEnrollment.message}
                    </p>
                    {realtime.mode === "mixed_unverified" && (
                      <p className={`capture-substatus capture-substatus--${realtime.directionalStatus.phase}`}>
                        Direction: {realtime.directionalStatus.message}
                      </p>
                    )}
                  </>
                )}
              </div>
              <button
                className={realtime.isActive ? "capture-button capture-button--stop" : "capture-button"}
                onClick={realtime.isActive ? realtime.stop : () => void realtime.start()}
                disabled={wsStatus !== "ready" || realtime.mode === "starting" || realtime.mode === "stopping"}
              >
                {realtime.isActive ? "Stop audio" : realtime.mode === "starting" ? "Starting…" : isLikelyMobile ? "Open microphone" : "Choose call audio"}
              </button>
            </div>
          )}

          {(interims.rep || interims.lead || interims.unknown) && (
            <div className="interim-row" aria-live="polite">
              <i />
              <span>{interims.lead || interims.rep || interims.unknown}</span>
            </div>
          )}

          {deliveryObservations.length > 0 && (() => {
            const observation = deliveryObservations[deliveryObservations.length - 1];
            const label = observation.comparison.classification === "exact"
              ? "Matched the suggested line"
              : observation.comparison.classification === "paraphrased"
                ? "Natural paraphrase noted"
                : "Different wording noted";
            return (
              <aside className={`delivery-note delivery-note--${observation.comparison.classification}`} aria-live="polite">
                <div>
                  <span>Speaking-style learner</span>
                  <strong>{label}</strong>
                </div>
                <p>{observation.comparison.note}</p>
                <details>
                  <summary>Compare wording</summary>
                  <dl>
                    <div><dt>Suggested</dt><dd>{observation.suggestion}</dd></div>
                    <div><dt>You said</dt><dd>{observation.actual}</dd></div>
                  </dl>
                </details>
              </aside>
            );
          })()}

          <div className="transcript-list" role="log" aria-live="polite">
            {transcript.length === 0 ? (
              <div className="empty-state">
                <strong>Ready for the first turn.</strong>
                <span>Use separated audio on the laptop, or type a line below. Coaching triggers from speech labelled Other.</span>
              </div>
            ) : transcript.map((entry, index) => (
              <article key={`${entry.at}-${index}`} className={`turn turn--${entry.speaker}`}>
                <header>
                  <strong>{entry.speaker === "rep" ? "Me" : entry.speaker === "lead" ? "Other" : "Unknown speaker"}</strong>
                  <span>{entry.provenance === "separated"
                    ? "separate source"
                    : entry.provenance === "voice_match"
                      ? "owner voice match"
                      : entry.provenance === "directional"
                        ? "calibrated direction"
                        : entry.provenance === "manual"
                          ? "manual label"
                          : entry.provenance === "unverified"
                            ? "unverified"
                            : "session"}</span>
                </header>
                <p>{entry.text}</p>
                {entry.speaker === "unknown" && (
                  <button
                    type="button"
                    className="coach-unknown"
                    onClick={() => void sendText(entry.text, "lead", "manual")}
                  >
                    That was them — coach this
                  </button>
                )}
              </article>
            ))}
            <div ref={transcriptEndRef} />
          </div>

          <div className="manual-entry">
            <div className="speaker-picker" role="radiogroup" aria-label="Label typed transcript">
              {(["lead", "rep", "unknown"] as ConversationSpeakerV1[]).map((speaker) => (
                <button key={speaker} role="radio" aria-checked={typedSpeaker === speaker} className={typedSpeaker === speaker ? "active" : ""} onClick={() => setTypedSpeaker(speaker)}>
                  {speaker === "lead" ? "Other" : speaker === "rep" ? "Me" : "Unsure"}
                </button>
              ))}
            </div>
            <div className="manual-row">
              <textarea
                value={typedText}
                onChange={(event) => setTypedText(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    submitTyped();
                  }
                }}
                placeholder="Type the last line you heard…"
                rows={2}
                disabled={wsStatus !== "ready"}
              />
              <button onClick={submitTyped} disabled={wsStatus !== "ready" || !typedText.trim()}>Send</button>
            </div>
            <p>Manual labels are explicit choices, not voice identification. Unknown speech does not trigger automatic coaching.</p>
          </div>
        </section>
      </main>

      {helpOpen && (
        <ErrorBoundary>
          <Suspense fallback={null}>
            <FaqPage onClose={() => setHelpOpen(false)} />
          </Suspense>
        </ErrorBoundary>
      )}
      {memoryReviewOpen && (
        <ErrorBoundary>
          <MemoryReviewPanel
            httpBase={httpBase}
            getAuthToken={ensureAuth}
            onClose={() => setMemoryReviewOpen(false)}
            onFactsChanged={refreshAutomation}
          />
        </ErrorBoundary>
      )}
    </div>
  );
}
