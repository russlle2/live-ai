import { describe, expect, it } from "vitest";
import { classifyWebSocketBackpressure } from "./ws_backpressure.js";

describe("WebSocket backpressure policy", () => {
  it("sends, coalesces, or disconnects at bounded thresholds", () => {
    expect(classifyWebSocketBackpressure(0)).toBe("send");
    expect(classifyWebSocketBackpressure(256 * 1024)).toBe("send");
    expect(classifyWebSocketBackpressure(256 * 1024 + 1)).toBe("coalesce");
    expect(classifyWebSocketBackpressure(1024 * 1024)).toBe("coalesce");
    expect(classifyWebSocketBackpressure(1024 * 1024 + 1)).toBe("disconnect");
  });

  it("fails closed for invalid buffered byte values", () => {
    expect(classifyWebSocketBackpressure(Number.NaN)).toBe("disconnect");
    expect(classifyWebSocketBackpressure(-1)).toBe("disconnect");
  });
});
