import React, { useMemo, useState } from "react";
import type { OverlayMessageV1, OverlayStateV1, WsServerMessageV1 } from "@overlay-assistant/shared";
import { sanitizePatch_v1 } from "@overlay-assistant/shared";
import { OverlayPreview } from "./components/OverlayPreview";
import { TrustDashboard } from "./components/TrustDashboard";
import { SetupPanel } from "./components/SetupPanel";
import { LiveAudioPanel } from "./components/LiveAudioPanel";
import { postUiEvent } from "./lib/api";

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
  const apiKey = (import.meta as any).env?.VITE_OVERLAY_API_KEY as string | undefined;
  const [tab, setTab] = useState<"demo" | "trust" | "audio">("demo");
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

  const wsUrl = useMemo(() => {
    const host = window.location.hostname;
    return `ws://${host}:8080/ws`;
  }, []);

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
    setWsStatus("connecting");
    const next = new WebSocket(wsUrl);

    next.onopen = () => {
      next.send(JSON.stringify({ type: "start", session_id: sessionId, tenantId, repId, apiKey, deviceType: "desktop", clientName: "desktop-overlay", role: "host" }));
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
    await fetch("http://localhost:8080/api/demo/transcript_final", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(apiKey ? { "x-overlay-key": apiKey } : {}) },
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

  return (
    <div className="oa-web-shell">
      <h2 className="oa-title">Overlay Assistant Universal Coach</h2>

      <div className="oa-tabbar">
        <button onClick={() => setTab("demo")} disabled={tab === "demo"}>
          Demo
        </button>
        <button onClick={() => setTab("trust")} disabled={tab === "trust"}>
          Trust Dashboard
        </button>
        <button onClick={() => setTab("audio")} disabled={tab === "audio"}>
          Live Audio
        </button>
      </div>

      {tab === "trust" ? (
        <TrustDashboard tenantId={tenantId} />
      ) : tab === "audio" ? (
        <LiveAudioPanel tenantId={tenantId} repId={repId} sessionId={sessionId} timelinePush={latestTimelineEvent} />
      ) : (
        <div className="oa-grid">
          <div className="oa-card">
            <h3>Session</h3>
            <div style={{ display: "grid", gridTemplateColumns: "120px 1fr", gap: 8 }}>
              <label>Tenant</label>
              <input value={tenantId} onChange={(e) => setTenantId(e.target.value)} />
              <label>Rep</label>
              <input value={repId} onChange={(e) => setRepId(e.target.value)} />
              <label>Session</label>
              <input value={sessionId} onChange={(e) => setSessionId(e.target.value)} />
            </div>

            <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
              <button onClick={() => connect()}>Start Session</button>
              <button onClick={() => sendControl("request_reframe")}>Reframe</button>
              <button onClick={() => sendControl("set_guidance_mode", "assist")}>Assist</button>
              <button onClick={() => sendControl("set_guidance_mode", "auto")}>Auto</button>
              <button
                onClick={() => {
                  setSessionId(newId("sess"));
                  setTranscript([]);
                  setOverlayState(DEFAULT_STATE);
                }}
              >
                New Session ID
              </button>
              <div style={{ marginLeft: "auto", color: wsStatus === "ready" ? "green" : "#666" }}>
                <span className={wsStatus === "ready" ? "oa-status-ready" : "oa-subtle"}>WS:</span> <b>{wsStatus}</b>
              </div>
            </div>

            <div style={{ marginTop: 8, fontSize: 12 }} className="oa-subtle">
              Devices: {connectedDevices.map((d) => `${d.type}${d.name ? ` (${d.name})` : ""}`).join(", ") || "none"}
            </div>
            {lastCorrection ? (
              <div className="oa-correction">
                <b>Coach correction:</b> {lastCorrection}
              </div>
            ) : null}

            <h3 style={{ marginTop: 14 }}>Inject transcript_final</h3>
            <textarea
              style={{ width: "100%", height: 90 }}
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              placeholder="Type a transcript_final block..."
            />
            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
              <button onClick={() => sendTranscript()}>Send transcript_final</button>
              <button onClick={() => sendLearning("helpful")}>Mark helpful</button>
              <button onClick={() => sendLearning("ignored")}>Mark ignored</button>
            </div>

            <h3 style={{ marginTop: 14 }}>Transcript stream</h3>
            <div style={{ fontSize: 13, color: "#333", whiteSpace: "pre-wrap" }}>
              {transcript.length ? transcript.join("\n") : <span className="oa-subtle">No transcript yet.</span>}
            </div>

            <SetupPanel tenantId={tenantId} sessionId={sessionId} />
          </div>

          <div className="oa-card">
            <h3>Overlay preview</h3>
            <div style={{ fontSize: 12, marginBottom: 6 }} className="oa-subtle">
              UI state: guidance.items = {overlayState.guidance.items.length} • text = {String((overlayState as any).text ?? "").slice(0, 60)}
            </div>

            <OverlayPreview
              state={overlayState}
              onShown={onShown}
              onApply={onApply}
              onDismiss={onDismiss}
              onMuteToggle={onMuteToggle}
            />
          </div>
        </div>
      )}
    </div>
  );
}
