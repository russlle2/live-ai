import React, { useEffect, useMemo, useRef, useState } from "react";
import type { OverlayStateV1 } from "@overlay-assistant/shared";

type SuggestionStage = "idle" | "opening" | "cushion" | "tailored" | "template";

const STAGE_COPY: Record<SuggestionStage, { kicker: string; note: string }> = {
  idle: {
    kicker: "Waiting for the other person",
    note: "A short bridge appears immediately when their turn ends, then the tailored response replaces it."
  },
  opening: {
    kicker: "Start with this exact line",
    note: "Your complete conversation path is ready below; live guidance will replace this as the other person responds."
  },
  cushion: {
    kicker: "Use this now if you need a beat",
    note: "This instant bridge is deliberately generic. A tailored response is being prepared."
  },
  tailored: {
    kicker: "Best next response",
    note: "Keep the meaning, but use your natural voice. Never claim experience you do not have."
  },
  template: {
    kicker: "Fast fallback",
    note: "AI was unavailable or still working, so this safe prepared response is staying on screen."
  }
};

export function OverlayPreview(props: {
  state: OverlayStateV1;
  stage?: SuggestionStage;
  guidanceId?: string;
  onShown: (guidanceId: string) => Promise<void>;
  onApply: (guidanceId: string) => Promise<void>;
  onDismiss: (guidanceId: string) => Promise<void>;
  onMuteToggle: () => Promise<void>;
}) {
  const stage = props.stage ?? "idle";
  const shown = useRef(new Set<string>());
  const [expanded, setExpanded] = useState<string | null>(null);
  const textSuggestion = useMemo(() => {
    const value = (props.state as OverlayStateV1 & { text?: unknown }).text;
    return typeof value === "string" ? value.trim() : "";
  }, [props.state]);

  useEffect(() => {
    for (const item of props.state.guidance.items) {
      const feedbackId = props.guidanceId ?? item.id;
      const shownKey = `${feedbackId}:${item.id}`;
      if (!shown.current.has(shownKey)) {
        shown.current.add(shownKey);
        void props.onShown(feedbackId);
      }
    }
  }, [props.guidanceId, props.state.guidance.items, props.onShown]);

  useEffect(() => {
    if (!props.guidanceId) return;
    const feedbackId = props.guidanceId;
    const key = `text:${feedbackId}`;
    if (textSuggestion && !shown.current.has(key)) {
      shown.current.add(key);
      void props.onShown(feedbackId);
    }
  }, [props.guidanceId, props.onShown, textSuggestion]);

  const muted = props.state.settings.controls.guidanceMuted;
  if (muted) {
    return (
      <div className="suggestion-empty suggestion-empty--paused">
        <strong>Guidance is paused</strong>
        <p>The transcript can continue while response suggestions stay hidden.</p>
        <button className="secondary-action" onClick={() => void props.onMuteToggle()}>Resume guidance</button>
      </div>
    );
  }

  const guidanceItems = props.state.guidance.items;
  if (guidanceItems.length > 0) {
    return (
      <div className="suggestion-stack" role="region" aria-label="Response suggestions">
        <div className="suggestion-toolbar">
          <span>{STAGE_COPY[stage].kicker}</span>
          <button onClick={() => void props.onMuteToggle()}>Pause</button>
        </div>
        {guidanceItems.map((item) => (
          <article className="suggestion-card" key={item.id}>
            <p className="suggestion-category">{item.category || "Response"} · {item.confidenceBand} confidence</p>
            <h2>{item.title}</h2>
            <blockquote>{item.text}</blockquote>
            <p className="suggestion-note">{STAGE_COPY[stage].note}</p>
            <div className="suggestion-actions">
              <button className="primary-small" onClick={() => void props.onApply(props.guidanceId ?? item.id)}>I used this</button>
              <button className="secondary-action" onClick={() => void props.onDismiss(props.guidanceId ?? item.id)}>Clear</button>
              {item.explanation?.reasons?.length ? (
                <button className="text-action" onClick={() => setExpanded(expanded === item.id ? null : item.id)} aria-expanded={expanded === item.id}>
                  {expanded === item.id ? "Hide why" : "Why this"}
                </button>
              ) : null}
            </div>
            {expanded === item.id && item.explanation?.reasons?.length ? (
              <div className="suggestion-reason">{item.explanation.reasons.join(" ")}</div>
            ) : null}
          </article>
        ))}
      </div>
    );
  }

  if (textSuggestion) {
    return (
      <div className="suggestion-stack" role="region" aria-label="Response suggestion" aria-live="assertive">
        <div className="suggestion-toolbar">
          <span>{STAGE_COPY[stage].kicker}</span>
          <button onClick={() => void props.onMuteToggle()}>Pause</button>
        </div>
        <article className={`suggestion-card suggestion-card--${stage}`}>
          <blockquote>{textSuggestion}</blockquote>
          <p className="suggestion-note">{STAGE_COPY[stage].note}</p>
          <div className="suggestion-actions">
            <button
              className="primary-small"
              disabled={!props.guidanceId}
              onClick={() => props.guidanceId && void props.onApply(props.guidanceId)}
            >
              I used this
            </button>
            <button className="secondary-action" onClick={() => void props.onDismiss(props.guidanceId ?? "")}>Clear</button>
          </div>
        </article>
      </div>
    );
  }

  return (
    <div className="suggestion-empty">
      <div className="listening-pulse" aria-hidden="true"><i /><i /><i /></div>
      <strong>{STAGE_COPY.idle.kicker}</strong>
      <p>{STAGE_COPY.idle.note}</p>
      <button className="text-action" onClick={() => void props.onMuteToggle()}>Pause guidance</button>
    </div>
  );
}
