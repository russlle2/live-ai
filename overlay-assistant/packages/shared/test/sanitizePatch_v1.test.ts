import { describe, expect, it } from "vitest";
import { sanitizePatch_v1, MAX_PATCH_BYTES } from "../src/sanitize/sanitizePatch_v1";

describe("sanitizePatch_v1", () => {
  it("accepts a small allowlisted patch", () => {
    const raw = { ops: [{ op: "replace", path: "/guidance/items", value: [{ id: "1", title: "Hi", text: "Hello", confidence: 0.8 }] }] };
    const res = sanitizePatch_v1(raw);
    expect(res.ok).toBe(true);
  });

  it("rejects disallowed paths", () => {
    const raw = { ops: [{ op: "replace", path: "/evil", value: 1 }] };
    const res = sanitizePatch_v1(raw);
    expect(res.ok).toBe(false);
  });

  it("rejects big payloads", () => {
    const big = "x".repeat(MAX_PATCH_BYTES);
    const raw = { ops: [{ op: "replace", path: "/guidance/items", value: [{ t: big }] }] };
    const res = sanitizePatch_v1(raw);
    expect(res.ok).toBe(false);
  });
});
