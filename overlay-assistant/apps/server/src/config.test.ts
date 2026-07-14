import { describe, expect, it } from "vitest";
import {
  parseBoundedEnvInteger,
  parseStrictEnvBoolean,
  validateDatabaseUrl,
  validateWebOrigin
} from "./config.js";

describe("server startup environment validation", () => {
  it("accepts only finite, bounded base-10 integers", () => {
    expect(parseBoundedEnvInteger("LIMIT", undefined, 5, 1, 10)).toBe(5);
    expect(parseBoundedEnvInteger("LIMIT", " 7 ", 5, 1, 10)).toBe(7);
    for (const invalid of ["NaN", "Infinity", "1e1", "0x5", "2.5", "-1", "11"]) {
      expect(() => parseBoundedEnvInteger("LIMIT", invalid, 5, 1, 10)).toThrow(/LIMIT/);
    }
  });

  it("rejects ambiguous boolean spellings", () => {
    expect(parseStrictEnvBoolean("DB_SSL", "true", false)).toBe(true);
    expect(parseStrictEnvBoolean("DB_SSL", "0", true)).toBe(false);
    expect(() => parseStrictEnvBoolean("DB_SSL", "enabled", false)).toThrow(/DB_SSL/);
  });

  it("prevents connection-string parameters from replacing the TLS policy", () => {
    expect(validateDatabaseUrl("postgres://user:pass@db.example.com/app", true))
      .toBe("postgres://user:pass@db.example.com/app");
    expect(() => validateDatabaseUrl("postgres://db.example.com/app?sslmode=no-verify", true))
      .toThrow(/sslmode/);
    expect(() => validateDatabaseUrl("postgres://127.0.0.1/app", true))
      .toThrow(/DNS hostname/);
    expect(() => validateDatabaseUrl("postgres://db.example.com/app?host=elsewhere.example", true))
      .toThrow(/host query/);
  });

  it("requires an exact secure browser origin and forbids wildcard loopback access", () => {
    expect(validateWebOrigin("http://localhost:5173")).toBe("http://localhost:5173");
    expect(validateWebOrigin("https://rhetoric.example.com")).toBe("https://rhetoric.example.com");
    expect(() => validateWebOrigin("*")).toThrow(/wildcard/i);
    expect(() => validateWebOrigin("http://192.168.1.10:8080")).toThrow(/HTTPS/);
    expect(() => validateWebOrigin("https://rhetoric.example.com/path")).toThrow(/only scheme/i);
  });
});
