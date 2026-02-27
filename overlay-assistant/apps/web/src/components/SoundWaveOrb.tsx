import React, { useRef, useEffect, useCallback } from "react";

/**
 * SoundWaveOrb — A luxury animated orb that visualizes "the machine talking."
 *
 * Three modes:
 *  - idle:     slow ambient breathing pulse
 *  - listening: gentle wave oscillation
 *  - speaking: energetic multi-layer wave burst
 */
type OrbMode = "idle" | "listening" | "speaking";

const TAU = Math.PI * 2;

// Color palette for the orb layers
const COLORS = [
  "rgba(99, 102, 241, 0.6)",   // indigo
  "rgba(139, 92, 246, 0.45)",  // violet
  "rgba(59, 130, 246, 0.35)",  // blue
  "rgba(168, 85, 247, 0.25)",  // purple haze
];

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

export function SoundWaveOrb({ mode = "idle", size = 200 }: { mode?: OrbMode; size?: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frameRef = useRef<number>(0);
  const timeRef = useRef<number>(0);
  const modeRef = useRef<OrbMode>(mode);

  // Smoothly transition mode
  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const w = size * dpr;
    const h = size * dpr;
    canvas.width = w;
    canvas.height = h;
    ctx.clearRect(0, 0, w, h);

    const cx = w / 2;
    const cy = h / 2;
    const baseRadius = w * 0.28;
    const t = timeRef.current;
    const m = modeRef.current;

    // Speed multiplier per mode
    const speed = m === "speaking" ? 0.035 : m === "listening" ? 0.018 : 0.008;
    timeRef.current += speed;

    // Draw layers (back to front)
    for (let layer = COLORS.length - 1; layer >= 0; layer--) {
      const points = 180;
      const layerOffset = layer * 0.7;
      const amplitudeBase = m === "speaking" ? 18 : m === "listening" ? 10 : 4;
      const amplitude = (amplitudeBase + layer * 4) * dpr;

      ctx.beginPath();
      for (let i = 0; i <= points; i++) {
        const angle = (i / points) * TAU;

        // Multiple sine waves for organic shape
        const wave1 = Math.sin(angle * 3 + t + layerOffset) * amplitude;
        const wave2 = Math.sin(angle * 5 - t * 1.3 + layerOffset) * amplitude * 0.5;
        const wave3 = Math.cos(angle * 2 + t * 0.7 + layerOffset) * amplitude * 0.3;

        const r = baseRadius * dpr + wave1 + wave2 + wave3;
        const x = cx + Math.cos(angle) * r;
        const y = cy + Math.sin(angle) * r;

        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();

      // Gradient fill
      const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, baseRadius * dpr * 1.5);
      grad.addColorStop(0, COLORS[layer]);
      grad.addColorStop(1, "rgba(15, 15, 35, 0)");
      ctx.fillStyle = grad;
      ctx.fill();
    }

    // Inner glow core
    const coreGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, baseRadius * dpr * 0.6);
    const coreAlpha = m === "speaking" ? 0.9 : m === "listening" ? 0.6 : 0.35;
    coreGrad.addColorStop(0, `rgba(165, 140, 255, ${coreAlpha})`);
    coreGrad.addColorStop(0.5, `rgba(99, 102, 241, ${coreAlpha * 0.5})`);
    coreGrad.addColorStop(1, "rgba(15, 15, 35, 0)");
    ctx.beginPath();
    ctx.arc(cx, cy, baseRadius * dpr * 0.6, 0, TAU);
    ctx.fillStyle = coreGrad;
    ctx.fill();

    // Outer bloom
    const bloomRadius = baseRadius * dpr * (1.2 + Math.sin(t * 0.5) * 0.1);
    const bloomGrad = ctx.createRadialGradient(cx, cy, baseRadius * dpr * 0.8, cx, cy, bloomRadius);
    const bloomAlpha = m === "speaking" ? 0.15 : 0.05;
    bloomGrad.addColorStop(0, `rgba(139, 92, 246, ${bloomAlpha})`);
    bloomGrad.addColorStop(1, "rgba(15, 15, 35, 0)");
    ctx.beginPath();
    ctx.arc(cx, cy, bloomRadius, 0, TAU);
    ctx.fillStyle = bloomGrad;
    ctx.fill();

    frameRef.current = requestAnimationFrame(draw);
  }, [size]);

  useEffect(() => {
    frameRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frameRef.current);
  }, [draw]);

  return (
    <div className="orb-container" aria-hidden="true">
      <canvas
        ref={canvasRef}
        style={{ width: size, height: size }}
        className="orb-canvas"
      />
      <div className="orb-label">
        {mode === "speaking" ? "Coaching…" : mode === "listening" ? "Listening" : "Standing By"}
      </div>
    </div>
  );
}
