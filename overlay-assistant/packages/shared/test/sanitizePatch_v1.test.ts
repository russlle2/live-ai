import { describe, expect, it } from "vitest";
import { sanitizePatch_v1 } from "../src/sanitize/sanitizePatch_v1";

const MAX_PATCH_BYTES = 8192;

describe("sanitizePatch_v1", () => {
  it("accepts a small allowlisted patch", () => {
    const raw = { text: "Say hello to the prospect.", settings: { fontSize: 18 } };
    const res = sanitizePatch_v1(raw);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.patch.text).toBe("Say hello to the prospect.");
    }
  });

  it("rejects disallowed paths", () => {
    const raw = { evil: "bad data" };
    const res = sanitizePatch_v1(raw);
    expect(res.ok).toBe(false);
  });

  it("rejects big payloads", () => {
    const big = "x".repeat(MAX_PATCH_BYTES + 100);
    const raw = { text: big };
    const res = sanitizePatch_v1(raw);
    expect(res.ok).toBe(false);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    "rejects non-finite numeric settings",
    (value) => {
      const onlyInvalid = sanitizePatch_v1({ settings: { opacity: value } });
      expect(onlyInvalid.ok).toBe(false);

      const withSafeText = sanitizePatch_v1({
        text: "Keep this safe line.",
        settings: { opacity: value }
      });
      expect(withSafeText.ok).toBe(true);
      if (withSafeText.ok) {
        expect(withSafeText.patch).toEqual({ text: "Keep this safe line." });
        expect(withSafeText.droppedPaths).toContain("settings.opacity");
      }
    }
  );
});
