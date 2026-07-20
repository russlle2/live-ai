import { describe, expect, it } from "vitest";
import {
  emptyStyleProfileV2,
  extractStyleFeaturesV2,
  pinStylePhraseV2,
  promoteStyleProfileV2,
  rollbackStyleProfileV2,
  type StyleObservationV2
} from "../src/style_profile_v2.js";

function observations(
  count: number,
  sessions: number,
  source: StyleObservationV2["source"] = "owner_spontaneous"
): StyleObservationV2[] {
  return Array.from({ length: count }, (_, index) => ({
    observationId: `obs-${index}`,
    sessionId: `session-${index % sessions}`,
    turnId: `turn-${index}`,
    observedAt: `2026-07-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`,
    features: {
      wordsPerResponse: 10,
      wordsPerSentence: 8,
      questionRatio: 0.2,
      contractionRatio: 0.4,
      acknowledgmentRatio: 0.3,
      hedgeRatio: 0.1,
      directness: 0.8,
      warmth: 0.7
    },
    source
  }));
}

describe("style profile v2", () => {
  it("does not promote before 12 observations across 3 sessions", () => {
    expect(promoteStyleProfileV2(emptyStyleProfileV2(), observations(11, 3)).status)
      .toBe("insufficient_evidence");
    expect(promoteStyleProfileV2(emptyStyleProfileV2(), observations(12, 2)).status)
      .toBe("insufficient_session_diversity");
  });

  it("promotes bounded aggregate features without learning phrases", () => {
    const result = promoteStyleProfileV2(
      emptyStyleProfileV2(),
      observations(12, 3),
      "2026-07-20T18:00:00.000Z"
    );
    expect(result.status).toBe("promoted");
    if (result.status !== "promoted") throw new Error("expected promotion");

    expect(result.profile.version).toBe(1);
    expect(result.profile.observationCount).toBe(12);
    expect(result.profile.sessionCount).toBe(3);
    expect(result.profile.features.directness).toBeCloseTo(0.03);
    expect(result.profile.features.wordsPerResponse).toBeCloseTo(2);
    expect(JSON.stringify(result.profile)).not.toMatch(/phrase|text/i);
  });

  it("ignores duplicates, accepted model wording, and factual corrections", () => {
    const eligible = observations(10, 3);
    const duplicate = { ...eligible[0] };
    const accepted = observations(3, 3, "guidance_accepted").map((item, index) => ({
      ...item,
      observationId: `accepted-${index}`
    }));
    const corrections = observations(3, 3, "factual_correction").map((item, index) => ({
      ...item,
      observationId: `correction-${index}`
    }));
    const result = promoteStyleProfileV2(
      emptyStyleProfileV2(),
      [...eligible, duplicate, ...accepted, ...corrections]
    );

    expect(result.status).toBe("insufficient_evidence");
    expect(result.eligibleObservations).toBe(10);
  });

  it("rejects a batch dominated by one session", () => {
    const values = observations(12, 3).map((item, index) => ({
      ...item,
      sessionId: index < 8 ? "dominant-session" : `session-${index % 3}`
    }));
    expect(promoteStyleProfileV2(emptyStyleProfileV2(), values).status)
      .toBe("session_dominance");
  });

  it("does not promote contradictory style evidence", () => {
    const values = observations(12, 3).map((item, index) => ({
      ...item,
      features: {
        ...item.features,
        directness: index % 2 === 0 ? 0.1 : 0.9,
        warmth: index % 2 === 0 ? 0.9 : 0.1
      }
    }));
    expect(promoteStyleProfileV2(emptyStyleProfileV2(), values).status)
      .toBe("inconsistent_evidence");
  });

  it("rejects non-finite or out-of-range feature evidence", () => {
    const invalid = observations(12, 3);
    invalid[0] = {
      ...invalid[0],
      features: { ...invalid[0].features, warmth: Number.NaN }
    };
    expect(() => promoteStyleProfileV2(emptyStyleProfileV2(), invalid))
      .toThrow(/warmth/i);

    const outOfRange = observations(12, 3);
    outOfRange[0] = {
      ...outOfRange[0],
      features: { ...outOfRange[0].features, questionRatio: 1.1 }
    };
    expect(() => promoteStyleProfileV2(emptyStyleProfileV2(), outOfRange))
      .toThrow(/questionRatio/);
  });

  it("extracts aggregate style without retaining source wording", () => {
    const features = extractStyleFeaturesV2(
      "I understand your concern. Let's verify the facts first, and then I'll answer directly. Does that work?"
    );
    expect(features).not.toBeNull();
    expect(features?.wordsPerResponse).toBeGreaterThan(10);
    expect(features?.questionRatio).toBeGreaterThan(0);
    expect(features?.contractionRatio).toBeGreaterThan(0);
    expect(features).not.toHaveProperty("text");
  });

  it("supports explicit phrase pinning separately from automatic adaptation", () => {
    const pinned = pinStylePhraseV2(
      "Let me make sure I understand the priority first.",
      "2026-07-20T18:00:00.000Z",
      () => "pinned-1"
    );
    expect(pinned).toEqual({
      phraseId: "pinned-1",
      phrase: "Let me make sure I understand the priority first.",
      pinnedAt: "2026-07-20T18:00:00.000Z"
    });
    expect(() => pinStylePhraseV2("   ")).toThrow(/phrase/i);
  });

  it("rolls back by version without mutating profile history", () => {
    const first = promoteStyleProfileV2(
      emptyStyleProfileV2(),
      observations(12, 3),
      "2026-07-20T18:00:00.000Z"
    );
    if (first.status !== "promoted") throw new Error("expected first promotion");
    const secondObservations = observations(12, 3).map((item, index) => ({
      ...item,
      observationId: `next-${index}`
    }));
    const second = promoteStyleProfileV2(
      first.profile,
      secondObservations,
      "2026-07-21T18:00:00.000Z"
    );
    if (second.status !== "promoted") throw new Error("expected second promotion");
    const history = [first.profile, second.profile];
    const before = structuredClone(history);

    expect(rollbackStyleProfileV2(history, 1)).toEqual(first.profile);
    expect(history).toEqual(before);
    expect(() => rollbackStyleProfileV2(history, 9)).toThrow(/version/i);
  });
});
