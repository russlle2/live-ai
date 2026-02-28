import React, { Suspense, lazy, useMemo, useState, useCallback, useRef, useEffect } from "react";
import type { OverlayMessageV1, OverlayStateV1, WsServerMessageV1 } from "@overlay-assistant/shared";
import { sanitizePatch_v1 } from "@overlay-assistant/shared";
import { OverlayPreview } from "./components/OverlayPreview";
import { SoundWaveOrb } from "./components/SoundWaveOrb";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { useToast } from "./components/Toast";
import type { ProductProfile } from "./components/ProfileManager";
import { login, postUiEvent, postCrmNote } from "./lib/api";
import { useSpeechRecognition } from "./lib/useSpeechRecognition";
import "./styles.css";

const TrustDashboard = lazy(() => import("./components/TrustDashboard").then((m) => ({ default: m.TrustDashboard })));
const ProfileManager = lazy(() => import("./components/ProfileManager").then((m) => ({ default: m.ProfileManager })));
const FaqPage = lazy(() => import("./components/FaqPage").then((m) => ({ default: m.FaqPage })));

type Speaker = "rep" | "lead" | "unknown";
type ConnectionStatus = "disconnected" | "connecting" | "ready";
type Tab = "session" | "insights";
type OrbMode = "idle" | "listening" | "speaking";
type TranscriptEntry = { text: string; speaker: Speaker; at: string };

function newId(prefix: string) {
  return `${prefix}_${Math.random().toString(16).slice(2)}_${Date.now()}`;
}

const DEFAULT_STATE: OverlayStateV1 = {
  guidance: { items: [] },
  settings: {
    controls: {
      guidanceMode: "assist",
      guidanceMuted: false,
      aiDepth: "P0",
      showLowConfidence: false,
    },
  },
};

export function App() {
  const [tab, setTab] = useState<Tab>("session");
  const [tenantId, setTenantId] = useState("tenant_demo");
  const [repId, setRepId] = useState("rep_demo");
  const [sessionId, setSessionId] = useState(() => newId("sess"));
  const [wsStatus, setWsStatus] = useState<ConnectionStatus>("disconnected");
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [overlayState, setOverlayState] = useState<OverlayStateV1>(DEFAULT_STATE);
  const [inputText, setInputText] = useState("");
  const [speaker, setSpeaker] = useState<Speaker>("lead");
  const [error, setError] = useState<string | null>(null);
  const [showOnboarding, setShowOnboarding] = useState(true);
  const [profileOpen, setProfileOpen] = useState(false);
  const [activeProfile, setActiveProfile] = useState<ProductProfile | null>(null);
  const [orbMode, setOrbMode] = useState<OrbMode>("idle");
  const [crmStatus, setCrmStatus] = useState<string | null>(null);
  const [aiMode, setAiMode] = useState<"ai" | "templates" | "unknown">("unknown");
  const [micInterim, setMicInterim] = useState("");
  const [faqOpen, setFaqOpen] = useState(false);
  const [authToken, setAuthToken] = useState<string | null>(null);
  const [sessionStart, setSessionStart] = useState<number | null>(null);
  const [sessionElapsed, setSessionElapsed] = useState("");
  const { addToast, ToastContainer } = useToast();
  const wsRef = useRef<WebSocket | null>(null);
  const authTokenRef = useRef<string | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const orbTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasConnected = useRef(false);
  const transcriptEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    authTokenRef.current = authToken;
  }, [authToken]);

  /* ── Auto-scroll transcript ─────────────────────────────────── */
  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [transcript]);

  /* ── Session duration timer ─────────────────────────────────── */
  useEffect(() => {
    if (!sessionStart) { setSessionElapsed(""); return; }
    const tick = () => {
      const s = Math.floor((Date.now() - sessionStart) / 1000);
      const m = Math.floor(s / 60);
      const h = Math.floor(m / 60);
      setSessionElapsed(
        h > 0 ? `${h}:${String(m % 60).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`
               : `${m}:${String(s % 60).padStart(2, "0")}`
      );
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [sessionStart]);

  /* ── Detect API host (works on localhost, Codespaces, & any proxy) ── */
  const { wsUrl, httpBase } = useMemo(() => {
    const loc = window.location;
    const csMatch = loc.hostname.match(/^(.+)-(\d+)(\.app\.github\.dev)$/);
    if (csMatch) {
      const base = csMatch[1];
      const suffix = csMatch[3];
      const serverHost = `${base}-8080${suffix}`;
      return { wsUrl: `wss://${serverHost}/ws`, httpBase: `https://${serverHost}` };
    }
    const gpMatch = loc.hostname.match(/^(\d+)-(.+)(\.gitpod\.io)$/);
    if (gpMatch) {
      const rest = gpMatch[2];
      const suffix = gpMatch[3];
      const serverHost = `8080-${rest}${suffix}`;
      return { wsUrl: `wss://${serverHost}/ws`, httpBase: `https://${serverHost}` };
    }
    const host = loc.hostname || "localhost";
    const proto = loc.protocol === "https:" ? "https" : "http";
    const wsproto = loc.protocol === "https:" ? "wss" : "ws";
    return { wsUrl: `${wsproto}://${host}:8080/ws`, httpBase: `${proto}://${host}:8080` };
  }, []);

  const ensureAuth = useCallback(async () => {
    if (authTokenRef.current) return authTokenRef.current;
    const result = await login({ tenantId, repId, role: "admin" }, httpBase);
    authTokenRef.current = result.token;
    setAuthToken(result.token);
    return result.token;
  }, [tenantId, repId, httpBase]);

  /* ── Orb animation trigger ──────────────────────────────────── */
  const flashOrb = useCallback((mode: OrbMode, durationMs = 3000) => {
    setOrbMode(mode);
    if (orbTimer.current) clearTimeout(orbTimer.current);
    orbTimer.current = setTimeout(() => {
      setOrbMode(wsStatus === "ready" ? "listening" : "idle");
    }, durationMs);
  }, [wsStatus]);

  /* ── Check AI status on mount ───────────────────────────────── */
  useEffect(() => {
    const checkAi = async () => {
      try {
        const res = await fetch(`${httpBase}/api/ai-status`);
        const json = await res.json();
        setAiMode(json.aiCoachEnabled ? "ai" : "templates");
      } catch { setAiMode("templates"); }
    };
    checkAi();
  }, [httpBase]);

  /* ── Patch application ──────────────────────────────────────── */
  const applyPatch = useCallback((patch: any) => {
    setOverlayState((s: any) => {
      const next: any = { ...s };
      if (patch && typeof patch.text === "string") next.text = patch.text;
      if (patch && patch.settings && typeof patch.settings === "object")
        next.settings = { ...next.settings, ...patch.settings };
      return next;
    });
  }, []);

  /* ── Handle overlay messages ────────────────────────────────── */
  const handleOverlayMessage = useCallback(
    async (m: OverlayMessageV1) => {
      if (m.type === "settings") {
        setOverlayState((s: any) => ({ ...s, settings: (m as any).settings }));
        return;
      }
      if (m.type === "patch") {
        flashOrb("speaking", 4000);
        const res = sanitizePatch_v1((m as any).patch);
        if (!res.ok) {
          postUiEvent({ tenantId, repId, sessionId, eventType: "patch_rejected", data: { reason: (res as any).reason, bytes: (res as any).bytes } }, httpBase, authTokenRef.current);
          const raw = (m as any).patch;
          if (raw && typeof raw === "object" && typeof raw.text === "string") applyPatch({ text: raw.text });
          return;
        }
        postUiEvent({ tenantId, repId, sessionId, eventType: "patch_received", data: { bytes: (res as any).bytes } }, httpBase, authTokenRef.current);
        applyPatch((res as any).patch);
      }
    },
    [tenantId, repId, sessionId, applyPatch, httpBase, flashOrb]
  );

  /* ── WebSocket connect with auto-reconnect ──────────────────── */
  const connect = useCallback(() => {
    if (wsRef.current && wsRef.current.readyState <= 1) return;
    setError(null);
    setWsStatus("connecting");

    ensureAuth().then((token) => {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        ws.send(JSON.stringify({ type: "start", session_id: sessionId, tenantId, repId, token }));
      };

      ws.onmessage = async (ev) => {
        try {
          const msg = JSON.parse(ev.data) as WsServerMessageV1;
          if (msg.type === "ready") { hasConnected.current = true; setWsStatus("ready"); setOrbMode("listening"); setError(null); setSessionStart(Date.now()); return; }
          if (msg.type === "transcript_final") {
            setTranscript((t) => [...t, { text: msg.text, speaker: "unknown", at: new Date().toISOString() }]);
            flashOrb("listening", 2000);
            return;
          }
          if (msg.type === "overlay_message") { handleOverlayMessage(msg.message as any); return; }
          if (msg.type === "error") { setError(msg.message || "Something went wrong"); return; }
        } catch { /* ignore malformed */ }
      };

      ws.onclose = () => {
        setWsStatus("disconnected");
        setOrbMode("idle");
        wsRef.current = null;
        if (hasConnected.current) {
          reconnectTimer.current = setTimeout(() => { if (sessionId) connect(); }, 3000);
        }
      };

      ws.onerror = () => {
        const msg = hasConnected.current ? "Connection lost. Reconnecting\u2026" : "Could not reach the server. Check that it\u2019s running and try again.";
        setError(msg);
        addToast("error", msg, 6000);
      };
    }).catch(() => {
      setError("Authentication failed. Check tenant/rep identity and server configuration.");
      addToast("error", "Authentication failed", 6000);
      setWsStatus("disconnected");
    });
  }, [wsUrl, sessionId, tenantId, repId, handleOverlayMessage, flashOrb, ensureAuth, addToast]);

  /* ── Cleanup on unmount ─────────────────────────────────────── */
  useEffect(() => {
    return () => {
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      if (orbTimer.current) clearTimeout(orbTimer.current);
      wsRef.current?.close();
    };
  }, []);

  /* ── Send transcript ────────────────────────────────────────── */
  /* ── Core send function (used by both typing and mic) ───────── */
  const sendText = useCallback(async (text: string, spk: Speaker) => {
    if (!text.trim()) return;
    setTranscript((t) => [...t, { text: text.trim(), speaker: spk, at: new Date().toISOString() }]);
    flashOrb("listening", 2000);

    const pc = activeProfile ? {
      productName: activeProfile.productName || undefined,
      differentiators: activeProfile.keyDifferentiators || undefined,
      competitors: activeProfile.competitors || undefined,
      targetIndustry: activeProfile.targetIndustry || undefined,
      commonObjections: activeProfile.commonObjections || undefined,
    } : undefined;

    try {
      const token = await ensureAuth();
      const res = await fetch(`${httpBase}/api/demo/transcript_final`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ session_id: sessionId, text: text.trim(), speaker: spk, productContext: pc }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error((json as any)?.message || (json as any)?.error || "send_failed");
      }
    } catch {
      setError("Failed to send \u2014 check your connection");
    }
  }, [sessionId, httpBase, flashOrb, activeProfile, ensureAuth]);

  const sendTranscript = useCallback(async () => {
    const text = inputText.trim();
    if (!text) return;
    setInputText("");
    await sendText(text, speaker);
  }, [inputText, speaker, sendText]);

  /* ── Speech Recognition (browser mic) ───────────────────────── */
  const speechCallbacks = useMemo(() => ({
    onFinal: (text: string) => {
      if (wsStatus === "ready" && text.trim()) {
        setMicInterim("");
        sendText(text, speaker);
      }
    },
    onInterim: (text: string) => {
      setMicInterim(text);
    },
    continuous: true,
    lang: "en-US"
  }), [wsStatus, speaker, sendText]);

  const { isListening: micOn, isSupported: micSupported, toggle: toggleMic, interimText } = useSpeechRecognition(speechCallbacks);

  useEffect(() => {
    if (tab === "insights") {
      ensureAuth().catch(() => undefined);
    }
  }, [tab, ensureAuth]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendTranscript(); }
    },
    [sendTranscript]
  );

  /* ── Global keyboard shortcuts ──────────────────────────────── */
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Ctrl/Cmd + M → toggle mic
      if ((e.ctrlKey || e.metaKey) && e.key === "m") {
        e.preventDefault();
        if (micSupported && wsStatus === "ready") toggleMic();
      }
      // Ctrl/Cmd + K → focus input
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        const input = document.querySelector<HTMLTextAreaElement>(".input-field");
        input?.focus();
      }
      // Escape → close modals
      if (e.key === "Escape") {
        if (faqOpen) setFaqOpen(false);
        if (profileOpen) setProfileOpen(false);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [micSupported, wsStatus, toggleMic, faqOpen, profileOpen]);

  /* ── Telemetry callbacks ────────────────────────────────────── */
  const onShown = async (itemId: string) => { postUiEvent({ tenantId, repId, sessionId, eventType: "suggestion_shown", data: { itemId } }, httpBase, authTokenRef.current); };
  const onApply = async (itemId: string) => { postUiEvent({ tenantId, repId, sessionId, eventType: "suggestion_applied", data: { itemId } }, httpBase, authTokenRef.current); };
  const onDismiss = async (itemId: string) => {
    postUiEvent({ tenantId, repId, sessionId, eventType: "suggestion_dismissed", data: { itemId } }, httpBase, authTokenRef.current);
    setOverlayState((s) => ({ ...s, guidance: { ...s.guidance, items: s.guidance.items.filter((x) => x.id !== itemId) } }));
    setOverlayState((s: any) => ({ ...s, text: "" }));
  };
  const onMuteToggle = async () => {
    const muted = !overlayState.settings.controls.guidanceMuted;
    setOverlayState((s) => ({ ...s, settings: { ...s.settings, controls: { ...s.settings.controls, guidanceMuted: muted } } }));
    postUiEvent({ tenantId, repId, sessionId, eventType: muted ? "mute_on" : "mute_off", data: {} }, httpBase, authTokenRef.current);
  };

  const startNewSession = () => {
    if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
    wsRef.current?.close();
    hasConnected.current = false;
    setSessionId(newId("sess"));
    setTranscript([]);
    setOverlayState(DEFAULT_STATE);
    setWsStatus("disconnected");
    setOrbMode("idle");
    setError(null);
    setSessionStart(null);
    addToast("info", "New session started", 3000);
  };

  const statusClass = wsStatus === "ready" ? "connected" : wsStatus === "connecting" ? "connecting" : "disconnected";
  const statusLabel = wsStatus === "ready" ? "Live" : wsStatus === "connecting" ? "Connecting" : "Offline";

  /* ═══════════════════════════════════════════════════════════════
     RENDER
     ═══════════════════════════════════════════════════════════════ */

  // ── Onboarding (first launch) ──
  if (showOnboarding) {
    return (
      <div className="app-shell">
        <div className="onboarding">
          <SoundWaveOrb mode="idle" size={160} />
          <div className="onboarding-badge">Sales Intelligence Platform</div>
          <h1 className="onboarding-title">Sales Coach Pro</h1>
          <p className="onboarding-subtitle">
            Real-time, word-for-word coaching that adapts to any product you sell.
            Set up your profile, start a session, and close more deals.
          </p>
          <div className="onboarding-form">
            <div className="onboarding-field">
              <label className="onboarding-label">Team / Company</label>
              <input className="onboarding-input" value={tenantId} onChange={(e) => setTenantId(e.target.value)} placeholder="Your company name" />
            </div>
            <div className="onboarding-field">
              <label className="onboarding-label">Your Name</label>
              <input className="onboarding-input" value={repId} onChange={(e) => setRepId(e.target.value)} placeholder="Sales rep name" />
            </div>
            <button className="onboarding-start-btn" onClick={() => { setShowOnboarding(false); connect(); }}>
              Launch Session
            </button>
          </div>
          <button className="btn-luxury btn-luxury--ghost" onClick={() => setProfileOpen(true)} style={{ marginTop: 8 }}>
            Set up a Product Profile first
          </button>
        </div>
        <Suspense fallback={null}>
          <ProfileManager isOpen={profileOpen} onClose={() => setProfileOpen(false)} onActiveProfileChange={setActiveProfile} />
        </Suspense>
      </div>
    );
  }

  // ── Main Application Shell ──
  return (
    <div className="app-shell">
      {/* Skip to content — accessibility */}
      <a href="#panel-session" className="skip-link">Skip to main content</a>

      <ToastContainer />

      {/* ── Top Bar ────────────────────────────────────────── */}
      <header className="top-bar" role="banner">
        <div className="top-bar-brand">
          <div className="top-bar-logo">SC</div>
          <div>
            <div className="top-bar-title">Sales Coach Pro</div>
            <div className="top-bar-version">v3.0</div>
          </div>
        </div>

        <div className="top-bar-right">
          {sessionElapsed && wsStatus === "ready" && (
            <div className="session-timer" aria-label={`Session duration: ${sessionElapsed}`} title="Session duration">
              <span className="session-timer-icon" aria-hidden="true">⏱</span>
              {sessionElapsed}
            </div>
          )}

          {activeProfile && (
            <div className="active-profile-chip">
              <span>●</span> {activeProfile.name}
            </div>
          )}

          <button className="profile-btn" onClick={() => setProfileOpen(true)}>
            <span className="profile-btn-dot" />
            Profiles
          </button>

          <div className={`status-pill status-pill--${statusClass}`} role="status" aria-live="polite">
            <span className="status-dot" aria-hidden="true" />
            {statusLabel}
          </div>

          <button className="btn-luxury btn-luxury--secondary btn-luxury--sm" onClick={() => setFaqOpen(true)}>
            Help
          </button>

          <button className="btn-luxury btn-luxury--secondary btn-luxury--sm" onClick={startNewSession}>
            New Session
          </button>

          {wsStatus !== "ready" && (
            <button className="btn-luxury btn-luxury--primary btn-luxury--sm" onClick={connect}>
              {wsStatus === "connecting" ? "Connecting\u2026" : "Connect"}
            </button>
          )}
        </div>
      </header>

      {/* ── Error Bar ──────────────────────────────────────── */}
      {error && (
        <div className="error-bar" role="alert">
          <span>⚠</span>
          <span>{error}</span>
          <button className="error-bar-dismiss" onClick={() => setError(null)} aria-label="Dismiss">✕</button>
        </div>
      )}

      {/* ── Nav Tabs ───────────────────────────────────────── */}
      <nav className="nav-tabs" role="tablist" aria-label="Main navigation">
        <button id="tab-session" role="tab" aria-selected={tab === "session"} aria-controls="panel-session" className={`nav-tab ${tab === "session" ? "nav-tab--active" : ""}`} onClick={() => setTab("session")}>
          Live Session
        </button>
        <button id="tab-insights" role="tab" aria-selected={tab === "insights"} aria-controls="panel-insights" className={`nav-tab ${tab === "insights" ? "nav-tab--active" : ""}`} onClick={() => setTab("insights")}>
          Insights
        </button>
      </nav>

      {/* ── Tab Content ────────────────────────────────────── */}
      {tab === "insights" ? (
        <section id="panel-insights" role="tabpanel" aria-labelledby="tab-insights">
          <ErrorBoundary>
            <Suspense fallback={<div className="transcript-empty">Loading insights…</div>}>
              <TrustDashboard tenantId={tenantId} httpBase={httpBase} token={authToken} />
            </Suspense>
          </ErrorBoundary>

          {/* CRM Demo Panel */}
          <div className="trust-panel" style={{ marginTop: 16 }}>
            <div className="trust-score-hero" style={{ padding: "16px 20px" }}>
              <div className="trust-score-label" style={{ fontWeight: 600, marginBottom: 12 }}>CRM Integration Demo</div>
              <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
                {(["salesforce", "hubspot"] as const).map((crm) => (
                  <button
                    key={crm}
                    className="btn-luxury btn-luxury--secondary btn-luxury--sm"
                    onClick={async () => {
                      setCrmStatus(`Writing to ${crm}…`);
                      const token = await ensureAuth();
                      const res = await postCrmNote({
                        tenantId,
                        integration: crm,
                        idempotencyKey: `demo_${crm}_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`,
                        payload: { note: `Demo note from session ${sessionId}`, createdBy: repId }
                      }, httpBase, token);
                      setCrmStatus(
                        res.ok
                          ? `✓ ${crm} note created (${res.result?.externalId ?? "ok"})`
                          : `✕ ${crm} write failed`
                      );
                      setTimeout(() => setCrmStatus(null), 5000);
                    }}
                  >
                    Write {crm === "salesforce" ? "Salesforce" : "HubSpot"} Note
                  </button>
                ))}
              </div>
              {crmStatus && (
                <div style={{ marginTop: 12, fontSize: 13, textAlign: "center", opacity: 0.8 }}>{crmStatus}</div>
              )}
              <div style={{ marginTop: 8, fontSize: 11, textAlign: "center", opacity: 0.4 }}>
                Writes are idempotent with retry/backoff · Audit trail in crm_write_events table
              </div>
            </div>
          </div>
        </section>
      ) : (
        <section id="panel-session" className="main-content" role="tabpanel" aria-labelledby="tab-session">
          {/* ── Left Panel: Conversation ────────────────── */}
          <div className="panel panel--left">
            <div className="panel-header">
              <div className="panel-title">Conversation</div>
              <div className="panel-subtitle">Type what you hear — we'll coach you in real time</div>

              {/* Speaker Toggle */}
              <div style={{ marginTop: 14 }}>
                <div className="speaker-bar" role="radiogroup" aria-label="Select who is speaking">
                  {(["rep", "lead", "unknown"] as Speaker[]).map((s) => (
                    <button
                      key={s} role="radio" aria-checked={speaker === s}
                      className={`speaker-btn ${speaker === s ? "speaker-btn--active" : ""}`}
                      onClick={() => setSpeaker(s)}
                    >
                      {s === "rep" ? "You (Rep)" : s === "lead" ? "The Lead" : "Not Sure"}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Transcript Stream */}
            <div className="panel-body">
              {transcript.length > 0 ? (
                <div className="transcript-stream" role="log" aria-live="polite" aria-label="Conversation transcript">
                  {transcript.map((entry, i) => (
                    <div key={i} className={`transcript-bubble transcript-bubble--${entry.speaker === "rep" ? "rep" : "lead"}`}>
                      <div className="transcript-speaker">
                        {entry.speaker === "rep" ? "You" : entry.speaker === "lead" ? "Lead" : "Speaker"}
                      </div>
                      {entry.text}
                    </div>
                  ))}
                  <div ref={transcriptEndRef} />
                </div>
              ) : (
                <div className="transcript-empty">
                  Start typing below to begin the conversation. Tips will appear on the right.
                </div>
              )}
            </div>

            {/* Input Area */}
            {/* Interim Speech Preview */}
            {micOn && (interimText || micInterim) && (
              <div className="mic-interim" aria-live="polite">
                <span className="mic-interim-dot" />
                {interimText || micInterim || "Listening…"}
              </div>
            )}

            {/* Input Area */}
            <div className="input-area">
              <div className="input-row">
                {micSupported && (
                  <button
                    className={`btn-mic ${micOn ? "btn-mic--active" : ""}`}
                    onClick={toggleMic}
                    disabled={wsStatus !== "ready"}
                    title={micOn ? "Stop microphone" : "Start microphone"}
                    aria-label={micOn ? "Stop microphone" : "Start microphone"}
                  >
                    {micOn ? "◼" : "🎤"}
                  </button>
                )}
                <textarea
                  className="input-field"
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder={micOn ? "Mic is live — speak naturally…" : "Type what's being said…"}
                  aria-label="Enter what is being said in the conversation"
                  disabled={wsStatus !== "ready"}
                  rows={1}
                />
                <button
                  className="btn-luxury btn-luxury--primary"
                  onClick={sendTranscript}
                  disabled={wsStatus !== "ready" || !inputText.trim()}
                >
                  Send
                </button>
              </div>
              <div className="input-hint">
                {micSupported
                  ? (micOn ? "🔴 Mic active — speaking is auto-sent · You can also type" : "🎤 Click mic for hands-free · Enter to send · Ctrl+M toggle mic")
                  : "Press Enter to send · Shift+Enter for new line · Ctrl+K to focus"}
                {aiMode === "ai" && <span style={{ float: "right", color: "var(--color-success)" }}>● AI Coach Active</span>}
                {aiMode === "templates" && <span style={{ float: "right", opacity: 0.5 }}>○ Template Mode</span>}
              </div>
            </div>
          </div>

          {/* ── Center Panel: Sound Wave Orb ────────────── */}
          <div className="panel panel--center">
            <SoundWaveOrb mode={orbMode} size={180} />
          </div>

          {/* ── Right Panel: Guidance ───────────────────── */}
          <div className="panel panel--right">
            <div className="panel-header">
              <div className="panel-title">Coaching</div>
              <div className="panel-subtitle">
                {activeProfile ? `Guidance for ${activeProfile.productName || activeProfile.name}` : "Word-for-word tips"}
              </div>
            </div>

            <div className="panel-body">
              <OverlayPreview
                state={overlayState}
                onShown={onShown}
                onApply={onApply}
                onDismiss={onDismiss}
                onMuteToggle={onMuteToggle}
              />
            </div>
          </div>
        </section>
      )}

      {/* ── Profile Manager Modal ──────────────────────────── */}
      <Suspense fallback={null}>
        <ProfileManager isOpen={profileOpen} onClose={() => setProfileOpen(false)} onActiveProfileChange={setActiveProfile} />
      </Suspense>

      {/* ── FAQ / Help Center ──────────────────────────────── */}
      {faqOpen && (
        <Suspense fallback={<div className="transcript-empty">Loading help…</div>}>
          <FaqPage onClose={() => setFaqOpen(false)} />
        </Suspense>
      )}
    </div>
  );
}
