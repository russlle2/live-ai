import React, { useMemo, useState } from "react";
import type { OverlayMessageV1, OverlayStateV1, WsServerMessageV1 } from "@overlay-assistant/shared";
import { sanitizePatch_v1 } from "@overlay-assistant/shared";
import { OverlayPreview } from "./components/OverlayPreview";
import { TrustDashboard } from "./components/TrustDashboard";
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
  const [tab, setTab] = useState<"demo" | "trust">("demo");
  const [tenantId, setTenantId] = useState("tenant_demo");
  const [repId, setRepId] = useState("rep_demo");
  const [sessionId, setSessionId] = useState(() => newId("sess"));
  const [wsStatus, setWsStatus] = useState<"disconnected" | "connecting" | "ready">("disconnected");
  const [transcript, setTranscript] = useState<string[]>([]);
  const [overlayState, setOverlayState] = useState<OverlayStateV1>(DEFAULT_STATE);
  const [inputText, setInputText] = useState("");

  const wsUrl = useMemo(() => {
    const host = window.location.hostname;
    return `ws://${host}:8080/ws`;
  }, []);

  const applyPatch = (patch: any) => {
    // v1 strict patch: { text?: string, settings?: {...} }
    setOverlayState((s: any) => {
      const next: any = { ...s };
      if (patch && typeof patch.text === "string") next.text = patch.text;
      if (patch && patch.settings && typeof patch.settings === "object") next.settings = { ...next.settings, ...patch.settings };
      return next;
    });
  };

  const handleOverlayMessage = async (m: OverlayMessageV1) => {
    if (m.type === "settings") {
      setOverlayState((s: any) => ({ ...s, settings: (m as any).settings }));
      return;
    }

    if (m.type === "patch") {
      // client-side sanitize again (defense-in-depth)
      const res = sanitizePatch_v1((m as any).patch);

      if (!res.ok) {
        await postUiEvent({
          tenantId,
          repId,
          sessionId,
          eventType: "patch_rejected",
          data: { reason: (res as any).reason, bytes: (res as any).bytes }
        });

        // Fallback for demo stability: allow simple {text:string} to render
        const raw = (m as any).patch;
        if (raw && typeof raw === "object" && typeof raw.text === "string") {
          applyPatch({ text: raw.text });
        }
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
    const ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: "start", session_id: sessionId, tenantId, repId }));
    };

    ws.onmessage = async (ev) => {
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
        // IMPORTANT: server wraps overlay messages inside this envelope
        handleOverlayMessage(msg.message as any);
        return;
      }
    };

    ws.onclose = () => setWsStatus("disconnected");
  };

  const sendTranscript = async () => {
    const text = inputText.trim();
    if (!text) return;
    setInputText("");
    await fetch("http://localhost:8080/api/demo/transcript_final", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: sessionId, text })
    });
  };

  const onShown = async (itemId: string) => {
    await postUiEvent({ tenantId, repId, sessionId, eventType: "suggestion_shown", data: { itemId } });
  };

  const onApply = async (itemId: string) => {
    await postUiEvent({ tenantId, repId, sessionId, eventType: "suggestion_applied", data: { itemId } });
  };

  const onDismiss = async (itemId: string) => {
    await postUiEvent({ tenantId, repId, sessionId, eventType: "suggestion_dismissed", data: { itemId } });
    setOverlayState((s) => ({ ...s, guidance: { ...s.guidance, items: s.guidance.items.filter((x) => x.id !== itemId) } }));
    // v1 strict: also clear text suggestion when dismissed
    setOverlayState((s: any) => ({ ...s, text: "" }));
  };

  const onMuteToggle = async () => {
    const muted = !overlayState.settings.controls.guidanceMuted;
    setOverlayState((s) => ({ ...s, settings: { ...s.settings, controls: { ...s.settings.controls, guidanceMuted: muted } } }));
    await postUiEvent({ tenantId, repId, sessionId, eventType: muted ? "mute_on" : "mute_off", data: {} });
  };

  return (
    <div style={{ fontFamily: "system-ui, sans-serif", padding: 16, maxWidth: 1100, margin: "0 auto" }}>
      <h2>Overlay Assistant (foundation demo)</h2>

      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <button onClick={() => setTab("demo")} disabled={tab === "demo"}>
          Demo
        </button>
        <button onClick={() => setTab("trust")} disabled={tab === "trust"}>
          Trust Dashboard
        </button>
      </div>

      {tab === "trust" ? (
        <TrustDashboard tenantId={tenantId} />
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div style={{ padding: 12, border: "1px solid #ddd", borderRadius: 8 }}>
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
                WS: <b>{wsStatus}</b>
              </div>
            </div>

            <h3 style={{ marginTop: 14 }}>Inject transcript_final</h3>
            <textarea
              style={{ width: "100%", height: 90 }}
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              placeholder="Type a transcript_final block..."
            />
            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
              <button onClick={() => sendTranscript()}>Send transcript_final</button>
            </div>

            <h3 style={{ marginTop: 14 }}>Transcript stream</h3>
            <div style={{ fontSize: 13, color: "#333", whiteSpace: "pre-wrap" }}>
              {transcript.length ? transcript.join("\n") : <span style={{ color: "#666" }}>No transcript yet.</span>}
            </div>
          </div>

          <div style={{ padding: 12, border: "1px solid #ddd", borderRadius: 8 }}>
            <h3>Overlay preview</h3>
            <OverlayPreview state={overlayState} onShown={onShown} onApply={onApply} onDismiss={onDismiss} onMuteToggle={onMuteToggle} />
          </div>
        </div>
      )}
    </div>
  );
}
