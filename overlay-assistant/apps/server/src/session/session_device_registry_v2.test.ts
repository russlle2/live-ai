import { describe, expect, it } from "vitest";
import { SessionDeviceRegistryV2 } from "./session_device_registry_v2.js";

describe("SessionDeviceRegistryV2", () => {
  it("admits one audio host and multiple companions", () => {
    const registry = new SessionDeviceRegistryV2<string>();
    expect(registry.register("session-1", "host-1", "audio_host"))
      .toEqual({ ok: true });
    expect(registry.register("session-1", "phone-1", "companion"))
      .toEqual({ ok: true });
    expect(registry.register("session-1", "phone-2", "companion"))
      .toEqual({ ok: true });
    expect(registry.snapshot("session-1")).toEqual({
      audioHost: "host-1",
      companions: ["phone-1", "phone-2"]
    });
  });

  it("rejects a second live audio host until the first is released", () => {
    const registry = new SessionDeviceRegistryV2<string>();
    registry.register("session-1", "host-1", "audio_host");
    expect(registry.register("session-1", "host-2", "audio_host"))
      .toEqual({ ok: false, code: "audio_host_already_connected" });
    expect(registry.release("session-1", "host-1")).toBe(true);
    expect(registry.register("session-1", "host-2", "audio_host"))
      .toEqual({ ok: true });
  });

  it("clears session and global device state", () => {
    const registry = new SessionDeviceRegistryV2<string>();
    registry.register("session-1", "host-1", "audio_host");
    registry.register("session-2", "host-2", "audio_host");
    expect(registry.clearSession("session-1")).toBe(true);
    expect(registry.size).toBe(1);
    expect(registry.clearAll()).toBe(1);
    expect(registry.size).toBe(0);
  });
});
