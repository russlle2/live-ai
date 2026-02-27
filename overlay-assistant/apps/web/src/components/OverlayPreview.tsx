import React, { useEffect, useMemo, useRef, useState } from "react";
import type { OverlayStateV1 } from "@overlay-assistant/shared";

/**
 * OverlayPreview v3 — Luxury dark guidance cards
 */

const CONFIDENCE_DISPLAY: Record<string, { icon: string; label: string; cls: string }> = {
  high:   { icon: "✦", label: "Strong Match",    cls: "guidance-badge--high" },
  medium: { icon: "◆", label: "Likely Relevant",  cls: "guidance-badge--medium" },
  low:    { icon: "○", label: "Just a Thought",   cls: "guidance-badge--low" },
};

export function OverlayPreview(props: {
  state: OverlayStateV1;
  onShown: (itemId: string) => Promise<void>;
  onApply: (itemId: string) => Promise<void>;
  onDismiss: (itemId: string) => Promise<void>;
  onMuteToggle: () => Promise<void>;
}) {
  const { state } = props;
  const shownSet = useRef(new Set<string>());
  const [expandedWhy, setExpandedWhy] = useState<string | null>(null);

  const textSuggestion = useMemo(() => {
    const t = (state as any)?.text;
    return typeof t === "string" && t.trim().length ? t.trim() : "";
  }, [state]);

  useEffect(() => {
    for (const item of state.guidance.items) {
      if (!shownSet.current.has(item.id)) {
        shownSet.current.add(item.id);
        props.onShown(item.id).catch(() => undefined);
      }
    }
  }, [state.guidance.items]);

  const isMuted = state.settings.controls.guidanceMuted;
  const hasFailure = !!state.settings.status?.failureCode;

  return (
    <div role="region" aria-label="Sales coaching">
      {/* Controls */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        <button
          className={`btn-luxury btn-luxury--sm ${isMuted ? "btn-luxury--primary" : "btn-luxury--secondary"}`}
          onClick={() => props.onMuteToggle()}
          aria-pressed={isMuted}
        >
          {isMuted ? "▐▐  Paused" : "▶  Active"}
        </button>
        {hasFailure && (
          <span style={{ fontSize: 13, color: "var(--color-danger)" }}>
            ⚠ Processing error — try again
          </span>
        )}
      </div>

      {/* Guidance Cards */}
      {state.guidance.items.length > 0 ? (
        <div className="guidance-lux">
          {state.guidance.items.map((g) => {
            const conf = CONFIDENCE_DISPLAY[g.confidenceBand] || CONFIDENCE_DISPLAY.medium;
            const isExpanded = expandedWhy === g.id;

            return (
              <div key={g.id} className={`guidance-card-lux guidance-card-lux--${g.confidenceBand}`} role="article" aria-label={`Tip: ${g.title}`}>
                <div className={`guidance-badge ${conf.cls}`}>
                  <span>{conf.icon}</span> {conf.label}
                </div>

                <div className="guidance-card-title">{g.title}</div>

                <div className="guidance-card-text" aria-label="Suggested words to say">
                  {g.text}
                </div>

                <div className="guidance-card-actions">
                  <button className="btn-luxury btn-luxury--primary btn-luxury--sm" onClick={() => props.onApply(g.id)}>
                    ✓ Used it
                  </button>
                  <button className="btn-luxury btn-luxury--secondary btn-luxury--sm" onClick={() => props.onDismiss(g.id)}>
                    Skip
                  </button>
                  <button className="why-btn" onClick={() => setExpandedWhy(isExpanded ? null : g.id)} aria-expanded={isExpanded}>
                    {isExpanded ? "▲ Hide reason" : "▼ Why this?"}
                  </button>
                </div>

                {isExpanded && g.explanation && (
                  <div className="why-panel" aria-label="Explanation">
                    {g.explanation.reasons?.map((r: string, i: number) => (
                      <div key={i}>{r}</div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : textSuggestion ? (
        <div className="guidance-lux">
          <div className="guidance-card-lux guidance-card-lux--medium" role="article">
            <div className="guidance-badge guidance-badge--medium">
              <span>◆</span> Suggestion
            </div>
            <div className="guidance-card-title">Quick Tip</div>
            <div className="guidance-card-text">{textSuggestion}</div>
            <div className="guidance-card-actions">
              <button className="btn-luxury btn-luxury--primary btn-luxury--sm" onClick={() => props.onApply("text_v1")}>✓ Used it</button>
              <button className="btn-luxury btn-luxury--secondary btn-luxury--sm" onClick={() => props.onDismiss("text_v1")}>Skip</button>
            </div>
          </div>
        </div>
      ) : (
        <div className="empty-lux">
          <div style={{ fontSize: 40, marginBottom: 8 }}>✦</div>
          <div className="empty-lux-title">Ready When You Are</div>
          <div className="empty-lux-text">
            Start a conversation and coaching tips will appear here automatically. Take your time.
          </div>
        </div>
      )}
    </div>
  );
}
