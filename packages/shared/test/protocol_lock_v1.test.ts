import { describe, expect, it } from "vitest";
import { WS_CLIENT_MESSAGE_TYPES_V1 } from "../src/protocol/ws_messages_v1";
import { OVERLAY_MESSAGE_TYPES_V1 } from "../src/protocol/overlay_messages_v1";

describe("protocol lock (v1)", () => {
  it("locks ws client message types", () => {
    expect(Array.from(WS_CLIENT_MESSAGE_TYPES_V1)).toEqual(["start", "flush", "stop", "ping"]);
  });

  it("locks overlay message union types", () => {
    expect(Array.from(OVERLAY_MESSAGE_TYPES_V1)).toEqual(["script", "settings", "patch"]);
  });
});
