import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { OverlayMessageV1, OverlayStateV1, WsServerMessageV1 } from "@overlay-assistant/shared";
import { sanitizePatch_v1 } from "@overlay-assistant/shared";
import { OverlayPreview } from "./components/OverlayPreview";
import { TrustDashboard } from "./components/TrustDashboard";
import { SetupPanel } from "./components/SetupPanel";
import { LiveAudioPanel } from "./components/LiveAudioPanel";
import { ProductContextPanel } from "./components/ProductContextPanel";
import { LiveGuidanceDashboard, type GuidanceDashboard } from "./components/LiveGuidanceDashboard";
import { postUiEvent } from "./lib/api";
import { API_BASE, WS_URL, API_KEY, apiHeaders } from "./lib/config";

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
      showLowConfidence: false
    }
  }
};

export function App() {
  const [tab, setTab] = useState<"demo" | "trust" | "setup">("demo");
  const [tenantId, setTenantId] = useState("tenant_demo");
  const [repId, setRepId] = useState("rep_demo");
  const [sessionId, setSessionId] = useState(() => newId("sess"));
  const [wsStatus, setWsStatus] = useState<"disconnected" | "connecting" | "ready">("disconnected");
  const [ws, setWs] = useState<WebSocket | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const [transcript, setTranscript] = useState<string[]>([]);
  const [overlayState, setOverlayState] = useState<OverlayStateV1>(DEFAULT_STATE);
  const [inputText, setInputText] = useState("");
  const [lastOverlayMessage, setLastOverlayMessage] = useState<any>(null);
  const [lastPatchPayload, setLastPatchPayload] = useState<any>(null);
  const [connectedDevices, setConnectedDevices] = useState<Array<{ id: string; type: string; name?: string }>>([]);
  const [lastCorrection, setLastCorrection] = useState<string>("");
  const [latestTimelineEvent, setLatestTimelineEvent] = useState<any>(null);
  const [audioRunning, setAudioRunning] = useState(false);
  const [guidanceDashboard, setGuidanceDashboard] = useState<GuidanceDashboard | null>(null);
  const [guidanceHistory, setGuidanceHistory] = useState<GuidanceDashboard[]>([]);
  const [simpleMode, setSimpleMode] = useState(false);
  const [speakerTurn, setSpeakerTurn] = useState<{
    speaker: "rep" | "customer" | "unknown";
    text: string;
    confidence: number;
    isNewTurn: boolean;
    talkRatio: { rep: number; customer: number };
    coachingContext: { customerIntent?: string; repAssessment?: string };
  } | null>(null);

  const currentHost = window.location.hostname;
  const mobileHost = (currentHost === "localhost" || currentHost === "127.0.0.1")
    ? "<YOUR-LAPTOP-IP>"
    : currentHost;
  const mobileWebUrl = `http://${mobileHost}:5173`;
  const mobileAppUrl = `http://${mobileHost}:5174`;

  const applyPatch = (patch: any) => {
    setOverlayState((s: any) => {
      const next: any = { ...s };

      if (patch && typeof patch.text === "string") next.text = patch.text;

      if (patch && patch.settings && typeof patch.settings === "object") {
        next.settings = { ...next.settings, ...patch.settings };
      }

      if (patch && patch.guidance && typeof patch.guidance === "object" && Array.isArray(patch.guidance.items)) {
        next.guidance = { ...next.guidance, items: patch.guidance.items };
      }

      return next;
    });
  };

  const handleOverlayMessage = async (m: OverlayMessageV1) => {
    if (m.type === "settings") {
      setOverlayState((s: any) => ({ ...s, settings: (m as any).settings }));
      return;
    }

    if (m.type === "patch") {
      const res = sanitizePatch_v1((m as any).patch);
      // DEBUG: verify patch payload shape
      // eslint-disable-next-line no-console
      console.log("[patch payload]", (m as any).patch);

      if (!res.ok) {
        await postUiEvent({
          tenantId,
          repId,
          sessionId,
          eventType: "patch_rejected",
          data: { reason: (res as any).reason, bytes: (res as any).bytes }
        });
        return;
      }

      await postUiEvent({
        tenantId,
        repId,
        sessionId,
        eventType: "patch_received",
        data: { bytes: (res as any).bytes }
      });

      applyPatch((res as any).patch);
      return;
    }
  };

  const connect = useCallback(() => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) return; // already connected
    setWsStatus("connecting");
    const next = new WebSocket(WS_URL);
    wsRef.current = next;

    next.onopen = () => {
      next.send(JSON.stringify({ type: "start", session_id: sessionId, tenantId, repId, apiKey: API_KEY, deviceType: "desktop", clientName: "desktop-overlay", role: "host" }));
    };

    next.onmessage = async (ev) => {
      const msg = JSON.parse(ev.data) as WsServerMessageV1;

      if (msg.type === "ready") {
        setWsStatus("ready");
        return;
      }

      if (msg.type === "transcript_final") {
        setTranscript((t) => [...t, msg.text]);
        return;
      }

      if (msg.type === "overlay_message") {
        setLastOverlayMessage(msg.message as any);
        setLastPatchPayload((msg.message as any)?.type === "patch" ? (msg.message as any).patch : null);
        handleOverlayMessage(msg.message as any);
        return;
      }

      if (msg.type === "session_state") {
        setConnectedDevices(msg.state.connectedDevices as any);
        setOverlayState((s) => ({ ...s, settings: { ...s.settings, controls: msg.state.controls } }));
        return;
      }

      if (msg.type === "correction") {
        setLastCorrection(msg.correction.note);
        return;
      }

      if (msg.type === "timeline_event") {
        setLatestTimelineEvent({ at: msg.at, event: msg.event });
      }

      if ((msg as any).type === "guidance_dashboard") {
        const d = (msg as any).dashboard;
        if (d) {
          setGuidanceDashboard(d);
          setGuidanceHistory(h => [...h, d].slice(-50));
        }
      }

      if ((msg as any).type === "speaker_turn") {
        const st = msg as any;
        setSpeakerTurn({
          speaker: st.speaker ?? "unknown",
          text: st.text ?? "",
          confidence: st.confidence ?? 0,
          isNewTurn: Boolean(st.isNewTurn),
          talkRatio: st.talkRatio ?? { rep: 50, customer: 50 },
          coachingContext: st.coachingContext ?? {},
        });
      }
    };

    next.onclose = () => {
      setWsStatus("disconnected");
      setWs(null);
      wsRef.current = null;
    };

    setWs(next);
  }, [sessionId, tenantId, repId]);

  const sendControl = (action: string, value?: string | boolean | number | null) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: "control", action, value: value ?? null, source: "desktop", session_id: sessionId, at: new Date().toISOString() }));
  };

  const sendLearning = (outcome: "helpful" | "unhelpful" | "ignored") => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: "learning_signal", source: "desktop", outcome, session_id: sessionId, at: new Date().toISOString() }));
  };

  // Hands-free: auto-connect WS when audio starts
  const handleAudioStateChange = useCallback((running: boolean) => {
    setAudioRunning(running);
    if (running && (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN)) {
      connect();
    }
  }, [connect]);

  const sendTranscript = async () => {
    const text = inputText.trim();
    if (!text) return;
    setInputText("");
    await fetch(`${API_BASE}/api/demo/transcript_final`, {
      method: "POST",
      headers: apiHeaders(),
      body: JSON.stringify({ session_id: sessionId, text })
    });
  };

  const onShown = async (itemId: string) => {
    await postUiEvent({ tenantId, repId, sessionId, eventType: "suggestion_shown", data: { itemId } });
  };

  const onApply = async (itemId: string) => {
    await postUiEvent({ tenantId, repId, sessionId, eventType: "suggestion_applied", data: { itemId } });
    sendLearning("helpful");
  };

  const onDismiss = async (itemId: string) => {
    await postUiEvent({ tenantId, repId, sessionId, eventType: "suggestion_dismissed", data: { itemId } });
    sendLearning("unhelpful");
    setOverlayState((s) => ({ ...s, guidance: { ...s.guidance, items: s.guidance.items.filter((x) => x.id !== itemId) } }));
    setOverlayState((s: any) => ({ ...s, text: "" }));
  };

  const onMuteToggle = async () => {
    const muted = !overlayState.settings.controls.guidanceMuted;
    sendControl("toggle_mute");
    await postUiEvent({ tenantId, repId, sessionId, eventType: muted ? "mute_on" : "mute_off", data: {} });
  };

  const disconnect = () => {
    if (ws) {
      ws.send(JSON.stringify({ type: "stop", session_id: sessionId }));
      ws.close();
    }
    setWs(null);
    wsRef.current = null;
    setWsStatus("disconnected");
  };

// Derive the primary "say this" text for Simple Mode
  const primaryLine = guidanceDashboard?.primary?.text ?? null;
  const primaryTitle = guidanceDashboard?.primary?.title ?? null;
  const currentStage = guidanceDashboard?.stage ?? "waiting";
  const customerSaid = guidanceDashboard?.speakerData?.lastCustomerText ?? null;

  return (
    <div className="oa-web-shell">

      {/* ═══ SIMPLE MODE TOGGLE — always visible at top ═══ */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
        <button
          onClick={() => setSimpleMode(!simpleMode)}
          style={{
            flex: "0 0 auto",
            padding: "14px 32px",
            fontSize: 18,
            fontWeight: 800,
            borderRadius: 12,
            border: "2px solid",
            borderColor: simpleMode ? "#4ade80" : "#60a5fa",
            background: simpleMode ? "rgba(74,222,128,0.15)" : "rgba(96,165,250,0.1)",
            color: simpleMode ? "#4ade80" : "#60a5fa",
            cursor: "pointer",
            transition: "all 0.3s ease",
            letterSpacing: "0.5px",
          }}
        >
          {simpleMode ? "EXIT SIMPLE MODE" : "SIMPLE MODE"}
        </button>
        {!simpleMode && <h2 className="oa-title" style={{ margin: 0 }}>Overlay Assistant — Live AI Sales Command Center</h2>}
        {simpleMode && (
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginLeft: "auto" }}>
            <span style={{
              fontSize: 13,
              color: wsStatus === "ready" ? "#4ade80" : audioRunning ? "#fbbf24" : "#ff9ca8",
              fontWeight: 700,
            }}>
              {wsStatus === "ready" && audioRunning ? "● LIVE" : wsStatus === "ready" ? "● CONNECTED" : audioRunning ? "● AUDIO ONLY" : "● IDLE"}
            </span>
          </div>
        )}
      </div>

      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {/* ═══ SIMPLE MODE — full-screen teleprompter view ═══════════════════ */}
      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {simpleMode ? (
        <div style={{
          display: "flex", flexDirection: "column",
          minHeight: "calc(100vh - 100px)",
          gap: 12,
        }}>
          {/* Minimal audio + session controls */}
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <LiveAudioPanel
              tenantId={tenantId}
              repId={repId}
              sessionId={sessionId}
              timelinePush={latestTimelineEvent}
              onAudioStateChange={handleAudioStateChange}
              speakerTurn={speakerTurn}
              compact
            />
            {wsStatus === "ready" ? (
              <button
                onClick={() => disconnect()}
                style={{
                  padding: "10px 20px", fontSize: 14, fontWeight: 700,
                  borderRadius: 8, border: "1px solid #ff6b7f", background: "rgba(255,107,127,0.1)",
                  color: "#ff6b7f", cursor: "pointer"
                }}
              >
                Stop Session
              </button>
            ) : (
              <button
                onClick={() => connect()}
                style={{
                  padding: "10px 20px", fontSize: 14, fontWeight: 700,
                  borderRadius: 8, border: "1px solid #4ade80", background: "rgba(74,222,128,0.1)",
                  color: "#4ade80", cursor: "pointer"
                }}
              >
                Start Session
              </button>
            )}
          </div>

          {/* What the customer just said (small) */}
          {customerSaid && (
            <div style={{
              padding: "10px 16px", borderRadius: 10,
              background: "rgba(251,191,36,0.06)", borderLeft: "4px solid #fbbf24",
              fontSize: 14, color: "#fbbf24", lineHeight: 1.4,
            }}>
              <span style={{ fontWeight: 700, fontSize: 12, textTransform: "uppercase", letterSpacing: 1 }}>CUSTOMER SAID: </span>
              <span style={{ color: "#cbd5e1" }}>"{customerSaid.length > 200 ? customerSaid.slice(0, 200) + "..." : customerSaid}"</span>
            </div>
          )}

          {/* ═══ THE MAIN EVENT: What to say ═══ */}
          <div style={{
            flex: 1,
            display: "flex", flexDirection: "column",
            justifyContent: "center", alignItems: "center",
            padding: "40px 30px",
            borderRadius: 16,
            background: primaryLine
              ? "linear-gradient(135deg, rgba(74,222,128,0.06) 0%, rgba(96,165,250,0.06) 100%)"
              : "rgba(30,41,59,0.5)",
            border: primaryLine ? "2px solid rgba(74,222,128,0.3)" : "1px solid #2b3a51",
            transition: "all 0.5s ease",
            minHeight: 300,
          }}>
            {primaryLine ? (
              <>
                <div style={{
                  fontSize: 14, fontWeight: 700, color: "#4ade80",
                  textTransform: "uppercase", letterSpacing: 2, marginBottom: 16,
                }}>
                  {primaryTitle || "SAY THIS NOW"}
                </div>
                <div style={{
                  fontSize: 32, fontWeight: 600, lineHeight: 1.4,
                  color: "#f1f5f9", textAlign: "center",
                  maxWidth: 850,
                  transition: "all 0.3s ease",
                }}>
                  {primaryLine}
                </div>
                {guidanceDashboard?.primary?.confidence != null && (
                  <div style={{
                    marginTop: 20, fontSize: 12, color: "#9db2ce",
                    textTransform: "uppercase", letterSpacing: 1
                  }}>
                    {currentStage} • confidence {Math.round(guidanceDashboard.primary.confidence * 100)}%
                  </div>
                )}
              </>
            ) : (
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: 48, marginBottom: 16 }}>🎯</div>
                <div style={{ fontSize: 22, color: "#9db2ce", fontWeight: 500 }}>
                  {audioRunning && wsStatus === "ready"
                    ? "Listening... start speaking and guidance will appear here automatically."
                    : "Start audio to begin — the AI will tell you exactly what to say."}
                </div>
              </div>
            )}
          </div>

          {/* Alternatives (compact, below) */}
          {guidanceDashboard?.alternatives && guidanceDashboard.alternatives.length > 0 && (
            <div style={{
              display: "flex", gap: 8, flexWrap: "wrap",
              padding: "8px 0"
            }}>
              <span style={{ fontSize: 11, color: "#9db2ce", fontWeight: 700, alignSelf: "center" }}>OR:</span>
              {guidanceDashboard.alternatives.slice(0, 3).map((alt, i) => (
                <div key={i} style={{
                  padding: "8px 14px", borderRadius: 8,
                  background: "rgba(96,165,250,0.08)", border: "1px solid #2b3a51",
                  fontSize: 13, color: "#cbd5e1", cursor: "pointer", lineHeight: 1.3,
                  maxWidth: 350
                }}
                  onClick={() => navigator.clipboard?.writeText(alt.text).catch(() => undefined)}
                  title="Click to copy"
                >
                  <b style={{ color: "#60a5fa" }}>{alt.strategy}: </b>{alt.text.length > 100 ? alt.text.slice(0, 100) + "..." : alt.text}
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
      /* ═══════════════════════════════════════════════════════════════════════ */
      /* ═══ FULL MODE — original 3-column command center ═══════════════════ */
      /* ═══════════════════════════════════════════════════════════════════════ */
      <>
      {/* ─── Persistent status bar (always visible) ─── */}
      <div className="oa-status-bar">
        <span>
          Session: <b className={wsStatus === "ready" ? "oa-status-ready" : "oa-subtle"}>{wsStatus === "ready" ? "Connected" : wsStatus === "connecting" ? "Connecting…" : "Disconnected"}</b>
        </span>
        {audioRunning && <span className="oa-status-ready">● Audio live</span>}
        <span className="oa-subtle" style={{ fontSize: 11 }}>
          {connectedDevices.length ? `Devices: ${connectedDevices.map((d) => d.type).join(", ")}` : "No devices"}
        </span>
        {wsStatus !== "ready" ? (
          <button className="oa-btn-sm" onClick={() => connect()}>Start Session</button>
        ) : (
          <button className="oa-btn-sm" onClick={() => disconnect()}>End Session</button>
        )}
      </div>

      <div className="oa-card" style={{ marginBottom: 12, padding: 10 }}>
        <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>Mobile URLs</div>
        <div style={{ display: "grid", gridTemplateColumns: "110px 1fr auto", gap: 6, alignItems: "center", fontSize: 12 }}>
          <span className="oa-subtle">Web (phone):</span>
          <span>{mobileWebUrl}</span>
          <button
            className="oa-btn-sm"
            onClick={() => navigator.clipboard?.writeText(mobileWebUrl).catch(() => undefined)}
            style={{ marginLeft: 0 }}
          >
            Copy
          </button>

          <span className="oa-subtle">Mobile app:</span>
          <span>{mobileAppUrl}</span>
          <button
            className="oa-btn-sm"
            onClick={() => navigator.clipboard?.writeText(mobileAppUrl).catch(() => undefined)}
            style={{ marginLeft: 0 }}
          >
            Copy
          </button>
        </div>
        {(currentHost === "localhost" || currentHost === "127.0.0.1") ? (
          <div className="oa-subtle" style={{ fontSize: 11, marginTop: 6 }}>
            Replace <b>&lt;YOUR-LAPTOP-IP&gt;</b> with your computer LAN IP (example: 192.168.1.24).
          </div>
        ) : null}
      </div>

      <div className="oa-tabbar">
        <button onClick={() => setTab("demo")} disabled={tab === "demo"}>
          Live Demo
        </button>
        <button onClick={() => setTab("trust")} disabled={tab === "trust"}>
          Trust Dashboard
        </button>
        <button onClick={() => setTab("setup")} disabled={tab === "setup"}>
          Setup &amp; Privacy
        </button>
      </div>

      {tab === "trust" ? (
        <TrustDashboard tenantId={tenantId} />
      ) : tab === "setup" ? (
        <SetupPanel tenantId={tenantId} sessionId={sessionId} />
      ) : (
        <>
          {/* ─── Product Context (collapsed by default once saved) ─── */}
          <ProductContextPanel
            tenantId={tenantId}
            sessionId={sessionId}
          />

          {/* ─── Demo view: 3-column command center ─── */}
          <div className="oa-command-grid">
            {/* LEFT: Audio + Transcript */}
            <div>
              <LiveAudioPanel
                tenantId={tenantId}
                repId={repId}
                sessionId={sessionId}
                timelinePush={latestTimelineEvent}
                onAudioStateChange={handleAudioStateChange}
                speakerTurn={speakerTurn}
              />

              {/* Quick inject */}
              <div className="oa-card" style={{ marginTop: 10 }}>
                <h4 style={{ margin: "0 0 6px" }}>Inject transcript (manual)</h4>
                <textarea
                  style={{ width: "100%", height: 50 }}
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  placeholder="Type what the buyer said…"
                />
                <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
                  <button onClick={() => sendTranscript()}>Send</button>
                  <button onClick={() => sendLearning("helpful")} disabled={wsStatus !== "ready"}>👍</button>
                  <button onClick={() => sendLearning("ignored")} disabled={wsStatus !== "ready"}>🤷</button>
                </div>
              </div>
            </div>

            {/* CENTER: Live AI Guidance Dashboard */}
            <div>
              <LiveGuidanceDashboard
                dashboard={guidanceDashboard}
                onApplySuggestion={(text) => {
                  navigator.clipboard?.writeText(text).catch(() => {});
                  sendLearning("helpful");
                }}
              />
            </div>

            {/* RIGHT: Session controls + classic overlay */}
            <div>
              <div className="oa-card">
                <h3 style={{ marginTop: 0 }}>Session</h3>
                <div style={{ display: "grid", gridTemplateColumns: "70px 1fr", gap: 6, fontSize: 13 }}>
                  <label>Tenant</label>
                  <input value={tenantId} onChange={(e) => setTenantId(e.target.value)} style={{ fontSize: 12 }} />
                  <label>Rep</label>
                  <input value={repId} onChange={(e) => setRepId(e.target.value)} style={{ fontSize: 12 }} />
                  <label>Session</label>
                  <input value={sessionId} readOnly style={{ opacity: 0.7, fontSize: 12 }} />
                </div>

                <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
                  {wsStatus !== "ready" ? (
                    <button onClick={() => connect()}>▶ Start</button>
                  ) : (
                    <button onClick={() => disconnect()}>⏹ End</button>
                  )}
                  <button onClick={() => sendControl("request_reframe")} disabled={wsStatus !== "ready"}>Reframe</button>
                  <button onClick={() => sendControl("set_guidance_mode", "assist")} disabled={wsStatus !== "ready"}>Assist</button>
                  <button onClick={() => sendControl("set_guidance_mode", "auto")} disabled={wsStatus !== "ready"}>Auto</button>
                  <button
                    onClick={() => {
                      disconnect();
                      setSessionId(newId("sess"));
                      setTranscript([]);
                      setOverlayState(DEFAULT_STATE);
                      setLastCorrection("");
                      setAudioRunning(false);
                      setGuidanceDashboard(null);
                      setGuidanceHistory([]);
                    }}
                  >
                    New Session
                  </button>
                </div>

                {lastCorrection ? (
                  <div className="oa-correction">
                    <b>Coach correction:</b> {lastCorrection}
                  </div>
                ) : null}
              </div>

              <div className="oa-card" style={{ marginTop: 10 }}>
                <h4 style={{ margin: "0 0 6px" }}>Classic Overlay</h4>
                <OverlayPreview
                  state={overlayState}
                  onShown={onShown}
                  onApply={onApply}
                  onDismiss={onDismiss}
                  onMuteToggle={onMuteToggle}
                />
              </div>

              <div className="oa-card" style={{ marginTop: 10 }}>
                <h4 style={{ margin: "0 0 6px" }}>Transcript stream</h4>
                <div style={{ fontSize: 12, whiteSpace: "pre-wrap", maxHeight: 160, overflow: "auto" }}>
                  {transcript.length ? transcript.map((t, i) => <div key={i} style={{ marginBottom: 3 }}>{t}</div>) : <span className="oa-subtle">No transcript yet.</span>}
                </div>
              </div>
            </div>
          </div>
        </>
      )}
      </>
      )}
    </div>
  );
}
