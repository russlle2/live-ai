import { describe, expect, it } from "vitest";
import {
  categorizeMemoryFacts,
  memoryReviewReasons,
  normalizeMemoryFact,
  prepareVerifiedMemoryFact,
  type MemoryFact
} from "./memoryReview";

function fact(overrides: Partial<MemoryFact> = {}): MemoryFact {
  return {
    id: "fact-1",
    category: "skills",
    fact: "I troubleshoot Windows and network connectivity issues.",
    keywords: ["windows", "network"],
    source: { type: "conversation", ref: "session:one", title: "Practice session" },
    confidence: 0.91,
    sensitivity: "normal",
    temporality: "durable",
    userVerified: true,
    createdAt: "2026-07-01T10:00:00.000Z",
    updatedAt: "2026-07-02T10:00:00.000Z",
    ...overrides
  };
}

describe("normalizeMemoryFact", () => {
  it("keeps only display-safe fields and bounds untrusted values", () => {
    const normalized = normalizeMemoryFact({
      ...fact(),
      confidence: 4,
      category: "not-a-category",
      sensitivity: "unexpected",
      keywords: ["network", "network", 12, " review:needs_review "],
      hiddenSecret: "must-not-enter-the-view-model"
    });

    expect(normalized).toMatchObject({
      category: "other",
      confidence: 1,
      sensitivity: "normal",
      keywords: ["network", "review:needs_review"]
    });
    expect(normalized).not.toHaveProperty("hiddenSecret");
  });

  it("omits malformed rows instead of rendering them", () => {
    expect(normalizeMemoryFact(null)).toBeNull();
    expect(normalizeMemoryFact({ id: "", fact: "valid text" })).toBeNull();
    expect(normalizeMemoryFact({ id: "fact", fact: "x" })).toBeNull();
  });
});

describe("memory review categorization", () => {
  it("separates owner-verified facts from every unverified or review-flagged fact", () => {
    const categorized = categorizeMemoryFacts([
      fact({ id: "verified" }),
      fact({ id: "unverified", userVerified: false }),
      fact({ id: "flagged", keywords: ["review:needs_review"] }),
      { malformed: true }
    ]);

    expect(categorized.confirmedReviewClear.map((item) => item.id)).toEqual(["verified"]);
    expect(categorized.needsReview.map((item) => item.id).sort()).toEqual(["flagged", "unverified"]);
  });

  it("turns internal review flags into concise reasons without exposing conflict identifiers", () => {
    const reasons = memoryReviewReasons(fact({
      userVerified: false,
      keywords: [
        "review:low_confidence",
        "review:conflicts_with:google_private_identifier",
        "review:drive_authorship_unverified"
      ]
    }));

    expect(reasons).toEqual([
      "Not yet verified by you",
      "Low-confidence extraction",
      "Conflicts with another stored fact",
      "Drive authorship is unverified"
    ]);
    expect(reasons.join(" ")).not.toContain("google_private_identifier");
  });
});

describe("prepareVerifiedMemoryFact", () => {
  it("uses the correction, resolves review flags, and preserves ordinary search keywords and provenance", () => {
    const prepared = prepareVerifiedMemoryFact(fact({
      userVerified: false,
      keywords: ["network", "review:needs_review", "review:sensitive_review"]
    }), "  I support Windows 11 and wired network troubleshooting.  ");

    expect(prepared).toMatchObject({
      id: "fact-1",
      fact: "I support Windows 11 and wired network troubleshooting.",
      keywords: ["network"],
      userVerified: true,
      source: { type: "conversation", ref: "session:one", title: "Practice session" }
    });
    expect(prepared).not.toHaveProperty("createdAt");
    expect(prepared).not.toHaveProperty("updatedAt");
  });
});
