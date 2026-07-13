import { describe, expect, it } from "vitest";
import {
  DirectionalSpeakerFusion,
  estimateStereoDirection,
  interpretOwnerVerifierResult,
  type DirectionEstimate,
  type SpeakerFusionEvidence
} from "./directionalSpeaker";

const SAMPLE_RATE = 16_000;
const SAMPLE_COUNT = 4_096;

function noise(seed: number, length = SAMPLE_COUNT): Float32Array {
  let state = seed >>> 0;
  const output = new Float32Array(length);
  for (let index = 0; index < length; index += 1) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    output[index] = ((state >>> 0) / 0xffffffff * 2 - 1) * 0.12;
  }
  return output;
}

function delayedStereo(
  direction: "left" | "right",
  lag = 5,
  attenuation = 0.7,
  seed = 17
): [Float32Array, Float32Array] {
  const source = noise(seed);
  const left = new Float32Array(source.length);
  const right = new Float32Array(source.length);
  for (let index = 0; index < source.length - lag; index += 1) {
    if (direction === "left") {
      left[index] = source[index];
      right[index + lag] = source[index] * attenuation;
    } else {
      right[index] = source[index];
      left[index + lag] = source[index] * attenuation;
    }
  }
  return [left, right];
}

function estimate(direction: "left" | "right"): DirectionEstimate {
  const [left, right] = delayedStereo(direction);
  return estimateStereoDirection(left, right, SAMPLE_RATE);
}

function evidence(overrides: Partial<SpeakerFusionEvidence> = {}): SpeakerFusionEvidence {
  return {
    provenance: "mixed_acoustic",
    direction: estimate("left"),
    voiceIdentity: "owner_verified",
    voiceConfidence: 0.98,
    twoPartyAcousticMode: true,
    ...overrides
  };
}

describe("stereo direction estimation", () => {
  it("combines positive interaural delay and left-channel energy into a left estimate", () => {
    const result = estimate("left");
    expect(result.direction).toBe("left");
    expect(result.reason).toBe("direction_left");
    expect(result.confidence).toBeGreaterThan(0.8);
    expect(result.lagSamples).toBe(5);
    expect(result.lagMicroseconds).toBeCloseTo(312.5);
    expect(result.channelEnergyRatio).toBeGreaterThan(1.4);
    expect(result.peakCorrelation).toBeGreaterThan(0.99);
  });

  it("uses the opposite lag and energy signs for a right estimate", () => {
    const result = estimate("right");
    expect(result.direction).toBe("right");
    expect(result.reason).toBe("direction_right");
    expect(result.confidence).toBeGreaterThan(0.8);
    expect(result.lagSamples).toBe(-5);
    expect(result.channelEnergyRatio).toBeLessThan(0.72);
  });

  it("can identify a centered stereo source without treating exact dual-mono as spatial", () => {
    const source = noise(51);
    const independent = noise(73);
    const right = new Float32Array(source.length);
    for (let index = 0; index < source.length; index += 1) {
      right[index] = source[index] * 0.99 + independent[index] * 0.015;
    }
    const result = estimateStereoDirection(source, right, SAMPLE_RATE);
    expect(result.direction).toBe("center");
    expect(result.reason).toBe("direction_center");
    expect(result.lagSamples).toBe(0);

    const dualMono = estimateStereoDirection(source, new Float32Array(source), SAMPLE_RATE);
    expect(dualMono.direction).toBe("unknown");
    expect(dualMono.reason).toBe("dual_mono");
  });

  it("fails closed for missing mono channels, silence, and short buffers", () => {
    const source = noise(9);
    expect(estimateStereoDirection(source, null, SAMPLE_RATE).reason).toBe("mono_channel_missing");
    expect(
      estimateStereoDirection(new Float32Array(SAMPLE_COUNT), new Float32Array(SAMPLE_COUNT), SAMPLE_RATE).reason
    ).toBe("silence");
    expect(estimateStereoDirection(source.subarray(0, 100), source.subarray(0, 100), SAMPLE_RATE).reason).toBe(
      "too_short"
    );
  });

  it("rejects uncorrelated channel noise", () => {
    const result = estimateStereoDirection(noise(101), noise(202), SAMPLE_RATE);
    expect(result.direction).toBe("unknown");
    expect(result.reason).toBe("weak_correlation");
    expect(result.confidence).toBe(0);
  });

  it("rejects simultaneous sources with similarly strong opposite-delay peaks", () => {
    const first = delayedStereo("left", 5, 0.78, 301);
    const second = delayedStereo("right", 5, 0.78, 902);
    const left = new Float32Array(SAMPLE_COUNT);
    const right = new Float32Array(SAMPLE_COUNT);
    for (let index = 0; index < SAMPLE_COUNT; index += 1) {
      left[index] = first[0][index] + second[0][index];
      right[index] = first[1][index] + second[1][index];
    }
    const result = estimateStereoDirection(left, right, SAMPLE_RATE);
    expect(result.direction).toBe("unknown");
    expect(result.reason).toBe("ambiguous_overlap");
  });

  it("rejects a delay-versus-energy disagreement", () => {
    const [left, right] = delayedStereo("left", 5, 1.25);
    const result = estimateStereoDirection(left, right, SAMPLE_RATE);
    expect(result.direction).toBe("unknown");
    expect(result.reason).toBe("conflicting_cues");
  });
});

describe("directional speaker evidence fusion", () => {
  it("lets dedicated capture and platform identity outrank contradictory direction", () => {
    const fusion = new DirectionalSpeakerFusion();
    const right = estimate("right");
    expect(
      fusion.evaluate(evidence({
        provenance: "owner_mic",
        direction: right,
        voiceIdentity: "owner_mismatch"
      }))
    ).toMatchObject({ speaker: "owner", reason: "dedicated_owner_mic" });
    expect(
      fusion.evaluate(evidence({
        provenance: "browser_tab",
        direction: estimate("left"),
        voiceIdentity: "owner_verified"
      }))
    ).toMatchObject({ speaker: "lead", reason: "dedicated_browser_tab" });
    expect(
      fusion.evaluate(evidence({
        provenance: "platform_identity",
        platformSpeaker: "lead",
        direction: estimate("left"),
        voiceIdentity: "owner_verified"
      }))
    ).toMatchObject({ speaker: "lead", reason: "platform_lead" });
  });

  it("learns owner direction only after three strong verified owner observations", () => {
    const fusion = new DirectionalSpeakerFusion();
    const first = fusion.evaluate(evidence());
    const second = fusion.evaluate(evidence());
    const third = fusion.evaluate(evidence());
    expect(first).toMatchObject({ speaker: "owner", ownerDirection: null, ownerCalibrationObservations: 1 });
    expect(second).toMatchObject({ speaker: "owner", ownerDirection: null, ownerCalibrationObservations: 2 });
    expect(third).toMatchObject({ speaker: "owner", ownerDirection: "left", ownerCalibrationObservations: 3 });
  });

  it("does not calibrate on unverified or weak owner evidence", () => {
    const fusion = new DirectionalSpeakerFusion();
    for (let index = 0; index < 4; index += 1) {
      fusion.evaluate(evidence({ voiceIdentity: "unknown" }));
      fusion.evaluate(evidence({ voiceConfidence: 0.4 }));
    }
    expect(fusion.getCalibration()).toMatchObject({ ownerDirection: null, ownerCalibrationObservations: 0 });
  });

  it("never turns one voice non-match into the lead", () => {
    const fusion = new DirectionalSpeakerFusion();
    for (let index = 0; index < 3; index += 1) fusion.evaluate(evidence());
    const firstNonMatch = fusion.evaluate(evidence({
      direction: estimate("right"),
      voiceIdentity: "owner_mismatch"
    }));
    expect(firstNonMatch).toMatchObject({
      speaker: "unknown",
      reason: "lead_direction_pending",
      leadStabilityObservations: 1
    });
  });

  it("infers a lead only after stable opposite evidence in explicit two-party mode", () => {
    const fusion = new DirectionalSpeakerFusion();
    for (let index = 0; index < 3; index += 1) fusion.evaluate(evidence());
    const opposite = evidence({ direction: estimate("right"), voiceIdentity: "owner_mismatch" });
    expect(fusion.evaluate(opposite).speaker).toBe("unknown");
    expect(fusion.evaluate(opposite)).toMatchObject({
      speaker: "lead",
      reason: "stable_opposite_direction",
      leadStabilityObservations: 2
    });
  });

  it("keeps opposite evidence unknown when two-party acoustic mode is not explicit", () => {
    const fusion = new DirectionalSpeakerFusion();
    for (let index = 0; index < 3; index += 1) fusion.evaluate(evidence());
    const result = fusion.evaluate(evidence({
      direction: estimate("right"),
      voiceIdentity: "owner_mismatch",
      twoPartyAcousticMode: false
    }));
    expect(result).toMatchObject({ speaker: "unknown", reason: "two_party_mode_disabled" });
  });

  it("fails closed when voice identity and calibrated direction conflict", () => {
    const fusion = new DirectionalSpeakerFusion();
    for (let index = 0; index < 3; index += 1) fusion.evaluate(evidence());
    expect(
      fusion.evaluate(evidence({ direction: estimate("right"), voiceIdentity: "owner_verified" }))
    ).toMatchObject({ speaker: "unknown", reason: "owner_direction_conflict" });
    expect(
      fusion.evaluate(evidence({ direction: estimate("left"), voiceIdentity: "owner_mismatch" }))
    ).toMatchObject({ speaker: "unknown", reason: "voice_direction_conflict" });
  });

  it("restarts calibration after repeated verified owner matches from the opposite side", () => {
    const fusion = new DirectionalSpeakerFusion();
    for (let index = 0; index < 3; index += 1) fusion.evaluate(evidence());
    const movedOwner = evidence({ direction: estimate("right"), voiceIdentity: "owner_verified" });
    for (let index = 0; index < 3; index += 1) {
      expect(fusion.evaluate(movedOwner).speaker).toBe("unknown");
    }
    expect(fusion.getCalibration()).toMatchObject({ ownerDirection: null, ownerCalibrationObservations: 1 });
    fusion.evaluate(movedOwner);
    expect(fusion.evaluate(movedOwner)).toMatchObject({ speaker: "owner", ownerDirection: "right" });
  });
});

describe("owner-verifier evidence interpretation", () => {
  it("accepts only an explicit above-threshold owner match", () => {
    expect(interpretOwnerVerifierResult({
      label: "owner",
      similarity: 0.94,
      threshold: 0.9,
      reason: "owner_match",
      decisionPolicy: "owner_or_unknown_only",
      serviceAvailable: true
    })).toMatchObject({ identity: "owner_verified", reason: "verified_owner" });
  });

  it("calls a safely low score an owner mismatch, not a non-owner identity", () => {
    expect(interpretOwnerVerifierResult({
      label: "unknown",
      similarity: 0.62,
      threshold: 0.9,
      reason: "below_owner_threshold",
      decisionPolicy: "owner_or_unknown_only",
      serviceAvailable: true
    })).toMatchObject({ identity: "owner_mismatch", reason: "strong_owner_mismatch" });
  });

  it("keeps near-threshold, unavailable, and malformed results unknown", () => {
    const base = {
      label: "unknown" as const,
      similarity: 0.84,
      threshold: 0.9,
      reason: "below_owner_threshold",
      decisionPolicy: "owner_or_unknown_only"
    };
    expect(interpretOwnerVerifierResult(base).identity).toBe("unknown");
    expect(interpretOwnerVerifierResult({ ...base, similarity: 0.1, serviceAvailable: false }).identity).toBe("unknown");
    expect(interpretOwnerVerifierResult({ ...base, similarity: null }).identity).toBe("unknown");
  });
});
