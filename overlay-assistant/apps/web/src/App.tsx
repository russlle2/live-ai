import React, { useMemo, useState, useCallback, useRef, useEffect } from "react";
import type { OverlayMessageV1, OverlayStateV1, WsServerMessageV1 } from "@overlay-assistant/shared";
import { sanitizePatch_v1 } from "@overlay-assistant/shared";
import { OverlayPreview } from "./components/OverlayPreview";
import { TrustDashboard } from "./components/TrustDashboard";
import { SoundWaveOrb } from "./components/SoundWaveOrb";
import { ProfileManager } from "./components/ProfileManager";
import type { ProductProfile } from "./components/ProfileManager";
import { postUiEvent, postCrmNote } from "./lib/api";
import "./styles.css";

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
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const orbTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasConnected = useRef(false);
  const transcriptEndRef = useRef<HTMLDivElement>(null);

  /* ── Auto-scroll transcript ─────────────────────────────────── */
  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [transcript]);

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

  /* ── Orb animation trigger ──────────────────────────────────── */
  const flashOrb = useCallback((mode: OrbMode, durationMs = 3000) => {
    setOrbMode(mode);
    if (orbTimer.current) clearTimeout(orbTimer.current);
    orbTimer.current = setTimeout(() => {
      setOrbMode(wsStatus === "ready" ? "listening" : "idle");
    }, durationMs);
  }, [wsStatus]);

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
          postUiEvent({ tenantId, repId, sessionId, eventType: "patch_rejected", data: { reason: (res as any).reason, bytes: (res as any).bytes } }, httpBase);
          const raw = (m as any).patch;
          if (raw && typeof raw === "object" && typeof raw.text === "string") applyPatch({ text: raw.text });
          return;
        }
        postUiEvent({ tenantId, repId, sessionId, eventType: "patch_received", data: { bytes: (res as any).bytes } }, httpBase);
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

    try {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        ws.send(JSON.stringify({ type: "start", session_id: sessionId, tenantId, repId }));
      };

      ws.onmessage = async (ev) => {
        try {
          const msg = JSON.parse(ev.data) as WsServerMessageV1;
          if (msg.type === "ready") { hasConnected.current = true; setWsStatus("ready"); setOrbMode("listening"); setError(null); return; }
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
        setError(hasConnected.current ? "Connection lost. Reconnecting\u2026" : "Could not reach the server. Check that it\u2019s running and try again.");
      };
    } catch {
      setError("Could not connect to server. Is it running?");
      setWsStatus("disconnected");
    }
  }, [wsUrl, sessionId, tenantId, repId, handleOverlayMessage, flashOrb]);

  /* ── Cleanup on unmount ─────────────────────────────────────── */
  useEffect(() => {
    return () => {
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      if (orbTimer.current) clearTimeout(orbTimer.current);
      wsRef.current?.close();
    };
  }, []);

  /* ── Send transcript ────────────────────────────────────────── */
  const sendTranscript = useCallback(async () => {
    const text = inputText.trim();
    if (!text) return;
    setInputText("");
    setTranscript((t) => [...t, { text, speaker, at: new Date().toISOString() }]);
    flashOrb("listening", 2000);

    // Build product context from active profile (if any)
    const pc = activeProfile ? {
      productName: activeProfile.productName || undefined,
      differentiators: activeProfile.keyDifferentiators || undefined,
      competitors: activeProfile.competitors || undefined,
      targetIndustry: activeProfile.targetIndustry || undefined,
      commonObjections: activeProfile.commonObjections || undefined,
    } : undefined;

    try {
      await fetch(`${httpBase}/api/demo/transcript_final`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: sessionId, text, speaker, productContext: pc }),
      });
    } catch {
      setError("Failed to send \u2014 check your connection");
    }
  }, [inputText, speaker, sessionId, httpBase, flashOrb, activeProfile]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendTranscript(); }
    },
    [sendTranscript]
  );

  /* ── Telemetry callbacks ────────────────────────────────────── */
  const onShown = async (itemId: string) => { postUiEvent({ tenantId, repId, sessionId, eventType: "suggestion_shown", data: { itemId } }, httpBase); };
  const onApply = async (itemId: string) => { postUiEvent({ tenantId, repId, sessionId, eventType: "suggestion_applied", data: { itemId } }, httpBase); };
  const onDismiss = async (itemId: string) => {
    postUiEvent({ tenantId, repId, sessionId, eventType: "suggestion_dismissed", data: { itemId } }, httpBase);
    setOverlayState((s) => ({ ...s, guidance: { ...s.guidance, items: s.guidance.items.filter((x) => x.id !== itemId) } }));
    setOverlayState((s: any) => ({ ...s, text: "" }));
  };
  const onMuteToggle = async () => {
    const muted = !overlayState.settings.controls.guidanceMuted;
    setOverlayState((s) => ({ ...s, settings: { ...s.settings, controls: { ...s.settings.controls, guidanceMuted: muted } } }));
    postUiEvent({ tenantId, repId, sessionId, eventType: muted ? "mute_on" : "mute_off", data: {} }, httpBase);
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
        <ProfileManager isOpen={profileOpen} onClose={() => setProfileOpen(false)} onActiveProfileChange={setActiveProfile} />
      </div>
    );
  }

  // ── Main Application Shell ──
  return (
    <div className="app-shell">
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
        <button role="tab" aria-selected={tab === "session"} className={`nav-tab ${tab === "session" ? "nav-tab--active" : ""}`} onClick={() => setTab("session")}>
          Live Session
        </button>
        <button role="tab" aria-selected={tab === "insights"} className={`nav-tab ${tab === "insights" ? "nav-tab--active" : ""}`} onClick={() => setTab("insights")}>
          Insights
        </button>
      </nav>

      {/* ── Tab Content ────────────────────────────────────── */}
      {tab === "insights" ? (
        <div>
          <TrustDashboard tenantId={tenantId} httpBase={httpBase} />

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
                      const res = await postCrmNote({
                        tenantId,
                        integration: crm,
                        idempotencyKey: `demo_${crm}_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`,
                        payload: { note: `Demo note from session ${sessionId}`, createdBy: repId }
                      }, httpBase);
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
        </div>
      ) : (
        <div className="main-content">
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
            <div className="input-area">
              <div className="input-row">
                <textarea
                  className="input-field"
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Type what's being said\u2026"
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
              <div className="input-hint">Press Enter to send · Shift+Enter for new line</div>
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
        </div>
      )}

      {/* ── Profile Manager Modal ──────────────────────────── */}
      <ProfileManager isOpen={profileOpen} onClose={() => setProfileOpen(false)} onActiveProfileChange={setActiveProfile} />
    </div>
  );
}
