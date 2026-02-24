import React, { useState, useEffect } from "react";
import { API_BASE, apiHeaders } from "../lib/config";

export type ProductContext = {
  productName: string;
  oneLiner: string;
  valueProps: string[];
  pricing: string;
  commonObjections: Array<{ objection: string; response: string }>;
  targetAudience: string;
  competitors: string;
  additionalNotes: string;
};

const EMPTY_CONTEXT: ProductContext = {
  productName: "",
  oneLiner: "",
  valueProps: [],
  pricing: "",
  commonObjections: [],
  targetAudience: "",
  competitors: "",
  additionalNotes: ""
};

export function ProductContextPanel(props: {
  tenantId: string;
  sessionId: string;
  onContextSaved?: (ctx: ProductContext) => void;
}) {
  const [ctx, setCtx] = useState<ProductContext>(EMPTY_CONTEXT);
  const [newValueProp, setNewValueProp] = useState("");
  const [newObjection, setNewObjection] = useState("");
  const [newResponse, setNewResponse] = useState("");
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [collapsed, setCollapsed] = useState(false);

  // Load existing context on mount
  useEffect(() => {
    fetch(`${API_BASE}/api/session/product_context?sessionId=${encodeURIComponent(props.sessionId)}`, { headers: apiHeaders() })
      .then(r => r.json())
      .then(j => { if (j.ok && j.productContext) { setCtx(j.productContext); setSaved(true); } })
      .catch(() => {});
  }, [props.sessionId]);

  const save = async () => {
    setSaving(true);
    setError("");
    try {
      const res = await fetch(`${API_BASE}/api/session/product_context`, {
        method: "POST",
        headers: apiHeaders(),
        body: JSON.stringify({ ...ctx, sessionId: props.sessionId, tenantId: props.tenantId })
      });
      const j = await res.json();
      if (j.ok) {
        setSaved(true);
        props.onContextSaved?.(ctx);
      } else {
        setError("Failed to save context");
      }
    } catch {
      setError("Network error saving context");
    }
    setSaving(false);
  };

  const addValueProp = () => {
    const v = newValueProp.trim();
    if (!v) return;
    setCtx(c => ({ ...c, valueProps: [...c.valueProps, v] }));
    setNewValueProp("");
    setSaved(false);
  };

  const removeValueProp = (idx: number) => {
    setCtx(c => ({ ...c, valueProps: c.valueProps.filter((_, i) => i !== idx) }));
    setSaved(false);
  };

  const addObjection = () => {
    const o = newObjection.trim();
    const r = newResponse.trim();
    if (!o) return;
    setCtx(c => ({ ...c, commonObjections: [...c.commonObjections, { objection: o, response: r }] }));
    setNewObjection("");
    setNewResponse("");
    setSaved(false);
  };

  const removeObjection = (idx: number) => {
    setCtx(c => ({ ...c, commonObjections: c.commonObjections.filter((_, i) => i !== idx) }));
    setSaved(false);
  };

  const set = (field: keyof ProductContext, value: string) => {
    setCtx(c => ({ ...c, [field]: value }));
    setSaved(false);
  };

  return (
    <div className="oa-card" style={{ borderLeft: saved ? "3px solid #4ade80" : "3px solid #fbbf24" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer" }} onClick={() => setCollapsed(!collapsed)}>
        <h3 style={{ margin: 0 }}>
          {collapsed ? "▸" : "▾"} Product / Service Context
          {ctx.productName && <span style={{ fontWeight: 400, fontSize: 13, marginLeft: 8, color: "#9db2ce" }}>— {ctx.productName}</span>}
        </h3>
        {saved && <span style={{ color: "#4ade80", fontSize: 12 }}>● Saved</span>}
      </div>
      <div style={{ fontSize: 12, color: "#9db2ce", marginTop: 4 }}>
        Tell the AI what you're selling so guidance is product-specific. Works universally for any product or service.
      </div>

      {!collapsed && (
        <div style={{ marginTop: 12 }}>
          <div style={{ display: "grid", gridTemplateColumns: "130px 1fr", gap: 8, alignItems: "start" }}>
            <label style={{ fontWeight: 600 }}>Product name</label>
            <input
              value={ctx.productName}
              onChange={e => set("productName", e.target.value)}
              placeholder="e.g. Acme CRM, HVAC Pro Install, SaaS Analytics..."
              style={{ width: "100%" }}
            />

            <label style={{ fontWeight: 600 }}>One-liner</label>
            <input
              value={ctx.oneLiner}
              onChange={e => set("oneLiner", e.target.value)}
              placeholder="What does it do in one sentence?"
              style={{ width: "100%" }}
            />

            <label style={{ fontWeight: 600 }}>Target audience</label>
            <input
              value={ctx.targetAudience}
              onChange={e => set("targetAudience", e.target.value)}
              placeholder="Who are you selling to? e.g. Mid-market SaaS CTOs, Homeowners..."
              style={{ width: "100%" }}
            />

            <label style={{ fontWeight: 600 }}>Pricing</label>
            <input
              value={ctx.pricing}
              onChange={e => set("pricing", e.target.value)}
              placeholder="e.g. $99/mo starter, $299/mo pro, custom enterprise"
              style={{ width: "100%" }}
            />

            <label style={{ fontWeight: 600 }}>Competitors</label>
            <input
              value={ctx.competitors}
              onChange={e => set("competitors", e.target.value)}
              placeholder="Key competitors and how you differentiate"
              style={{ width: "100%" }}
            />
          </div>

          {/* Value Props */}
          <div style={{ marginTop: 12 }}>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>Value propositions</div>
            {ctx.valueProps.map((vp, i) => (
              <div key={i} style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 4 }}>
                <span style={{ flex: 1, fontSize: 13 }}>✦ {vp}</span>
                <button style={{ fontSize: 11, padding: "2px 6px" }} onClick={() => removeValueProp(i)}>✕</button>
              </div>
            ))}
            <div style={{ display: "flex", gap: 6 }}>
              <input
                value={newValueProp}
                onChange={e => setNewValueProp(e.target.value)}
                onKeyDown={e => e.key === "Enter" && addValueProp()}
                placeholder="Add value prop (Enter to add)"
                style={{ flex: 1 }}
              />
              <button onClick={addValueProp}>+</button>
            </div>
          </div>

          {/* Common Objections */}
          <div style={{ marginTop: 12 }}>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>Common objections & responses</div>
            {ctx.commonObjections.map((o, i) => (
              <div key={i} style={{ marginBottom: 6, borderLeft: "2px solid #fbbf24", paddingLeft: 8, fontSize: 13 }}>
                <div><b>Objection:</b> {o.objection}</div>
                {o.response && <div><b>Response:</b> {o.response}</div>}
                <button style={{ fontSize: 11, padding: "2px 6px", marginTop: 2 }} onClick={() => removeObjection(i)}>✕</button>
              </div>
            ))}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: 6, marginTop: 4 }}>
              <input
                value={newObjection}
                onChange={e => setNewObjection(e.target.value)}
                placeholder='Objection (e.g. "Too expensive")'
              />
              <input
                value={newResponse}
                onChange={e => setNewResponse(e.target.value)}
                onKeyDown={e => e.key === "Enter" && addObjection()}
                placeholder="Your response"
              />
              <button onClick={addObjection}>+</button>
            </div>
          </div>

          {/* Additional Notes */}
          <div style={{ marginTop: 12 }}>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>Additional context / notes</div>
            <textarea
              value={ctx.additionalNotes}
              onChange={e => set("additionalNotes", e.target.value)}
              placeholder="Anything else the AI should know — unique selling points, industry jargon, special offers, compliance notes..."
              style={{ width: "100%", height: 60, resize: "vertical" }}
            />
          </div>

          <div style={{ display: "flex", gap: 8, marginTop: 12, alignItems: "center" }}>
            <button onClick={save} disabled={saving} style={{ fontWeight: 700 }}>
              {saving ? "Saving…" : saved ? "✓ Saved — Update" : "Save Context"}
            </button>
            {error && <span style={{ color: "#ff9ca8", fontSize: 12 }}>{error}</span>}
          </div>
        </div>
      )}
    </div>
  );
}
