import { describe, expect, it } from "vitest";
import {
  getDeterministicCushion,
  getDeterministicFallback,
  selectDeterministicGuidance,
  shouldCoachSpeaker
} from "./live_fallback_v1.js";
import { TEMPLATE_RULES } from "./templates_v1.js";

describe("live coaching fallbacks", () => {
  it("coaches only a verified remote/lead channel", () => {
    expect(shouldCoachSpeaker("lead")).toBe(true);
    expect(shouldCoachSpeaker("rep")).toBe(false);
    expect(shouldCoachSpeaker("unknown")).toBe(false);
  });

  it("provides immediate, speakable mode-specific cushions", () => {
    expect(getDeterministicCushion("interview")).toMatch(/^Say:/);
    expect(getDeterministicCushion("it_support")).not.toBe(
      getDeterministicCushion("insurance_sales")
    );
  });

  it("keeps deterministic and legacy fallbacks speakable and free of invented marketing proof", () => {
    expect(getDeterministicFallback("interview")).not.toMatch(/coverage|monthly cost/i);
    expect(TEMPLATE_RULES.every((rule) => rule.text.startsWith("Say:"))).toBe(true);
    expect(TEMPLATE_RULES.map((rule) => rule.text).join("\n")).not.toMatch(
      /3x return|SOC 2 report|plug right into|real results within|cut their process time in half/i
    );
  });

  it("uses turn-specific arbitration before the generic playbook line", () => {
    expect(selectDeterministicGuidance(
      [{ text: "Say: “What part of the price concerns you most?”" }],
      "Say: “Let me ask a general question.”"
    )).toContain("price concerns");
    expect(selectDeterministicGuidance(
      [],
      "Say: “Let me ask a general question.”"
    )).toBe("Say: “Let me ask a general question.”");
  });
});
