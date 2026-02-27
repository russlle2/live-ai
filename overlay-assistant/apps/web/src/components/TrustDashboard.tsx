import React, { useEffect, useState } from "react";

type TrustData = {
  tenantId: string;
  day: string;
  trustScore: number;
  patchReceived: number;
  patchRejected: number;
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
    { label: "Paused",        value: data.muteOn,              icon: "⏸" },
  ];

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

      <div style={{ textAlign: "center", marginTop: 32, fontSize: 13, color: "var(--color-text-dim)" }}>
        Team: <strong>{data.tenantId}</strong> · {data.day} (UTC) · Auto-refreshes every 5s
      </div>
    </div>
  );
}
