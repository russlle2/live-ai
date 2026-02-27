import React, { useEffect, useState } from "react";

type TrustData = {
  tenantId: string;
  day: string;
  trustScore: number;
  patchReceived: number;
  patchRejected: number;
  patchCoalesced: number;
  suggestionsShown: number;
  suggestionsApplied: number;
  suggestionsDismissed: number;
  muteOn: number;
  undo: number;
};

function scoreGradient(score: number): string {
  if (score >= 75) return "";
  if (score >= 50) return "trust-score-number--ok";
  return "trust-score-number--bad";
}

export function TrustDashboard(props: { tenantId: string; httpBase?: string }) {
  const [data, setData] = useState<TrustData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const base = props.httpBase || "http://localhost:8080";

  useEffect(() => {
    let cancelled = false;
    const fetchData = async () => {
      try {
        const res = await fetch(`${base}/api/trust/summary?tenantId=${encodeURIComponent(props.tenantId)}`);
        if (!res.ok) throw new Error(`Server returned ${res.status}`);
        const json = await res.json();
        if (!cancelled) { setData(json.summary); setError(null); setLoading(false); }
      } catch {
        if (!cancelled) { setError("Could not load insights. Is the server running?"); setLoading(false); }
      }
    };
    fetchData();
    const t = setInterval(fetchData, 5000);
    return () => { cancelled = true; clearInterval(t); };
  }, [props.tenantId, base]);

  if (loading) {
    return (
      <div className="trust-panel" role="status" aria-live="polite">
        <div className="empty-lux">
          <div style={{ fontSize: 32 }}>◌</div>
          <div className="empty-lux-title">Loading Insights</div>
          <div className="empty-lux-text">Fetching your performance data…</div>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="trust-panel">
        <div className="error-bar" role="alert" style={{ borderRadius: 12, border: "1px solid rgba(248,113,113,0.15)" }}>
          <span>⚠</span>
          <span>{error || "No data available"}</span>
        </div>
      </div>
    );
  }

  const metrics = [
    { label: "Tips Shown",    value: data.suggestionsShown,    icon: "👁" },
    { label: "Tips Used",     value: data.suggestionsApplied,  icon: "✓" },
    { label: "Tips Skipped",  value: data.suggestionsDismissed, icon: "⏩" },
    { label: "Received",      value: data.patchReceived,       icon: "📥" },
    { label: "Errors",        value: data.patchRejected,       icon: "✕" },
    { label: "Coalesced",     value: data.patchCoalesced,      icon: "🔗" },
    { label: "Paused",        value: data.muteOn,              icon: "⏸" },
  ];

  const patchTotal = Math.max(1, data.patchReceived + data.patchRejected);
  const rejectRate = ((data.patchRejected / patchTotal) * 100).toFixed(1);
  const coalesceRate = data.patchReceived > 0
    ? ((data.patchCoalesced / data.patchReceived) * 100).toFixed(1) : "0.0";

  return (
    <div className="trust-panel" role="region" aria-label="Performance insights">
      <div className="trust-score-hero">
        <div className="trust-score-label">Overall Trust Score</div>
        <div className={`trust-score-number ${scoreGradient(data.trustScore)}`} aria-label={`Trust score: ${data.trustScore} out of 100`}>
          {data.trustScore}
          <span style={{ fontSize: 24, fontWeight: 400, opacity: 0.4 }}> / 100</span>
        </div>
        <div className="trust-score-label" style={{ marginTop: 8 }}>
          {data.trustScore >= 75 ? "Excellent — the system is working well for you." :
           data.trustScore >= 50 ? "Decent — there's room for improvement." :
           "Needs attention — review the metrics below."}
        </div>
      </div>

      <div className="trust-grid" role="list" aria-label="Performance metrics">
        {metrics.map((m) => (
          <div key={m.label} className="trust-card" role="listitem">
            <div className="trust-card-icon">{m.icon}</div>
            <div className="trust-card-value">{m.value}</div>
            <div className="trust-card-label">{m.label}</div>
          </div>
        ))}
      </div>

      {/* Patch Health Breakdown */}
      <div className="trust-score-hero" style={{ marginTop: 16, padding: "16px 20px" }}>
        <div className="trust-score-label" style={{ marginBottom: 8, fontWeight: 600 }}>Patch Health</div>
        <div style={{ display: "flex", gap: 24, justifyContent: "center", flexWrap: "wrap" }}>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 22, fontWeight: 700, color: Number(rejectRate) > 0.5 ? "#f87171" : "var(--color-text)" }}>{rejectRate}%</div>
            <div style={{ fontSize: 12, opacity: 0.6 }}>Reject Rate</div>
            <div style={{ fontSize: 10, opacity: 0.4 }}>target &lt; 0.5%</div>
          </div>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 22, fontWeight: 700, color: "var(--color-text)" }}>{coalesceRate}%</div>
            <div style={{ fontSize: 12, opacity: 0.6 }}>Coalesced</div>
            <div style={{ fontSize: 10, opacity: 0.4 }}>spam prevention</div>
          </div>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 22, fontWeight: 700, color: "var(--color-text)" }}>{data.patchReceived}</div>
            <div style={{ fontSize: 12, opacity: 0.6 }}>Delivered</div>
          </div>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 22, fontWeight: 700, color: data.patchRejected > 0 ? "#f87171" : "var(--color-text)" }}>{data.patchRejected}</div>
            <div style={{ fontSize: 12, opacity: 0.6 }}>Rejected</div>
          </div>
        </div>
      </div>

      <div style={{ textAlign: "center", marginTop: 32, fontSize: 13, color: "var(--color-text-dim)" }}>
        Team: <strong>{data.tenantId}</strong> · {data.day} (UTC) · Auto-refreshes every 5s
      </div>
    </div>
  );
}
