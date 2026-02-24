import React, { useEffect, useMemo, useRef, useState } from "react";
import type { WsServerMessageV1, GuidanceControls } from "@overlay-assistant/shared";

const SERVER_PORT = (import.meta as any).env?.VITE_SERVER_PORT || "8081";
const API_BASE = `http://${window.location.hostname}:${SERVER_PORT}`;
const WS_URL = `ws://${window.location.hostname}:${SERVER_PORT}/ws`;

function newId(prefix: string) {
  return `${prefix}_${Math.random().toString(16).slice(2)}_${Date.now()}`;
}

const DEFAULT_CONTROLS: GuidanceControls = {
  guidanceMode: "assist",
  guidanceMuted: false,
  aiDepth: "P0",
  showLowConfidence: false
};

export function App() {
  const apiKey = (import.meta as any).env?.VITE_OVERLAY_API_KEY as string | undefined;
  const [tenantId, setTenantId] = useState("tenant_demo");
  const [repId, setRepId] = useState("rep_demo");
  const [sessionId, setSessionId] = useState(newId("sess"));
  const [wsStatus, setWsStatus] = useState<"disconnected" | "connecting" | "ready">("disconnected");
  const [ws, setWs] = useState<WebSocket | null>(null);
  const [controls, setControls] = useState<GuidanceControls>(DEFAULT_CONTROLS);
  const [connectedDevices, setConnectedDevices] = useState<Array<{ id: string; type: string; name?: string }>>([]);
  const [latestLine, setLatestLine] = useState("");
  const [latestCorrection, setLatestCorrection] = useState("");
  const [bluetoothStatus, setBluetoothStatus] = useState("not connected");
  const [inputs, setInputs] = useState<MediaDeviceInfo[]>([]);
  const [inputDeviceId, setInputDeviceId] = useState("");
  const [audioRunning, setAudioRunning] = useState(false);
  const [preferBluetooth, setPreferBluetooth] = useState(true);
  const [audioEnergy, setAudioEnergy] = useState(0);
  const [livePartial, setLivePartial] = useState("");
  const [liveFinal, setLiveFinal] = useState("");
  const [audioError, setAudioError] = useState("");
  const [transcriptLines, setTranscriptLines] = useState<Array<{ at: string; text: string }>>([]);
  const [complianceAlerts, setComplianceAlerts] = useState<Array<{ at: string; type: string; severity: string; phrase: string }>>([]);
  const [momentTimeline, setMomentTimeline] = useState<Array<{ at: string; moments: string[]; objections: string[]; riskCount: number }>>([]);

  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const timerRef = useRef<number | null>(null);
  const speechRef = useRef<any>(null);
  const seenEventIdsRef = useRef<Set<number>>(new Set());
  const [timelineCursor, setTimelineCursor] = useState(0);

  const applyTimelineEvent = (event: {
    id: number;
    createdAt: string;
    source: string;
    textExcerpt: string;
    entities: Array<{ type: string; value: string; confidence?: number }>;
    moments: string[];
    objections: string[];
    complianceRisks: Array<{ type: string; severity: string; phrase: string }>;
    confidence: number;
  }) => {
    const id = Number(event.id || 0);
    if (id && seenEventIdsRef.current.has(id)) return;
    if (id) seenEventIdsRef.current.add(id);

    const at = event.createdAt || new Date().toISOString();
    if (event.textExcerpt && event.textExcerpt.trim()) {
      setTranscriptLines((prev) => [{ at, text: event.textExcerpt.trim() }, ...prev].slice(0, 60));
    }

    setMomentTimeline((prev) => [{ at, moments: event.moments || [], objections: event.objections || [], riskCount: Array.isArray(event.complianceRisks) ? event.complianceRisks.length : 0 }, ...prev].slice(0, 60));

    if (Array.isArray(event.complianceRisks) && event.complianceRisks.length) {
      const alerts = event.complianceRisks.map((r) => ({
        at,
        type: String(r?.type ?? "unknown"),
        severity: String(r?.severity ?? "medium"),
        phrase: String(r?.phrase ?? "")
      }));
      setComplianceAlerts((prev) => [...alerts, ...prev].slice(0, 60));
    }

    if (id > timelineCursor) setTimelineCursor(id);
  };

  const syncTimeline = async (forceHydrate = false) => {
    const sinceId = !forceHydrate && timelineCursor > 0 ? timelineCursor : 0;
    const res = await fetch(
      `${API_BASE}/api/conversation/timeline?tenantId=${encodeURIComponent(tenantId)}&sessionId=${encodeURIComponent(sessionId)}&limit=60${sinceId ? `&sinceId=${sinceId}` : ""}`,
      { headers: apiKey ? { "x-overlay-key": apiKey } : {} }
    );
    const json = await res.json().catch(() => ({}));
    const items = Array.isArray(json?.items) ? json.items : [];

    if (forceHydrate || sinceId === 0) {
      seenEventIdsRef.current = new Set(items.map((x: any) => Number(x?.id || 0)).filter((x: number) => x > 0));
      setTranscriptLines(
        items
          .filter((x: any) => typeof x?.textExcerpt === "string" && x.textExcerpt.trim().length > 0)
          .map((x: any) => ({ at: String(x.createdAt || new Date().toISOString()), text: String(x.textExcerpt) }))
      );
      setMomentTimeline(
        items.map((x: any) => ({
          at: String(x.createdAt || new Date().toISOString()),
          moments: Array.isArray(x.moments) ? x.moments.map((m: unknown) => String(m)) : [],
          objections: Array.isArray(x.objections) ? x.objections.map((m: unknown) => String(m)) : [],
          riskCount: Array.isArray(x.complianceRisks) ? x.complianceRisks.length : 0
        }))
      );
      const alerts = items.flatMap((x: any) => {
        const risks = Array.isArray(x.complianceRisks) ? x.complianceRisks : [];
        return risks.map((r: any) => ({
          at: String(x.createdAt || new Date().toISOString()),
          type: String(r?.type ?? "unknown"),
          severity: String(r?.severity ?? "medium"),
          phrase: String(r?.phrase ?? "")
        }));
      });
      setComplianceAlerts(alerts.slice(0, 60));
    } else {
      for (const item of items) applyTimelineEvent(item);
    }

    const nextSinceId = Number(json?.nextSinceId ?? 0);
    if (nextSinceId > timelineCursor) setTimelineCursor(nextSinceId);
  };

  const wsUrl = WS_URL;

  const isBluetoothInput = (label: string) => /bluetooth|airpods|buds|headset|earbuds|hands-free/i.test(label || "");

  const sendAudioFrame = async (frameEnergy: number, partial?: string, final?: string) => {
    const res = await fetch(`${API_BASE}/api/live/audio_frame`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(apiKey ? { "x-overlay-key": apiKey } : {}) },
      body: JSON.stringify({
        tenantId,
        repId,
        sessionId,
        frameEnergy,
        partialText: partial || undefined,
        finalText: final || undefined,
        language: "en-US"
      })
    });

    const json = await res.json().catch(() => ({}));
    if (final && final.trim()) {
      const at = new Date().toISOString();
      setTranscriptLines((prev) => [{ at, text: final.trim() }, ...prev].slice(0, 40));

      const entities = Array.isArray(json?.intelligence?.entities) ? json.intelligence.entities : [];
      const moments = Array.isArray(json?.intelligence?.moments) ? json.intelligence.moments.map((m: unknown) => String(m)) : [];
      const objections = entities.filter((e: any) => e?.type === "objection_type").map((e: any) => String(e.value));
      const risks = Array.isArray(json?.intelligence?.complianceRisks) ? json.intelligence.complianceRisks : [];

      setMomentTimeline((prev) => [{ at, moments, objections, riskCount: risks.length }, ...prev].slice(0, 40));

      if (risks.length) {
        const alerts = risks.map((r: any) => ({
          at,
          type: String(r?.type ?? "unknown"),
          severity: String(r?.severity ?? "medium"),
          phrase: String(r?.phrase ?? "")
        }));
        setComplianceAlerts((prev) => [...alerts, ...prev].slice(0, 40));
      }

      syncTimeline().catch(() => undefined);
    }
  };

  const sendControl = (action: string, value?: string | number | boolean | null) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(
      JSON.stringify({
        type: "control",
        action,
        value: value ?? null,
        source: "mobile",
        session_id: sessionId,
        at: new Date().toISOString()
      })
    );
  };

  const sendLearning = (outcome: "helpful" | "unhelpful" | "ignored") => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(
      JSON.stringify({
        type: "learning_signal",
        source: "mobile",
        outcome,
        session_id: sessionId,
        at: new Date().toISOString()
      })
    );
  };

  const connect = () => {
    setWsStatus("connecting");
    const next = new WebSocket(wsUrl);

    next.onopen = () => {
      next.send(
        JSON.stringify({
          type: "start",
          session_id: sessionId,
          tenantId,
          repId,
          apiKey,
          deviceType: "mobile",
          clientName: "mobile-coach",
          role: "controller"
        })
      );
    };

    next.onmessage = (ev) => {
      const msg = JSON.parse(ev.data) as WsServerMessageV1;
      if (msg.type === "ready") setWsStatus("ready");

      if (msg.type === "overlay_message" && msg.message.type === "patch") {
        const line = (msg.message.patch as any)?.text;
        if (typeof line === "string") setLatestLine(line);
      }

      if (msg.type === "overlay_message" && msg.message.type === "settings") {
        const nextControls = (msg.message as any)?.settings?.controls;
        if (nextControls) setControls(nextControls);
      }

      if (msg.type === "session_state") {
        setControls(msg.state.controls);
        setConnectedDevices(msg.state.connectedDevices);
      }

      if (msg.type === "correction") {
        setLatestCorrection(msg.correction.note);
        return;
      }

      if (msg.type === "timeline_event") {
        applyTimelineEvent({ ...(msg.event as any), createdAt: (msg.event as any)?.createdAt || msg.at || new Date().toISOString() });

        return;
      }
    };

    next.onclose = () => {
      setWsStatus("disconnected");
      setWs(null);
    };

    setWs(next);
  };

  const connectBluetooth = async () => {
    const hasBluetooth = typeof navigator !== "undefined" && "bluetooth" in navigator;
    if (!hasBluetooth) {
      setBluetoothStatus("not available in this browser");
      return;
    }

    try {
      setBluetoothStatus("requesting device...");
      const device = await (navigator as any).bluetooth.requestDevice({
        acceptAllDevices: true,
        optionalServices: ["battery_service"]
      });
      setBluetoothStatus(`connected: ${device.name || "unnamed"}`);
    } catch {
      setBluetoothStatus("pairing cancelled");
    }
  };

  const refreshInputs = async () => {
    try {
      const pre = await navigator.mediaDevices.getUserMedia({ audio: true });
      pre.getTracks().forEach((t) => t.stop());
    } catch {
      // ignore
    }
    const list = await navigator.mediaDevices.enumerateDevices();
    const audioInputs = list.filter((d) => d.kind === "audioinput");
    setInputs(audioInputs);
    const bt = audioInputs.find((d) => isBluetoothInput(d.label));
    setInputDeviceId((prev) => prev || bt?.deviceId || audioInputs[0]?.deviceId || "");
  };

  const stopAudioBridge = () => {
    if (timerRef.current) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    try {
      if (speechRef.current) speechRef.current.stop();
    } catch {
      // ignore
    }
    speechRef.current = null;

    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;

    if (audioCtxRef.current) {
      audioCtxRef.current.close().catch(() => undefined);
      audioCtxRef.current = null;
    }
    analyserRef.current = null;
    setAudioRunning(false);
  };

  const startAudioBridge = async () => {
    setAudioError("");
    const selected = inputs.find((d) => d.deviceId === inputDeviceId);
    if (preferBluetooth && selected && !isBluetoothInput(selected.label)) {
      setAudioError("Bluetooth-first mode requires a Bluetooth audio input device.");
      return;
    }

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: inputDeviceId ? { deviceId: { exact: inputDeviceId } } : true
    });
    streamRef.current = stream;

    const audioCtx = new AudioContext();
    audioCtxRef.current = audioCtx;
    const source = audioCtx.createMediaStreamSource(stream);
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 1024;
    analyserRef.current = analyser;
    source.connect(analyser);

    timerRef.current = window.setInterval(() => {
      const a = analyserRef.current;
      if (!a) return;
      const arr = new Uint8Array(a.fftSize);
      a.getByteTimeDomainData(arr);
      let sum = 0;
      for (let i = 0; i < arr.length; i++) {
        const n = (arr[i] - 128) / 128;
        sum += n * n;
      }
      const rms = Math.sqrt(sum / arr.length);
      const normalized = Math.max(0, Math.min(1, rms * 4.8));
      setAudioEnergy(normalized);
      sendAudioFrame(normalized, livePartial || undefined, undefined).catch(() => undefined);
    }, 500);

    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (SpeechRecognition) {
      const rec = new SpeechRecognition();
      rec.lang = "en-US";
      rec.interimResults = true;
      rec.continuous = true;
      rec.onresult = (event: any) => {
        let interim = "";
        let finalOut = "";
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const transcript = String(event.results[i][0]?.transcript || "").trim();
          if (!transcript) continue;
          if (event.results[i].isFinal) finalOut += `${transcript} `;
          else interim += `${transcript} `;
        }
        const p = interim.trim();
        const f = finalOut.trim();
        setLivePartial(p);
        if (f) {
          setLiveFinal(f);
          sendAudioFrame(audioEnergy, p || undefined, f).catch(() => undefined);
        }
      };
      rec.onerror = () => setAudioError("Speech recognition error; VAD streaming still active.");
      rec.start();
      speechRef.current = rec;
    } else {
      setAudioError("Speech recognition unavailable; use Bluetooth mic with manual transcript if needed.");
    }

    setAudioRunning(true);
  };

  useEffect(() => {
    refreshInputs().catch(() => undefined);
    setTimelineCursor(0);
    seenEventIdsRef.current = new Set();
    syncTimeline(true).catch(() => undefined);
    return () => stopAudioBridge();
  }, [tenantId, sessionId]);

  useEffect(() => {
    const t = window.setInterval(() => {
      syncTimeline().catch(() => undefined);
    }, audioRunning ? 2000 : 5000);
    return () => window.clearInterval(t);
  }, [audioRunning, tenantId, sessionId, timelineCursor]);

  return (
    <div className="om-shell">
      <h2 style={{ marginTop: 0 }}>Mobile Live Coach</h2>
      <div className="om-subtle" style={{ fontSize: 12, marginBottom: 10 }}>Session controller for phone use, paired with desktop overlay.</div>

      <div className="om-card om-grid">
        <label>Tenant</label>
        <input value={tenantId} onChange={(e) => setTenantId(e.target.value)} />
        <label>Rep</label>
        <input value={repId} onChange={(e) => setRepId(e.target.value)} />
        <label>Session</label>
        <input value={sessionId} onChange={(e) => setSessionId(e.target.value)} />
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 10, alignItems: "center" }}>
        <button onClick={connect}>Join session</button>
        <button onClick={connectBluetooth}>Pair Bluetooth</button>
        <div style={{ marginLeft: "auto", fontSize: 12 }}>WS: <b>{wsStatus}</b></div>
      </div>

      <div className="om-card">
        <div style={{ fontWeight: 700, marginBottom: 8 }}>Quick controls</div>
        <div className="om-controls">
          <button onClick={() => sendControl("toggle_mute")}>{controls.guidanceMuted ? "Unmute" : "Mute"}</button>
          <button onClick={() => sendControl("request_reframe")}>Reframe now</button>
          <button onClick={() => sendControl("set_guidance_mode", "assist")}>Assist mode</button>
          <button onClick={() => sendControl("set_guidance_mode", "auto")}>Auto mode</button>
          <button onClick={() => sendControl("set_ai_depth", "P1")}>Depth P1</button>
          <button onClick={() => sendControl("set_ai_depth", "P2")}>Depth P2</button>
        </div>
      </div>

      <div className="om-card">
        <div style={{ fontWeight: 700, marginBottom: 8 }}>Coach quality feedback</div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => sendLearning("helpful")}>Helpful</button>
          <button onClick={() => sendLearning("unhelpful")}>Unhelpful</button>
          <button onClick={() => sendLearning("ignored")}>Ignored</button>
        </div>
      </div>

      <div className="om-card">
        <div style={{ fontWeight: 700 }}>Live status</div>
        <div style={{ fontSize: 13, marginTop: 6 }}>Bluetooth: {bluetoothStatus}</div>
        <div style={{ fontSize: 13, marginTop: 6 }}>Devices: {connectedDevices.map((d) => `${d.type}${d.name ? `(${d.name})` : ""}`).join(", ") || "none"}</div>
        <div style={{ fontSize: 13, marginTop: 6 }}><b>Current line:</b> {latestLine || "—"}</div>
        <div style={{ fontSize: 13, marginTop: 6 }}><b>Last correction:</b> {latestCorrection || "—"}</div>
      </div>

      <div className="om-card">
        <div style={{ fontWeight: 700, marginBottom: 8 }}>Bluetooth Transcription Bridge</div>
        <div className="om-grid" style={{ marginBottom: 8 }}>
          <label>Audio input</label>
          <select value={inputDeviceId} onChange={(e) => setInputDeviceId(e.target.value)}>
            {inputs.map((d) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label || `Input ${d.deviceId.slice(0, 6)}`}{isBluetoothInput(d.label) ? " • Bluetooth" : ""}
              </option>
            ))}
          </select>
          <label>Bluetooth-first</label>
          <label>
            <input type="checkbox" checked={preferBluetooth} onChange={(e) => setPreferBluetooth(e.target.checked)} />
            &nbsp;Require Bluetooth input
          </label>
        </div>

        <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
          {!audioRunning ? <button onClick={() => startAudioBridge()}>Start audio bridge</button> : <button onClick={() => stopAudioBridge()}>Stop audio bridge</button>}
          <button onClick={() => refreshInputs()}>Refresh inputs</button>
        </div>

        <div style={{ fontSize: 13 }}>
          <div><b>VAD energy:</b> {(audioEnergy * 100).toFixed(0)}%</div>
          <div><b>Partial STT:</b> {livePartial || "—"}</div>
          <div><b>Final STT:</b> {liveFinal || "—"}</div>
        </div>

        {audioError ? <div style={{ marginTop: 8, color: "#ffc7ce", fontSize: 13 }}>{audioError}</div> : null}
      </div>

      <div className="om-card">
        <div style={{ fontWeight: 700, marginBottom: 8 }}>Transcript (real-time)</div>
        <div style={{ maxHeight: 170, overflow: "auto", fontSize: 12, lineHeight: 1.4 }}>
          {transcriptLines.length === 0 ? (
            <div className="om-subtle">No final transcript lines yet.</div>
          ) : (
            transcriptLines.map((line, idx) => (
              <div key={`${line.at}_${idx}`} style={{ marginBottom: 6 }}>
                <div className="om-subtle" style={{ fontSize: 11 }}>{new Date(line.at).toLocaleTimeString()}</div>
                <div>{line.text}</div>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="om-card">
        <div style={{ fontWeight: 700, marginBottom: 8 }}>Compliance alerts</div>
        <div style={{ maxHeight: 150, overflow: "auto", fontSize: 12, lineHeight: 1.4 }}>
          {complianceAlerts.length === 0 ? (
            <div className="om-subtle">No compliance alerts detected.</div>
          ) : (
            complianceAlerts.map((alert, idx) => (
              <div key={`${alert.at}_${idx}`} style={{ marginBottom: 6, borderLeft: "3px solid #ffc7ce", paddingLeft: 6 }}>
                <div><b>{alert.type}</b> • {alert.severity}</div>
                <div>{alert.phrase || "(pattern detected)"}</div>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="om-card">
        <div style={{ fontWeight: 700, marginBottom: 8 }}>Objection + moment timeline</div>
        <div style={{ maxHeight: 150, overflow: "auto", fontSize: 12, lineHeight: 1.4 }}>
          {momentTimeline.length === 0 ? (
            <div className="om-subtle">No timeline events yet.</div>
          ) : (
            momentTimeline.map((item, idx) => (
              <div key={`${item.at}_${idx}`} style={{ marginBottom: 6 }}>
                <div className="om-subtle" style={{ fontSize: 11 }}>{new Date(item.at).toLocaleTimeString()}</div>
                <div>moments: {item.moments.join(", ") || "neutral"}</div>
                <div>objections: {item.objections.join(", ") || "none"} • risks: {item.riskCount}</div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
