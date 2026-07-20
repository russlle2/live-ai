import { describe, expect, it } from "vitest";
import {
  opaqueLogIdentifier,
  storedTelemetryTenantId
} from "./identifiers.js";

describe("opaque observability identifiers", () => {
  const secret = "test-observability-secret-at-least-32-characters";

  it("is stable, domain-separated, and never contains the raw identifier", () => {
    const tenant = opaqueLogIdentifier("tenant", "personal", secret);
    const session = opaqueLogIdentifier("session", "personal", secret);

    expect(tenant).toBe(opaqueLogIdentifier("tenant", "personal", secret));
    expect(tenant).toMatch(/^tenant_[a-f0-9]{20}$/);
    expect(session).toMatch(/^session_[a-f0-9]{20}$/);
    expect(tenant).not.toBe(session);
    expect(tenant).not.toContain("personal");
  });

  it("uses the same opaque tenant key for telemetry writes and trust reads", () => {
    const stored = storedTelemetryTenantId("personal", secret);
    expect(stored).toBe(opaqueLogIdentifier("tenant", "personal", secret));
    expect(stored).not.toBe("personal");
  });

  it("returns undefined only for a missing identifier", () => {
    expect(opaqueLogIdentifier("rep", undefined, secret)).toBeUndefined();
    expect(() => storedTelemetryTenantId("", secret)).toThrow(/tenant/i);
  });
});
