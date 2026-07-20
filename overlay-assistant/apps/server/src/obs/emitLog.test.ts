import { describe, expect, it } from "vitest";
import { opaqueLogIdentifier, sanitizeLogData } from "./emitLog.js";

describe("observability privacy", () => {
  it("replaces personal and credential-looking values regardless of field name", () => {
    const result = JSON.stringify(sanitizeLogData({
      note: "Contact person@example.test at 212-555-0199 with API key: sk-proj-abcdefghijklmnop",
      url: "https://example.test/callback?safe=yes&token=secret-value",
      nested: { harmlessName: "Bearer abcdefghijklmnopqrstuvwxyz" }
    }));
    expect(result).not.toContain("person@example.test");
    expect(result).not.toContain("212-555-0199");
    expect(result).not.toContain("sk-proj-abcdefghijklmnop");
    expect(result).not.toContain("secret-value");
    expect(result).not.toContain("abcdefghijklmnopqrstuvwxyz");
  });

  it("uses stable opaque identifiers instead of raw client identifiers", () => {
    const first = opaqueLogIdentifier("session", "personal-session-name");
    expect(first).toBe(opaqueLogIdentifier("session", "personal-session-name"));
    expect(first).not.toContain("personal-session-name");
    expect(first).not.toBe(opaqueLogIdentifier("session", "another-session"));
  });

  it("keeps numeric token metrics while redacting credential-bearing token fields", () => {
    expect(sanitizeLogData({
      promptTokens: 10,
      completionTokens: 5,
      totalTokens: 15,
      tokensUsed: 15,
      accessToken: "private-access-token"
    })).toEqual({
      promptTokens: 10,
      completionTokens: 5,
      totalTokens: 15,
      tokensUsed: 15,
      accessToken: "[redacted]"
    });
  });
});
