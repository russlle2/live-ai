import React, { useMemo, useState } from "react";
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

  const connect = () => {
    if (ws && ws.readyState === WebSocket.OPEN) return; // already connected
    setWsStatus("connecting");
    const next = new WebSocket(WS_URL);

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
    };

    next.onclose = () => {
      setWsStatus("disconnected");
      setWs(null);
    };

    setWs(next);
  };

  const sendControl = (action: string, value?: string | boolean | number | null) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: "control", action, value: value ?? null, source: "desktop", session_id: sessionId, at: new Date().toISOString() }));
  };

  const sendLearning = (outcome: "helpful" | "unhelpful" | "ignored") => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: "learning_signal", source: "desktop", outcome, session_id: sessionId, at: new Date().toISOString() }));
  };

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
    setWsStatus("disconnected");
  };

  return (
    <div className="oa-web-shell">
      <h2 className="oa-title">Overlay Assistant — Live AI Sales Command Center</h2>

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
                onAudioStateChange={setAudioRunning}
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
    </div>
  );
}
