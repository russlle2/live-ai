import React, { useEffect, useState } from "react";
import { API_BASE, apiHeaders } from "../lib/config";

export function TrustDashboard(props: { tenantId: string }) {
  const [data, setData] = useState<any>(null);

  useEffect(() => {
    const fn = async () => {
      const res = await fetch(`${API_BASE}/api/trust/summary?tenantId=${encodeURIComponent(props.tenantId)}`, { headers: apiHeaders() });
      const json = await res.json();
      setData(json.summary);
    };
    fn().catch(() => undefined);
    const t = setInterval(() => fn().catch(() => undefined), 2000);
    return () => clearInterval(t);
  }, [props.tenantId]);

  if (!data) return <div>Loading…</div>;

  return (
    <div style={{ border: "1px solid #ddd", borderRadius: 8, padding: 12 }}>
      <h3>Trust Dashboard (today)</h3>

      <div style={{ display: "grid", gridTemplateColumns: "220px 1fr", gap: 8 }}>
        <div>Tenant</div><div><b>{data.tenantId}</b></div>
        <div>Day (UTC)</div><div><b>{data.day}</b></div>
        <div>Trust score</div><div><b>{data.trustScore}</b> / 100</div>

        <div>Patch received</div><div>{data.patchReceived}</div>
        <div>Patch rejected</div><div>{data.patchRejected}</div>
        <div>Suggestions shown</div><div>{data.suggestionsShown}</div>
        <div>Applied</div><div>{data.suggestionsApplied}</div>
        <div>Dismissed</div><div>{data.suggestionsDismissed}</div>
        <div>Mute on</div><div>{data.muteOn}</div>
        <div>Undo</div><div>{data.undo}</div>
      </div>

      <p style={{ color: "#666", marginTop: 12 }}>
        Demo trust model. Replace with your production scoring + alerts before enterprise pilots.
      </p>
    </div>
  );
}
