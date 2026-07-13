import { describe, expect, it } from "vitest";
import { isAllowedWebSocketOrigin } from "./ws_origin.js";

describe("WebSocket browser origin admission", () => {
  it("accepts the configured browser origin and non-browser clients", () => {
    expect(isAllowedWebSocketOrigin("https://aide.example", "https://aide.example/")).toBe(true);
    expect(isAllowedWebSocketOrigin(undefined, "https://aide.example")).toBe(true);
  });

  it("rejects cross-origin and malformed browser requests", () => {
    expect(isAllowedWebSocketOrigin("https://evil.example", "https://aide.example")).toBe(false);
    expect(isAllowedWebSocketOrigin("not-an-origin", "https://aide.example")).toBe(false);
    expect(isAllowedWebSocketOrigin("https://evil.example", "*")).toBe(false);
  });
});
