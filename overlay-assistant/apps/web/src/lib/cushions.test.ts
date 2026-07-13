import { describe, expect, it } from "vitest";
import { chooseCushion } from "./cushions";

describe("chooseCushion", () => {
  it("uses an example bridge for behavioral interview questions", () => {
    expect(chooseCushion("interview", "Tell me about a time when you resolved a conflict"))
      .toBe("Absolutely — let me give you a clear example.");
  });

  it("uses a verification bridge for technical trouble", () => {
    expect(chooseCushion("it_support", "My VPN is not working"))
      .toContain("verify the symptom");
  });

  it("always returns a speakable fallback", () => {
    expect(chooseCushion("inbound_service", "hello").length).toBeGreaterThan(20);
  });
});
