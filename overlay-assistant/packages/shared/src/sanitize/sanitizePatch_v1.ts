/**
 * sanitizePatch_v1 (v1 strict)
 * - Fail-closed overlay patch sanitizer
 * - Allowlisted keys only
 * - Hard payload cap <= 8192 bytes (default)
 *
 * NOTE: Guidance patching is intentionally NOT supported in v1 strict,
 * because the repo's GuidanceItemV1 is a richer shape. We will enable it
 * later once we align the GuidanceItem schema. For now, "guidance" is dropped.
 */

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
}>;

// Protocol layer expects this name:
export type SanitizedPatchV1 = OverlayPatchV1;

export type SanitizeOptionsV1 = {
  maxBytes?: number;     // default 8192
  maxTextChars?: number; // default 20_000
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

export function sanitizePatch_v1(input: unknown, opts: SanitizeOptionsV1 = {}): SanitizeOk | SanitizeErr {
  const { maxBytes = 8192, maxTextChars = 20_000 } = opts;

  // Pre-size gate
  let rawBytes = 0;
  try {
    rawBytes = Buffer.byteLength(JSON.stringify(input), "utf8");
  } catch {
    return { ok: false, reason: "not_an_object", bytes: 0 };
  }
  if (rawBytes > maxBytes) return { ok: false, reason: "payload_too_large", bytes: rawBytes };

  if (!isPlainObject(input)) return { ok: false, reason: "not_an_object", bytes: rawBytes };

  const droppedPaths: string[] = [];
  const out: OverlayPatchV1 = {};

  // text
  if ("text" in input) {
    const v = (input as Record<string, unknown>).text;
    if (typeof v === "string") out.text = v.slice(0, maxTextChars);
    else droppedPaths.push("text");
  }

  // settings allowlist
  if ("settings" in input) {
    const s = (input as Record<string, unknown>).settings;
    if (isPlainObject(s)) {
      const o: OverlaySettingsPatchV1 = {};

      if ("fontSize" in s) {
        const v = s.fontSize;
        if (typeof v === "number") o.fontSize = clamp(v, 10, 120);
        else droppedPaths.push("settings.fontSize");
      }
      if ("speed" in s) {
        const v = s.speed;
        if (typeof v === "number") o.speed = clamp(v, 0.25, 5);
        else droppedPaths.push("settings.speed");
      }
      if ("lineHeight" in s) {
        const v = s.lineHeight;
        if (typeof v === "number") o.lineHeight = clamp(v, 0.8, 3);
        else droppedPaths.push("settings.lineHeight");
      }
      if ("width" in s) {
        const v = s.width;
        if (typeof v === "number") o.width = clamp(v, 200, 4000);
        else droppedPaths.push("settings.width");
      }
      if ("mirror" in s) {
        const v = s.mirror;
        if (typeof v === "boolean") o.mirror = v;
        else droppedPaths.push("settings.mirror");
      }
      if ("opacity" in s) {
        const v = s.opacity;
        if (typeof v === "number") o.opacity = clamp(v, 0, 1);
        else droppedPaths.push("settings.opacity");
      }

      if (Object.keys(o).length > 0) out.settings = o;
      else droppedPaths.push("settings");
    } else {
      droppedPaths.push("settings");
    }
  }

  // Guidance is explicitly dropped in v1 strict
  if ("guidance" in input) droppedPaths.push("guidance");

  // Reject empty patches
  if (Object.keys(out).length === 0) {
    return { ok: false, reason: "no_allowed_fields", bytes: rawBytes, detailSafe: "no allowlisted keys" };
  }

  // Post-sanitize size gate
  const outBytes = Buffer.byteLength(JSON.stringify(out), "utf8");
  if (outBytes > maxBytes) return { ok: false, reason: "payload_too_large", bytes: outBytes };

  return { ok: true, patch: out, bytes: outBytes, droppedPaths };
}
