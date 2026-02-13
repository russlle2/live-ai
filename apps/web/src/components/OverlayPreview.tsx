import React, { useEffect, useMemo, useRef } from "react";
import type { OverlayStateV1 } from "@overlay-assistant/shared";

/**
 * OverlayPreview
 * - Supports the richer guidance.items[] model (future P1/P2)
 * - Also supports v1-strict "text-only" patches (current backend)
 */
export function OverlayPreview(props: {
  state: OverlayStateV1;
  onShown: (itemId: string) => Promise<void>;
  onApply: (itemId: string) => Promise<void>;
  onDismiss: (itemId: string) => Promise<void>;
  onMuteToggle: () => Promise<void>;
}) {
  const { state } = props;
  // DEBUG: inspect state shape for text patches
  // eslint-disable-next-line no-console
  console.log("[OverlayPreview state]", state);
  const shownSet = useRef(new Set<string>());

  // v1-strict: if no guidance items are present, show the patched overlay text
  const textSuggestion = useMemo(() => {
    const t = (state as any)?.text;
    return typeof t === "string" && t.trim().length ? t.trim() : "";
  }, [state]);

  useEffect(() => {
    // Mark guidance items as shown (analytics)
    for (const item of state.guidance.items) {
      if (!shownSet.current.has(item.id)) {
        shownSet.current.add(item.id);
        props.onShown(item.id).catch(() => undefined);
      }
    }
  }, [state.guidance.items]);

  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 8, alignItems: "center" }}>
        <span>
          Mode: <b>{state.settings.controls.guidanceMode}</b>
        </span>
        <span>
          AI depth: <b>{state.settings.controls.aiDepth}</b>
        </span>
        <button onClick={() => props.onMuteToggle()}>
          {state.settings.controls.guidanceMuted ? "Unmute" : "Mute"}
        </button>
        {state.settings.status?.failureCode ? (
          <span style={{ color: "crimson" }}>Failure: {state.settings.status.failureCode}</span>
        ) : null}
      </div>

      {/* If we have guidance items, render them */}
      {state.guidance.items.length > 0 ? (
        state.guidance.items.map((g) => (
          <div key={g.id} style={{ border: "1px solid #eee", borderRadius: 8, padding: 10, marginBottom: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
              <div>
                <div style={{ fontWeight: 700 }}>{g.title}</div>
                <div style={{ fontSize: 12, color: "#666" }}>
                  {g.category} • confidence {Math.round(g.confidence * 100)}% ({g.confidenceBand})
                </div>
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                <button onClick={() => props.onApply(g.id)}>Apply</button>
                <button onClick={() => props.onDismiss(g.id)}>Dismiss</button>
              </div>
            </div>

            <div style={{ marginTop: 8 }}>{g.text}</div>

            {g.explanation ? (
              <details style={{ marginTop: 8 }}>
                <summary>Explain</summary>
                <pre style={{ whiteSpace: "pre-wrap", fontSize: 12 }}>{JSON.stringify(g.explanation, null, 2)}</pre>
              </details>
            ) : null}
          </div>
        ))
      ) : textSuggestion ? (
        // v1-strict text suggestion
        <div style={{ border: "1px solid #eee", borderRadius: 8, padding: 10 }}>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>Suggested line</div>
          <div style={{ marginBottom: 10 }}>{textSuggestion}</div>
          <div style={{ display: "flex", gap: 6 }}>
            {/* In v1-strict we don't have item IDs; use a fixed synthetic ID for analytics */}
            <button onClick={() => props.onApply("text_v1")}>Apply</button>
            <button onClick={() => props.onDismiss("text_v1")}>Dismiss</button>
          </div>
        </div>
      ) : (
        <div style={{ color: "#666" }}>No guidance items (yet).</div>
      )}
    </div>
  );
}
