import { describe, expect, it } from "vitest";
import { safeRequestId } from "./security.js";

describe("request ID boundary", () => {
  it("preserves a short protocol-safe request ID", () => {
    expect(safeRequestId("request_01.trace-2", () => "generated"))
      .toBe("request_01.trace-2");
  });

  it.each([
    "",
    "contains spaces",
    "line\r\ninjection",
    "x".repeat(129),
    ["array-value"],
    42
  ])("replaces unsafe request IDs", (value) => {
    expect(safeRequestId(value, () => "generated-request-id"))
      .toBe("generated-request-id");
  });
});
