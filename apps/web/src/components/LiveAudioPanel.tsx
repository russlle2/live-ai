import React, { useEffect, useRef, useState } from "react";
import { API_BASE, API_KEY, apiHeaders } from "../lib/config";

function isBluetoothLabel(label: string): boolean {
  return /bluetooth|airpods|buds|headset|earbuds|hands-free/i.test(label || "");
}

/** Speaker role for diarization */
type SpeakerRole = "rep" | "customer" | "unknown";

/** Speaker detection mode */
type SpeakerMode = "auto" | "rep" | "customer";

const SPEAKER_COLORS: Record<SpeakerRole, string> = {
  rep: "#60a5fa",       // blue
  customer: "#fbbf24",  // amber
  unknown: "#9db2ce",   // grey
};

const SPEAKER_LABELS: Record<SpeakerRole, string> = {
  rep: "You (Rep)",
  customer: "Customer",
  unknown: "Speaker",
};

export function LiveAudioPanel(props: {
  tenantId: string;
  repId: string;
  sessionId: string;
  onAudioStateChange?: (running: boolean) => void;
  timelinePush?: {
    at: string;
    event: {
      id: number;
      createdAt?: string;
      source: string;
      textExcerpt: string;
      entities: Array<{ type: string; value: string; confidence?: number }>;
      moments: string[];
      objections: string[];
      complianceRisks: Array<{ type: string; severity: string; phrase: string }>;
      confidence: number;
    };
  } | null;
  /** Speaker turn data from WS */
  speakerTurn?: {
    speaker: SpeakerRole;
    text: string;
    confidence: number;
    isNewTurn: boolean;
    talkRatio: { rep: number; customer: number };
    coachingContext: { customerIntent?: string; repAssessment?: string };
  } | null;
  /** When true, show only a compact start/stop bar (for Simple Mode) */
  compact?: boolean;
}) {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState("");
  const [preferBluetooth, setPreferBluetooth] = useState(true);
  const [running, setRunning] = useState(false);
  const [energy, setEnergy] = useState(0);
  const [partialText, setPartialText] = useState("");
  const [finalText, setFinalText] = useState("");
  const [manualText, setManualText] = useState("");
  const [intelSummary, setIntelSummary] = useState<string>("");
  const [error, setError] = useState("");
  const [transcriptLines, setTranscriptLines] = useState<Array<{ at: string; text: string; speaker: SpeakerRole }>>([]);
  const [complianceAlerts, setComplianceAlerts] = useState<Array<{ at: string; type: string; severity: string; phrase: string }>>([]);
  const [momentTimeline, setMomentTimeline] = useState<Array<{ at: string; moments: string[]; objections: string[]; riskCount: number }>>([]);
  /** Speaker detection mode: auto (AI decides), or manual override */
  const [speakerMode, setSpeakerMode] = useState<SpeakerMode>("auto");
  /** Current active speaker indicator */
  const [activeSpeaker, setActiveSpeaker] = useState<SpeakerRole>("unknown");
  /** Talk ratio from server */
  const [talkRatio, setTalkRatio] = useState<{ rep: number; customer: number }>({ rep: 50, customer: 50 });

  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const timerRef = useRef<number | null>(null);
  const speechRef = useRef<any>(null);
  const runningRef = useRef(false);
  const partialTextRef = useRef("");
  const restartCountRef = useRef(0);
  const seenEventIdsRef = useRef<Set<number>>(new Set());
  const [timelineCursor, setTimelineCursor] = useState(0);

  const applyTimelineEvent = (event: {
    id: number;
    createdAt?: string;
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
      setTranscriptLines((prev) => [{ at, text: event.textExcerpt.trim(), speaker: "unknown" as SpeakerRole }, ...prev].slice(0, 60));
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

    const entityCount = Array.isArray(event.entities) ? event.entities.length : 0;
    const momentText = Array.isArray(event.moments) && event.moments.length ? event.moments.join(", ") : "none";
    const riskCount = Array.isArray(event.complianceRisks) ? event.complianceRisks.length : 0;
    setIntelSummary(`entities ${entityCount} • moments ${momentText} • compliance risks ${riskCount}`);
    if (id > timelineCursor) setTimelineCursor(id);
  };

  const syncTimeline = async (forceHydrate = false) => {
    const sinceId = !forceHydrate && timelineCursor > 0 ? timelineCursor : 0;
    const res = await fetch(
      `${API_BASE}/api/conversation/timeline?tenantId=${encodeURIComponent(props.tenantId)}&sessionId=${encodeURIComponent(props.sessionId)}&limit=60${sinceId ? `&sinceId=${sinceId}` : ""}`,
      { headers: apiHeaders() }
    );
    const json = await res.json().catch(() => ({}));
    const items = Array.isArray(json?.items) ? json.items : [];

    if (forceHydrate || sinceId === 0) {
      seenEventIdsRef.current = new Set(items.map((x: any) => Number(x?.id || 0)).filter((x: number) => x > 0));
      setTranscriptLines(
        items
          .filter((x: any) => typeof x?.textExcerpt === "string" && x.textExcerpt.trim().length > 0)
          .map((x: any) => ({ at: String(x.createdAt || new Date().toISOString()), text: String(x.textExcerpt), speaker: "unknown" as SpeakerRole }))
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
      for (const item of items) {
        applyTimelineEvent(item);
      }
    }

    const nextSinceId = Number(json?.nextSinceId ?? 0);
    if (nextSinceId > timelineCursor) setTimelineCursor(nextSinceId);
  };

  const sendFrame = async (frameEnergy: number, partial?: string, final?: string) => {
    const explicitSpeaker = speakerMode !== "auto" ? speakerMode : undefined;
    const payload: Record<string, unknown> = {
      tenantId: props.tenantId,
      repId: props.repId,
      sessionId: props.sessionId,
      frameEnergy: Math.max(0, Math.min(1, frameEnergy)),
      partialText: partial || undefined,
      finalText: final || undefined,
      language: "en-US",
      speaker: explicitSpeaker,
      deviceRole: "host",
      deviceType: /Mobi|Android|iPhone/i.test(navigator.userAgent) ? "mobile" : "desktop",
      // Send the audio input device ID so the server can distinguish audio streams
      audioSourceId: selectedDeviceId || undefined,
    };

    const res = await fetch(`${API_BASE}/api/live/audio_frame`, {
      method: "POST",
      headers: apiHeaders(),
      body: JSON.stringify(payload)
    });
    const json = await res.json().catch(() => ({}));
    const risks = Array.isArray(json?.intelligence?.complianceRisks) ? json.intelligence.complianceRisks.length : 0;
    const entities = Array.isArray(json?.intelligence?.entities) ? json.intelligence.entities : [];
    const ents = entities.length;
    const momentsArr = Array.isArray(json?.intelligence?.moments) ? json.intelligence.moments.map((m: unknown) => String(m)) : [];
    const moments = momentsArr.length ? momentsArr.join(", ") : "none";
    setIntelSummary(`entities ${ents} • moments ${moments} • compliance risks ${risks}`);

    if (final && final.trim()) {
      const at = new Date().toISOString();
      // Speaker inference: use explicit mode, or fall back to "unknown" (server will diarize)
      const lineSpeaker: SpeakerRole = speakerMode !== "auto" ? speakerMode : "unknown";
      setTranscriptLines((prev) => [{ at, text: final.trim(), speaker: lineSpeaker }, ...prev].slice(0, 40));

      const objections = entities
        .filter((e: any) => e && e.type === "objection_type")
        .map((e: any) => String(e.value));

      setMomentTimeline((prev) => [{ at, moments: momentsArr, objections, riskCount: risks }, ...prev].slice(0, 40));

      const risksList = Array.isArray(json?.intelligence?.complianceRisks) ? json.intelligence.complianceRisks : [];
      if (risksList.length) {
        const alertItems = risksList.map((r: any) => ({
          at,
          type: String(r?.type ?? "unknown"),
          severity: String(r?.severity ?? "medium"),
          phrase: String(r?.phrase ?? "")
        }));
        setComplianceAlerts((prev) => [...alertItems, ...prev].slice(0, 40));
      }

      syncTimeline().catch(() => undefined);
    }
  };

  const stop = () => {
    runningRef.current = false;
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
    setRunning(false);
    props.onAudioStateChange?.(false);
  };

  const start = async () => {
    setError("");
    const selected = devices.find((d) => d.deviceId === selectedDeviceId) || null;
    if (preferBluetooth && selected && !isBluetoothLabel(selected.label)) {
      setError("Bluetooth-first mode is enabled; choose a Bluetooth input device.");
      return;
    }

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: selectedDeviceId ? { deviceId: { exact: selectedDeviceId } } : true
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
      setEnergy(normalized);
      // Use ref to avoid stale closure
      const pt = partialTextRef.current || undefined;
      sendFrame(normalized, pt, undefined).catch(() => undefined);
    }, 500);

    // CRITICAL: set runningRef BEFORE anything that could trigger onend
    runningRef.current = true;
    setRunning(true);
    restartCountRef.current = 0;

    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (SpeechRecognition) {
      const startRecognition = () => {
        const rec = new SpeechRecognition();
        rec.lang = "en-US";
        rec.interimResults = true;
        rec.continuous = true;
        rec.maxAlternatives = 1;
        rec.onresult = (event: any) => {
          try {
          restartCountRef.current = 0; // successful result resets counter
          let interim = "";
          let finalOut = "";
          for (let i = event.resultIndex; i < event.results.length; i++) {
            const transcript = String(event.results[i]?.[0]?.transcript || "").trim();
            if (!transcript) continue;
            if (event.results[i].isFinal) finalOut += `${transcript} `;
            else interim += `${transcript} `;
          }
          const p = interim.trim();
          const f = finalOut.trim();
          setPartialText(p);
          partialTextRef.current = p;
          if (f) {
            setFinalText(f);
            sendFrame(0.5, p || undefined, f).catch(() => undefined);
          }
          } catch (err) { console.error("[SpeechRecognition.onresult] error", err); }
        };
        rec.onerror = (ev: any) => {
          const code = ev?.error || "unknown";
          // These errors are recoverable — let onend handle restart
          if (code === "no-speech" || code === "aborted" || code === "network" || code === "audio-capture") {
            return; // onend will fire and handle restart
          }
          setError(`Speech recognition error (${code}). You can still use manual final lines.`);
        };
        // Auto-restart: Chrome often fires onend even with continuous=true
        rec.onend = () => {
          if (!runningRef.current) return;
          restartCountRef.current++;
          // Back off: 200ms, 500ms, 1s, 2s, cap at 3s
          const delay = Math.min(3000, 200 * Math.pow(1.5, Math.min(restartCountRef.current, 8)));
          setTimeout(() => {
            if (!runningRef.current) return;
            try {
              // Create a fresh recognition instance to avoid stale state
              const fresh = startRecognition();
              speechRef.current = fresh;
            } catch {
              // Last resort: try again in 1s
              setTimeout(() => {
                if (runningRef.current) {
                  try {
                    const retry = startRecognition();
                    speechRef.current = retry;
                  } catch { /* give up */ }
                }
              }, 1000);
            }
          }, delay);
        };
        try {
          rec.start();
        } catch {
          // If start fails immediately, retry once
          setTimeout(() => {
            try { rec.start(); } catch { /* ignore */ }
          }, 500);
        }
        return rec;
      };
      const initialRec = startRecognition();
      speechRef.current = initialRec;
    } else {
      setError("Browser speech recognition unavailable; using VAD + manual final lines.");
    }

    props.onAudioStateChange?.(true);
  };

  const refreshInputs = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
    } catch {
      // ignore
    }
    const all = await navigator.mediaDevices.enumerateDevices();
    const inputs = all.filter((d) => d.kind === "audioinput");
    setDevices(inputs);
    const bluetooth = inputs.find((d) => isBluetoothLabel(d.label));
    setSelectedDeviceId((prev) => prev || bluetooth?.deviceId || inputs[0]?.deviceId || "");
  };

  useEffect(() => {
    refreshInputs().catch(() => undefined);
    setTimelineCursor(0);
    seenEventIdsRef.current = new Set();
    syncTimeline(true).catch(() => undefined);
    return () => stop();
  }, [props.tenantId, props.sessionId]);

  useEffect(() => {
    const t = window.setInterval(() => {
      syncTimeline().catch(() => undefined);
    }, running ? 2000 : 5000);
    return () => window.clearInterval(t);
  }, [running, props.tenantId, props.sessionId, timelineCursor]);

  useEffect(() => {
    const pushed = props.timelinePush;
    if (!pushed?.event) return;
    const ev = pushed.event;
    applyTimelineEvent({ ...ev, createdAt: ev.createdAt || pushed.at || new Date().toISOString() } as any);
  }, [props.timelinePush]);

  // Update transcript with server-classified speaker data
  useEffect(() => {
    const turn = props.speakerTurn;
    if (!turn?.text) return;
    setActiveSpeaker(turn.speaker);
    setTalkRatio(turn.talkRatio);
    
    // Update the most recent transcript line with the server's speaker classification
    setTranscriptLines((prev) => {
      if (prev.length === 0) return prev;
      const first = prev[0];
      // If the text matches the most recent line, update its speaker
      if (first.text === turn.text.trim() || first.text.startsWith(turn.text.trim().slice(0, 30))) {
        return [{ ...first, speaker: turn.speaker }, ...prev.slice(1)];
      }
      // Otherwise add as new line
      return [{ at: new Date().toISOString(), text: turn.text, speaker: turn.speaker }, ...prev].slice(0, 60);
    });
  }, [props.speakerTurn]);

  // ─── Compact Mode (Simple Mode in parent) ─────────────────────────────────
  if (props.compact) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        {!running ? (
          <button
            onClick={() => start()}
            style={{
              padding: "10px 24px", fontSize: 16, fontWeight: 800,
              borderRadius: 10, border: "2px solid #4ade80",
              background: "rgba(74,222,128,0.12)", color: "#4ade80",
              cursor: "pointer", transition: "all 0.2s"
            }}
          >
            Start Audio
          </button>
        ) : (
          <button
            onClick={() => stop()}
            style={{
              padding: "10px 24px", fontSize: 16, fontWeight: 800,
              borderRadius: 10, border: "2px solid #ff6b7f",
              background: "rgba(255,107,127,0.12)", color: "#ff6b7f",
              cursor: "pointer", transition: "all 0.2s"
            }}
          >
            Stop Audio
          </button>
        )}
        {running && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
            <div style={{
              width: 10, height: 10, borderRadius: "50%",
              background: energy > 0.05 ? "#4ade80" : "#fbbf24",
              boxShadow: energy > 0.05 ? "0 0 8px #4ade80" : "none",
              animation: energy > 0.05 ? "pulse 1.5s infinite" : "none",
            }} />
            <span style={{ color: "#9db2ce" }}>
              {energy > 0.05 ? "Hearing speech..." : "Listening..."}
            </span>
            {activeSpeaker !== "unknown" && (
              <span style={{ fontWeight: 700, color: SPEAKER_COLORS[activeSpeaker] }}>
                {SPEAKER_LABELS[activeSpeaker]}
              </span>
            )}
          </div>
        )}
        {error && <span style={{ color: "#ff9ca8", fontSize: 12 }}>{error}</span>}
      </div>
    );
  }

  // ─── Full Mode ─────────────────────────────────────────────────────────────
  return (
    <div className="oa-card">
      <h3 style={{ marginTop: 0 }}>Live Audio (Bluetooth-first) + Speaker Detection</h3>
      <div className="oa-subtle" style={{ fontSize: 12, marginBottom: 8 }}>
        Streams VAD + STT frames with <b>speaker diarization</b> into coaching.
      </div>

      {/* ─── Speaker Mode Toggle ─── */}
      <div style={{ 
        display: "flex", gap: 6, marginBottom: 10, padding: "6px 8px",
        background: "rgba(96,165,250,0.06)", borderRadius: 8, alignItems: "center"
      }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: "#9db2ce", marginRight: 4 }}>SPEAKER:</span>
        {(["auto", "rep", "customer"] as SpeakerMode[]).map((mode) => (
          <button
            key={mode}
            onClick={() => setSpeakerMode(mode)}
            style={{
              padding: "3px 10px",
              fontSize: 11,
              fontWeight: speakerMode === mode ? 800 : 400,
              borderRadius: 6,
              border: speakerMode === mode ? "1.5px solid #60a5fa" : "1px solid #2b3a51",
              background: speakerMode === mode ? "rgba(96,165,250,0.15)" : "transparent",
              color: speakerMode === mode ? "#fff" : "#9db2ce",
              cursor: "pointer",
              transition: "all 0.2s"
            }}
          >
            {mode === "auto" ? "🤖 Auto-detect" : mode === "rep" ? "🎙️ I am Rep" : "👤 Customer"}
          </button>
        ))}
        {running && activeSpeaker !== "unknown" && (
          <span style={{ 
            marginLeft: "auto", fontSize: 11, display: "flex", alignItems: "center", gap: 4
          }}>
            <span style={{
              width: 8, height: 8, borderRadius: "50%",
              background: SPEAKER_COLORS[activeSpeaker],
              boxShadow: `0 0 6px ${SPEAKER_COLORS[activeSpeaker]}`,
              animation: "pulse 1.5s infinite",
              display: "inline-block"
            }} />
            <b style={{ color: SPEAKER_COLORS[activeSpeaker] }}>{SPEAKER_LABELS[activeSpeaker]}</b> speaking
          </span>
        )}
      </div>

      {/* ─── Talk Ratio Bar ─── */}
      {running && (
        <div style={{ marginBottom: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#9db2ce", marginBottom: 3 }}>
            <span>🎙️ Rep {talkRatio.rep}%</span>
            <span>👤 Customer {talkRatio.customer}%</span>
          </div>
          <div style={{ display: "flex", height: 6, borderRadius: 3, overflow: "hidden", background: "#1a2538" }}>
            <div style={{
              width: `${talkRatio.rep}%`, height: "100%",
              background: SPEAKER_COLORS.rep,
              transition: "width 0.5s ease"
            }} />
            <div style={{
              width: `${talkRatio.customer}%`, height: "100%",
              background: SPEAKER_COLORS.customer,
              transition: "width 0.5s ease"
            }} />
          </div>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "150px 1fr", gap: 8, alignItems: "center" }}>
        <label>Input device</label>
        <select value={selectedDeviceId} onChange={(e) => setSelectedDeviceId(e.target.value)}>
          {devices.map((d) => (
            <option key={d.deviceId} value={d.deviceId}>
              {d.label || `Input ${d.deviceId.slice(0, 6)}`}{isBluetoothLabel(d.label) ? " • Bluetooth" : ""}
            </option>
          ))}
        </select>

        <label>Prefer Bluetooth</label>
        <label>
          <input type="checkbox" checked={preferBluetooth} onChange={(e) => setPreferBluetooth(e.target.checked)} />
          &nbsp;Require Bluetooth input
        </label>
      </div>

      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        {!running ? <button onClick={() => start()}>Start live audio</button> : <button onClick={() => stop()}>Stop live audio</button>}
        <button onClick={() => refreshInputs()}>Refresh devices</button>
      </div>

      <div style={{ marginTop: 10, fontSize: 13 }}>
        <div>Energy: {(energy * 100).toFixed(0)}%</div>
        <div style={{ height: 8, borderRadius: 8, background: "#15253a", marginTop: 4 }}>
          <div style={{ width: `${Math.max(4, Math.min(100, energy * 100))}%`, height: "100%", borderRadius: 8, background: "#66d4ff" }} />
        </div>
      </div>

      <div style={{ marginTop: 10, fontSize: 13 }}>
        <div><b>Partial STT:</b> {partialText || "—"}</div>
        <div style={{ marginTop: 4 }}><b>Final STT:</b> {finalText || "—"}</div>
        <div style={{ marginTop: 4 }}><b>Intelligence:</b> {intelSummary || "—"}</div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 10 }}>
        <div style={{ border: "1px solid #2b3a51", borderRadius: 8, padding: 8, minHeight: 130 }}>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>Transcript (speaker-labeled)</div>
          <div style={{ maxHeight: 180, overflow: "auto", fontSize: 12, lineHeight: 1.4 }}>
            {transcriptLines.length === 0 ? (
              <div className="oa-subtle">No final transcript lines yet.</div>
            ) : (
              transcriptLines.map((line, idx) => (
                <div key={`${line.at}_${idx}`} style={{
                  marginBottom: 6,
                  borderLeft: `3px solid ${SPEAKER_COLORS[line.speaker] ?? SPEAKER_COLORS.unknown}`,
                  paddingLeft: 6
                }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{
                      fontSize: 10, fontWeight: 700,
                      color: SPEAKER_COLORS[line.speaker] ?? SPEAKER_COLORS.unknown,
                      textTransform: "uppercase"
                    }}>
                      {SPEAKER_LABELS[line.speaker] ?? "Speaker"}
                    </span>
                    <span className="oa-subtle" style={{ fontSize: 10 }}>{new Date(line.at).toLocaleTimeString()}</span>
                  </div>
                  <div>{line.text}</div>
                </div>
              ))
            )}
          </div>
        </div>

        <div style={{ border: "1px solid #2b3a51", borderRadius: 8, padding: 8, minHeight: 130 }}>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>Compliance alerts</div>
          <div style={{ maxHeight: 180, overflow: "auto", fontSize: 12, lineHeight: 1.4 }}>
            {complianceAlerts.length === 0 ? (
              <div className="oa-subtle">No compliance alerts detected.</div>
            ) : (
              complianceAlerts.map((alert, idx) => (
                <div key={`${alert.at}_${idx}`} style={{ marginBottom: 6, borderLeft: "3px solid #ff9ca8", paddingLeft: 6 }}>
                  <div><b>{alert.type}</b> • {alert.severity}</div>
                  <div>{alert.phrase || "(pattern detected)"}</div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      <div style={{ marginTop: 10, border: "1px solid #2b3a51", borderRadius: 8, padding: 8 }}>
        <div style={{ fontWeight: 700, marginBottom: 6 }}>Objection + moment timeline</div>
        <div style={{ maxHeight: 160, overflow: "auto", fontSize: 12, lineHeight: 1.4 }}>
          {momentTimeline.length === 0 ? (
            <div className="oa-subtle">No timeline events yet.</div>
          ) : (
            momentTimeline.map((item, idx) => (
              <div key={`${item.at}_${idx}`} style={{ marginBottom: 6 }}>
                <div className="oa-subtle" style={{ fontSize: 11 }}>{new Date(item.at).toLocaleTimeString()}</div>
                <div>moments: {item.moments.join(", ") || "neutral"}</div>
                <div>objections: {item.objections.join(", ") || "none"} • risks: {item.riskCount}</div>
              </div>
            ))
          )}
        </div>
      </div>

      <div style={{ marginTop: 10 }}>
        <div style={{ display: "flex", gap: 6, marginBottom: 4 }}>
          <span style={{ fontSize: 11, color: "#9db2ce" }}>Manual input as:</span>
          <button
            onClick={() => setSpeakerMode("rep")}
            style={{
              fontSize: 10, padding: "1px 8px", borderRadius: 4,
              background: speakerMode === "rep" ? "rgba(96,165,250,0.2)" : "transparent",
              border: "1px solid #2b3a51", color: SPEAKER_COLORS.rep, cursor: "pointer"
            }}
          >Rep</button>
          <button
            onClick={() => setSpeakerMode("customer")}
            style={{
              fontSize: 10, padding: "1px 8px", borderRadius: 4,
              background: speakerMode === "customer" ? "rgba(251,191,36,0.2)" : "transparent",
              border: "1px solid #2b3a51", color: SPEAKER_COLORS.customer, cursor: "pointer"
            }}
          >Customer</button>
        </div>
        <textarea
          style={{ width: "100%", height: 70 }}
          placeholder="Manual final line fallback (speaker attribution applies)"
          value={manualText}
          onChange={(e) => setManualText(e.target.value)}
        />
        <button
          style={{ marginTop: 8 }}
          onClick={() => {
            const f = manualText.trim();
            if (!f) return;
            setFinalText(f);
            sendFrame(energy, partialText || undefined, f).catch(() => undefined);
            setManualText("");
          }}
        >
          Send manual final line
        </button>
      </div>

      {error ? <div style={{ marginTop: 8, color: "#ff9ca8", fontSize: 13 }}>{error}</div> : null}
    </div>
  );
}
