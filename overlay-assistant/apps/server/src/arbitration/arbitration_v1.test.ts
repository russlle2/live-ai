import { describe, expect, it } from "vitest";
import type { GuidanceControls } from "@overlay-assistant/shared";
import { arbitrateV1 } from "./arbitration_v1.js";

const controls: GuidanceControls = {
  guidanceMode: "assist",
  guidanceMuted: false,
  aiDepth: "P0",
  showLowConfidence: false
};

describe("arbitration cache isolation", () => {
  it("does not reuse a cached speaker attribution", () => {
    const text = "The unique cache-isolation price is too expensive and I am worried.";
    const lead = arbitrateV1({
      text,
      controls,
      domainKeywords: ["pricing"],
      speaker: "lead"
    });
    const owner = arbitrateV1({
      text,
      controls,
      domainKeywords: ["pricing"],
      speaker: "rep"
    });

    expect(lead.trace.speaker).toBe("lead");
    expect(owner.trace.speaker).toBe("rep");
    expect(owner.trace.cacheHit).toBe(false);
  });

  it("includes domain evidence in cache identity", () => {
    const text = "Could you explain zephyrcache?";
    const withoutDomain = arbitrateV1({
      text,
      controls,
      domainKeywords: [],
      speaker: "lead"
    });
    const withDomain = arbitrateV1({
      text,
      controls,
      domainKeywords: ["zephyrcache"],
      speaker: "lead"
    });

    expect(withoutDomain.items).toHaveLength(0);
    expect(withDomain.items).toHaveLength(1);
    expect(withDomain.trace.cacheHit).toBe(false);
  });
});
