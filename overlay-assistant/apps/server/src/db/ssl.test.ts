import { describe, expect, it, vi } from "vitest";
import { buildDatabaseSslOptions } from "./ssl.js";

describe("database TLS policy", () => {
  it("explicitly disables TLS for the local database", () => {
    expect(buildDatabaseSslOptions({ enabled: false })).toBe(false);
  });

  it("uses verified TLS and the system trust store by default", () => {
    expect(buildDatabaseSslOptions({ enabled: true })).toEqual({
      rejectUnauthorized: true,
      minVersion: "TLSv1.2"
    });
  });

  it("loads a configured CA without weakening certificate verification", () => {
    const readTextFile = vi.fn(() => "-----BEGIN CERTIFICATE-----\ntest\n-----END CERTIFICATE-----\n");
    expect(buildDatabaseSslOptions({ enabled: true, caFile: "/private/ca.pem" }, readTextFile))
      .toMatchObject({ rejectUnauthorized: true, ca: expect.stringContaining("BEGIN CERTIFICATE") });
    expect(readTextFile).toHaveBeenCalledWith("/private/ca.pem");
  });

  it("rejects empty custom CA files and disabled-TLS ambiguity", () => {
    expect(() => buildDatabaseSslOptions({ enabled: true, caFile: "/empty.pem" }, () => " \n"))
      .toThrow(/at least one trusted CA/);
    expect(() => buildDatabaseSslOptions({ enabled: false, caFile: "/ca.pem" }))
      .toThrow(/disabled/);
  });
});
