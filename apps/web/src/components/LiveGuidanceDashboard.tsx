import React, { useState, useEffect, useRef } from "react";

/** Dashboard snapshot pushed from server on every coaching cycle */
export type GuidanceDashboard = {
  timestamp: string;
  primary: { text: string; title: string; confidence: number; confidenceBand: string } | null;
  alternatives: Array<{ text: string; strategy: string }>;
  stage: string;
  momentum: { level: string; score: number };
  buyerSentiment: { tone: string; engagement: string; urgency: string };
  objectionsDetected: Array<{ key: string; score: number; suggestedResponse: string }>;
  talkingPoints: string[];
  riskAlerts: Array<{ type: string; message: string; severity: string }>;
  dealScore: number;
  nextMoves: string[];
  /** Speaker diarization data */
  speakerData?: {
    lastSpeaker: string;
    talkRatio: { rep: number; customer: number };
    repTurns: number;
    customerTurns: number;
    lastCustomerText: string;
    lastRepText: string;
    coachingContext: { customerIntent?: string; repAssessment?: string };
  };
};

const STAGE_COLORS: Record<string, string> = {
  discovery: "#60a5fa",
  evaluation: "#a78bfa",
  negotiation: "#fbbf24",
  closing: "#4ade80"
};

const STAGE_ICONS: Record<string, string> = {
  discovery: "🔍",
  evaluation: "⚖️",
  negotiation: "🤝",
  closing: "🎯"
};

function ConfidenceBar({ value, band }: { value: number; band: string }) {
  const pct = Math.max(4, Math.min(100, value * 100));
  const color = band === "high" ? "#4ade80" : band === "medium" ? "#fbbf24" : "#ff9ca8";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <div style={{ flex: 1, height: 6, background: "#1a2538", borderRadius: 3 }}>
        <div style={{ width: `${pct}%`, height: "100%", borderRadius: 3, background: color, transition: "width 0.4s ease" }} />
      </div>
      <span style={{ fontSize: 11, color, fontWeight: 700, minWidth: 36 }}>{Math.round(pct)}%</span>
    </div>
  );
}

function DealScoreGauge({ score }: { score: number }) {
  const color = score >= 70 ? "#4ade80" : score >= 45 ? "#fbbf24" : "#ff9ca8";
  const label = score >= 70 ? "Strong" : score >= 45 ? "Developing" : "Early";
  return (
    <div style={{ textAlign: "center" }}>
      <div style={{ fontSize: 36, fontWeight: 800, color, lineHeight: 1, transition: "color 0.3s" }}>{score}</div>
      <div style={{ fontSize: 11, color: "#9db2ce", marginTop: 2 }}>{label}</div>
    </div>
  );
}

function StagePipeline({ stage }: { stage: string }) {
  const stages = ["discovery", "evaluation", "negotiation", "closing"];
  const currentIdx = stages.indexOf(stage);
  return (
    <div style={{ display: "flex", gap: 0, width: "100%" }}>
      {stages.map((s, i) => {
        const active = i <= currentIdx;
        const current = s === stage;
        return (
          <div key={s} style={{
            flex: 1,
            textAlign: "center",
            padding: "6px 2px",
            fontSize: 11,
            fontWeight: current ? 800 : 400,
            color: active ? "#fff" : "#4b5e77",
            background: current ? (STAGE_COLORS[s] ?? "#60a5fa") : active ? "rgba(96,165,250,0.15)" : "transparent",
            borderRadius: i === 0 ? "6px 0 0 6px" : i === stages.length - 1 ? "0 6px 6px 0" : 0,
            borderRight: i < stages.length - 1 ? "1px solid #1a2538" : "none",
            transition: "all 0.3s ease"
          }}>
            {STAGE_ICONS[s]} {s.charAt(0).toUpperCase() + s.slice(1)}
          </div>
        );
      })}
    </div>
  );
}

function PulseIndicator({ level, label }: { level: string; label: string }) {
  const color = level === "high" ? "#4ade80" : level === "medium" ? "#fbbf24" : "#ff9ca8";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <div style={{
        width: 8, height: 8, borderRadius: "50%", background: color,
        boxShadow: level === "high" ? `0 0 8px ${color}` : "none",
        animation: level === "high" ? "pulse 1.5s infinite" : "none"
      }} />
      <span style={{ fontSize: 12 }}>{label}: <b style={{ color }}>{level}</b></span>
    </div>
  );
}

export function LiveGuidanceDashboard(props: {
  dashboard: GuidanceDashboard | null;
  onApplySuggestion?: (text: string) => void;
}) {
  const { dashboard } = props;
  const [expandedAlt, setExpandedAlt] = useState<number | null>(null);
  const primaryRef = useRef<HTMLDivElement>(null);
  const [flashPrimary, setFlashPrimary] = useState(false);

  // Flash effect when primary suggestion updates
  useEffect(() => {
    if (dashboard?.primary?.text) {
      setFlashPrimary(true);
      const t = setTimeout(() => setFlashPrimary(false), 600);
      return () => clearTimeout(t);
    }
  }, [dashboard?.primary?.text]);

  if (!dashboard) {
    return (
      <div className="oa-card" style={{ textAlign: "center", padding: 40 }}>
        <div style={{ fontSize: 24, marginBottom: 8 }}>🎯</div>
        <div style={{ color: "#9db2ce", fontSize: 14 }}>
          <b>Live AI Guidance</b> will appear here when the conversation begins.
        </div>
        <div style={{ color: "#4b5e77", fontSize: 12, marginTop: 8 }}>
          Start a session and speak — the AI analyzes both sides of the conversation in real-time.
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>

      {/* ─── TOP ROW: Stage + Deal Score + Momentum ─── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 10 }}>
        <div className="oa-card" style={{ padding: "8px 12px" }}>
          <StagePipeline stage={dashboard.stage} />
        </div>
        <div className="oa-card" style={{ padding: "8px 16px", minWidth: 90 }}>
          <DealScoreGauge score={dashboard.dealScore} />
        </div>
      </div>

      {/* ─── SPEAKER CONTEXT (who just said what) ─── */}
      {dashboard.speakerData && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          {/* Customer's last statement */}
          <div className="oa-card" style={{ padding: "8px 12px", borderLeft: "3px solid #fbbf24" }}>
            <div style={{ fontSize: 11, color: "#fbbf24", fontWeight: 700, marginBottom: 4, display: "flex", alignItems: "center", gap: 4 }}>
              <span style={{
                width: 8, height: 8, borderRadius: "50%", background: "#fbbf24",
                boxShadow: dashboard.speakerData.lastSpeaker === "customer" ? "0 0 6px #fbbf24" : "none",
                animation: dashboard.speakerData.lastSpeaker === "customer" ? "pulse 1.5s infinite" : "none",
              }} />
              CUSTOMER SAID
            </div>
            <div style={{ fontSize: 13, lineHeight: 1.4, color: "#cbd5e1", minHeight: 28 }}>
              {dashboard.speakerData.lastCustomerText
                ? `"${dashboard.speakerData.lastCustomerText.length > 120 ? dashboard.speakerData.lastCustomerText.slice(0, 120) + "..." : dashboard.speakerData.lastCustomerText}"`
                : <span style={{ color: "#4b5e77", fontStyle: "italic" }}>Waiting for customer to speak...</span>
              }
            </div>
            {dashboard.speakerData.coachingContext?.customerIntent && (
              <div style={{ fontSize: 10, color: "#9db2ce", marginTop: 4, textTransform: "uppercase", letterSpacing: "0.5px" }}>
                Intent: {dashboard.speakerData.coachingContext.customerIntent.replace(/_/g, " ")}
              </div>
            )}
          </div>

          {/* Rep's last statement */}
          <div className="oa-card" style={{ padding: "8px 12px", borderLeft: "3px solid #60a5fa" }}>
            <div style={{ fontSize: 11, color: "#60a5fa", fontWeight: 700, marginBottom: 4, display: "flex", alignItems: "center", gap: 4 }}>
              <span style={{
                width: 8, height: 8, borderRadius: "50%", background: "#60a5fa",
                boxShadow: dashboard.speakerData.lastSpeaker === "rep" ? "0 0 6px #60a5fa" : "none",
                animation: dashboard.speakerData.lastSpeaker === "rep" ? "pulse 1.5s infinite" : "none",
              }} />
              YOU SAID
            </div>
            <div style={{ fontSize: 13, lineHeight: 1.4, color: "#cbd5e1", minHeight: 28 }}>
              {dashboard.speakerData.lastRepText
                ? `"${dashboard.speakerData.lastRepText.length > 120 ? dashboard.speakerData.lastRepText.slice(0, 120) + "..." : dashboard.speakerData.lastRepText}"`
                : <span style={{ color: "#4b5e77", fontStyle: "italic" }}>Waiting for you to speak...</span>
              }
            </div>
            {dashboard.speakerData.coachingContext?.repAssessment && (
              <div style={{ fontSize: 10, color: "#9db2ce", marginTop: 4, textTransform: "uppercase", letterSpacing: "0.5px" }}>
                Assessment: {dashboard.speakerData.coachingContext.repAssessment.replace(/_/g, " ")}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ─── TALK RATIO BAR ─── */}
      {dashboard.speakerData && (dashboard.speakerData.repTurns > 0 || dashboard.speakerData.customerTurns > 0) && (
        <div className="oa-card" style={{ padding: "8px 12px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#9db2ce", marginBottom: 4 }}>
            <span style={{ color: "#60a5fa", fontWeight: 700 }}>🎙️ You ({dashboard.speakerData.talkRatio.rep}%) • {dashboard.speakerData.repTurns} turns</span>
            <span style={{ color: "#fbbf24", fontWeight: 700 }}>👤 Customer ({dashboard.speakerData.talkRatio.customer}%) • {dashboard.speakerData.customerTurns} turns</span>
          </div>
          <div style={{ display: "flex", height: 8, borderRadius: 4, overflow: "hidden", background: "#1a2538" }}>
            <div style={{
              width: `${dashboard.speakerData.talkRatio.rep}%`, height: "100%",
              background: dashboard.speakerData.talkRatio.rep > 65 ? "#ff9ca8" : "#60a5fa",
              transition: "width 0.5s ease, background 0.3s ease"
            }} />
            <div style={{
              width: `${dashboard.speakerData.talkRatio.customer}%`, height: "100%",
              background: "#fbbf24",
              transition: "width 0.5s ease"
            }} />
          </div>
          {dashboard.speakerData.talkRatio.rep > 65 && (
            <div style={{ fontSize: 10, color: "#ff9ca8", marginTop: 3, fontWeight: 600 }}>
              ⚠ You're talking too much — aim for 40-60% talk time. Ask an open-ended question.
            </div>
          )}
        </div>
      )}

      {/* ─── PRIMARY SUGGESTION (hero) ─── */}
      {dashboard.primary && (
        <div
          ref={primaryRef}
          className="oa-card"
          style={{
            borderLeft: `4px solid ${dashboard.primary.confidenceBand === "high" ? "#4ade80" : dashboard.primary.confidenceBand === "medium" ? "#fbbf24" : "#ff9ca8"}`,
            background: flashPrimary ? "rgba(96,165,250,0.08)" : undefined,
            transition: "background 0.5s ease"
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start" }}>
            <div>
              <div style={{ fontSize: 11, color: "#9db2ce", marginBottom: 2 }}>SAY THIS NOW</div>
              <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 2 }}>{dashboard.primary.title}</div>
            </div>
            <button
              className="oa-btn-sm"
              onClick={() => props.onApplySuggestion?.(dashboard.primary!.text)}
              style={{ whiteSpace: "nowrap" }}
            >
              Copy
            </button>
          </div>
          <div style={{ fontSize: 15, lineHeight: 1.5, marginTop: 6 }}>{dashboard.primary.text}</div>
          <div style={{ marginTop: 6 }}>
            <ConfidenceBar value={dashboard.primary.confidence} band={dashboard.primary.confidenceBand} />
          </div>
        </div>
      )}

      {/* ─── ALTERNATIVES ─── */}
      {dashboard.alternatives.length > 0 && (
        <div className="oa-card" style={{ padding: "8px 12px" }}>
          <div style={{ fontSize: 11, color: "#9db2ce", fontWeight: 700, marginBottom: 6 }}>ALTERNATIVE APPROACHES</div>
          {dashboard.alternatives.map((alt, i) => (
            <div
              key={i}
              style={{
                padding: "6px 8px",
                marginBottom: 4,
                borderRadius: 6,
                background: expandedAlt === i ? "rgba(96,165,250,0.1)" : "transparent",
                cursor: "pointer",
                transition: "background 0.2s"
              }}
              onClick={() => setExpandedAlt(expandedAlt === i ? null : i)}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontWeight: 600, fontSize: 13 }}>
                  {expandedAlt === i ? "▾" : "▸"} {alt.strategy}
                </span>
                {expandedAlt === i && (
                  <button
                    className="oa-btn-sm"
                    style={{ fontSize: 10, padding: "1px 6px" }}
                    onClick={(e) => { e.stopPropagation(); props.onApplySuggestion?.(alt.text); }}
                  >
                    Copy
                  </button>
                )}
              </div>
              {expandedAlt === i && (
                <div style={{ fontSize: 13, color: "#cbd5e1", marginTop: 4, lineHeight: 1.4 }}>{alt.text}</div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ─── MIDDLE ROW: Sentiment + Objections ─── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>

        {/* Buyer Sentiment */}
        <div className="oa-card" style={{ padding: "8px 12px" }}>
          <div style={{ fontSize: 11, color: "#9db2ce", fontWeight: 700, marginBottom: 6 }}>BUYER READ</div>
          <PulseIndicator level={dashboard.buyerSentiment.engagement} label="Engagement" />
          <PulseIndicator level={dashboard.buyerSentiment.urgency} label="Urgency" />
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 2 }}>
            <span style={{ fontSize: 12 }}>Tone: <b style={{ color: "#cbd5e1" }}>{dashboard.buyerSentiment.tone}</b></span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4 }}>
            <span style={{ fontSize: 12 }}>Momentum: </span>
            <span style={{
              fontWeight: 700,
              color: dashboard.momentum.level === "high" ? "#4ade80" : dashboard.momentum.level === "medium" ? "#fbbf24" : "#ff9ca8"
            }}>
              {dashboard.momentum.level} ({dashboard.momentum.score})
            </span>
          </div>
        </div>

        {/* Objection Radar */}
        <div className="oa-card" style={{ padding: "8px 12px" }}>
          <div style={{ fontSize: 11, color: "#9db2ce", fontWeight: 700, marginBottom: 6 }}>
            OBJECTION RADAR {dashboard.objectionsDetected.length > 0 && <span style={{ color: "#fbbf24" }}>({dashboard.objectionsDetected.length})</span>}
          </div>
          {dashboard.objectionsDetected.length === 0 ? (
            <div style={{ fontSize: 12, color: "#4b5e77" }}>No objections detected yet.</div>
          ) : (
            dashboard.objectionsDetected.map((obj, i) => (
              <div key={i} style={{ marginBottom: 6, borderLeft: "2px solid #fbbf24", paddingLeft: 6 }}>
                <div style={{ fontWeight: 700, fontSize: 12, textTransform: "capitalize" }}>{obj.key}</div>
                <div style={{ fontSize: 11, color: "#cbd5e1", lineHeight: 1.3 }}>{obj.suggestedResponse}</div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* ─── TALKING POINTS ─── */}
      {dashboard.talkingPoints.length > 0 && (
        <div className="oa-card" style={{ padding: "8px 12px" }}>
          <div style={{ fontSize: 11, color: "#9db2ce", fontWeight: 700, marginBottom: 6 }}>KEY TALKING POINTS</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4 }}>
            {dashboard.talkingPoints.map((tp, i) => (
              <div key={i} style={{ fontSize: 12, padding: "4px 6px", background: "rgba(96,165,250,0.06)", borderRadius: 4, lineHeight: 1.3 }}>
                {tp}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ─── NEXT MOVES (Predictive) ─── */}
      {dashboard.nextMoves.length > 0 && (
        <div className="oa-card" style={{ padding: "8px 12px" }}>
          <div style={{ fontSize: 11, color: "#9db2ce", fontWeight: 700, marginBottom: 6 }}>🔮 PREDICTED NEXT MOVES</div>
          {dashboard.nextMoves.map((mv, i) => (
            <div key={i} style={{ fontSize: 12, marginBottom: 3, paddingLeft: 12, position: "relative", lineHeight: 1.3 }}>
              <span style={{ position: "absolute", left: 0 }}>→</span> {mv}
            </div>
          ))}
        </div>
      )}

      {/* ─── RISK ALERTS ─── */}
      {dashboard.riskAlerts.length > 0 && (
        <div className="oa-card" style={{ padding: "8px 12px", borderLeft: "3px solid #ff9ca8" }}>
          <div style={{ fontSize: 11, color: "#ff9ca8", fontWeight: 700, marginBottom: 6 }}>⚠ RISK ALERTS</div>
          {dashboard.riskAlerts.map((risk, i) => (
            <div key={i} style={{ fontSize: 12, marginBottom: 4, display: "flex", gap: 6 }}>
              <span style={{ color: risk.severity === "high" ? "#ff6b7f" : "#fbbf24", fontWeight: 700 }}>
                {risk.severity === "high" ? "🔴" : "🟡"}
              </span>
              <span>{risk.message}</span>
            </div>
          ))}
        </div>
      )}

      {/* ─── TIMESTAMP ─── */}
      <div style={{ textAlign: "right", fontSize: 10, color: "#4b5e77" }}>
        Last updated: {new Date(dashboard.timestamp).toLocaleTimeString()}
      </div>

      <style>{`
        @keyframes pulse {
          0% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.6; transform: scale(1.3); }
          100% { opacity: 1; transform: scale(1); }
        }
      `}</style>
    </div>
  );
}
