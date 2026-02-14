/**
 * sanitizePatch_v1 (strict, allowlisted)
 * - Supports v1 patch object: { text?, settings?, guidance? }
 * - Hard payload cap <= 8192 bytes
 * - Guidance items must match core GuidanceItemV1 shape (id/title/category/text/confidence/confidenceBand)
 */

import type { GuidanceItemV1 as CoreGuidanceItemV1 } from "../types/core_types_v1";

// Cross-runtime byte length (Node + browser)
function byteLen(s: string): number {
  try {
    // Browser / modern runtimes
    // @ts-ignore
    if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(s).length;
  } catch {}
  try {
    // Node.js
    // @ts-ignore
    if (typeof Buffer !== "undefined") return Buffer.byteLength(s, "utf8");
  } catch {}
  // Fallback (approx)
  return s.length;
}


export type PatchRejectReason =
  | "payload_too_large"
  | "not_an_object"
  | "no_allowed_fields";

export type OverlaySettingsPatchV1 = Partial<{
  fontSize: number;   // 10..120
  speed: number;      // 0.25..5
  lineHeight: number; // 0.8..3
  width: number;      // 200..4000
  mirror: boolean;
  opacity: number;    // 0..1
}>;

export type OverlayPatchV1 = Partial<{
  text: string;
  settings: OverlaySettingsPatchV1;
  guidance: { items: CoreGuidanceItemV1[] };
}>;

// Protocol layer expects this name:
export type SanitizedPatchV1 = OverlayPatchV1;

export type SanitizeOptionsV1 = {
  maxBytes?: number;     // default 8192
  maxTextChars?: number; // default 20_000
  maxGuidanceItems?: number; // default 6
};

export type SanitizeOk = {
  ok: true;
  patch: OverlayPatchV1;
  bytes: number;
  droppedPaths: string[];
};

export type SanitizeErr = {
  ok: false;
  reason: PatchRejectReason;
  bytes: number;
  detailSafe?: string;
};

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

function clampString(v: string, max: number) {
  return v.length > max ? v.slice(0, max) : v;
}

function sanitizeGuidanceItem(x: unknown, dropped: string[], idx: number): CoreGuidanceItemV1 | null {
  if (!isPlainObject(x)) return null;

  const id = typeof x.id === "string" ? clampString(x.id, 64) : "";
  const title = typeof x.title === "string" ? clampString(x.title, 80) : "";
  const category = typeof x.category === "string" ? clampString(x.category, 80) : "";
  const text = typeof x.text === "string" ? clampString(x.text, 800) : "";

  const confidence = typeof x.confidence === "number" ? clamp(x.confidence, 0, 1) : NaN;
  const confidenceBand = typeof x.confidenceBand === "string" ? x.confidenceBand : "";

  const bandOk = confidenceBand === "low" || confidenceBand === "medium" || confidenceBand === "high";

  if (!id) dropped.push(`guidance.items[${idx}].id`);
  if (!title) dropped.push(`guidance.items[${idx}].title`);
  if (!category) dropped.push(`guidance.items[${idx}].category`);
  if (!text) dropped.push(`guidance.items[${idx}].text`);
  if (!Number.isFinite(confidence)) dropped.push(`guidance.items[${idx}].confidence`);
  if (!bandOk) dropped.push(`guidance.items[${idx}].confidenceBand`);

  if (!id || !title || !category || !text || !Number.isFinite(confidence) || !bandOk) return null;

  // explanation can be any JSON-ish object; cap size
  let explanation: any = undefined;
  if ("explanation" in x) {
    try {
      const s = JSON.stringify((x as any).explanation);
      if (typeof s === "string" && s.length <= 6000) explanation = (x as any).explanation;
      else dropped.push(`guidance.items[${idx}].explanation`);
    } catch {
      dropped.push(`guidance.items[${idx}].explanation`);
    }
  }

  return { id, title, category, text, confidence, confidenceBand, explanation } as CoreGuidanceItemV1;
}

export function sanitizePatch_v1(input: unknown, opts: SanitizeOptionsV1 = {}): SanitizeOk | SanitizeErr {
  const { maxBytes = 8192, maxTextChars = 20_000, maxGuidanceItems = 6 } = opts;

  // Pre-size gate
  let rawBytes = 0;
  try {
    rawBytes = byteLen(JSON.stringify(input));
  } catch {
    return { ok: false, reason: "not_an_object", bytes: 0 };
  }
  if (rawBytes > maxBytes) return { ok: false, reason: "payload_too_large", bytes: rawBytes };

  if (!isPlainObject(input)) return { ok: false, reason: "not_an_object", bytes: rawBytes };

  const droppedPaths: string[] = [];
  const out: OverlayPatchV1 = {};

  // text
  if ("text" in input) {
    const v = (input as any).text;
    if (typeof v === "string") out.text = v.slice(0, maxTextChars);
    else droppedPaths.push("text");
  }

  // settings
  if ("settings" in input) {
    const s = (input as any).settings;
    if (isPlainObject(s)) {
      const o: OverlaySettingsPatchV1 = {};
      if ("fontSize" in s) typeof s.fontSize === "number" ? (o.fontSize = clamp(s.fontSize, 10, 120)) : droppedPaths.push("settings.fontSize");
      if ("speed" in s) typeof s.speed === "number" ? (o.speed = clamp(s.speed, 0.25, 5)) : droppedPaths.push("settings.speed");
      if ("lineHeight" in s) typeof s.lineHeight === "number" ? (o.lineHeight = clamp(s.lineHeight, 0.8, 3)) : droppedPaths.push("settings.lineHeight");
      if ("width" in s) typeof s.width === "number" ? (o.width = clamp(s.width, 200, 4000)) : droppedPaths.push("settings.width");
      if ("mirror" in s) typeof s.mirror === "boolean" ? (o.mirror = s.mirror) : droppedPaths.push("settings.mirror");
      if ("opacity" in s) typeof s.opacity === "number" ? (o.opacity = clamp(s.opacity, 0, 1)) : droppedPaths.push("settings.opacity");
      if (Object.keys(o).length) out.settings = o;
      else droppedPaths.push("settings");
    } else {
      droppedPaths.push("settings");
    }
  }

  // guidance.items
  if ("guidance" in input) {
    const g = (input as any).guidance;
    if (isPlainObject(g) && Array.isArray((g as any).items)) {
      const itemsRaw = ((g as any).items as unknown[]).slice(0, maxGuidanceItems);
      const items: CoreGuidanceItemV1[] = [];
      itemsRaw.forEach((it, idx) => {
        const clean = sanitizeGuidanceItem(it, droppedPaths, idx);
        if (clean) items.push(clean);
      });
      if (items.length) out.guidance = { items };
      else droppedPaths.push("guidance.items");
    } else {
      droppedPaths.push("guidance");
    }
  }

  if (Object.keys(out).length === 0) {
    return { ok: false, reason: "no_allowed_fields", bytes: rawBytes, detailSafe: "no allowlisted keys" };
  }

  const outBytes = byteLen(JSON.stringify(out));
  if (outBytes > maxBytes) return { ok: false, reason: "payload_too_large", bytes: outBytes };

  return { ok: true, patch: out, bytes: outBytes, droppedPaths };
}
