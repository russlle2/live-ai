export type AcousticDirection = "left" | "center" | "right" | "unknown";

export type DirectionEstimateReason =
  | "direction_left"
  | "direction_center"
  | "direction_right"
  | "mono_channel_missing"
  | "dual_mono"
  | "invalid_sample_rate"
  | "channel_length_mismatch"
  | "too_short"
  | "silence"
  | "ambiguous_overlap"
  | "weak_correlation"
  | "conflicting_cues";

export type DirectionEstimate = {
  direction: AcousticDirection;
  confidence: number;
  /** Positive means the right channel arrived later, so the source is on the left. */
  lagSamples: number;
  lagMicroseconds: number;
  /** Left-channel RMS divided by right-channel RMS. Null when no stereo pair exists. */
  channelEnergyRatio: number | null;
  peakCorrelation: number;
  reason: DirectionEstimateReason;
};

export type DirectionEstimatorOptions = {
  minDurationMs?: number;
  maxAnalysisMs?: number;
  maxLagMicroseconds?: number;
  centerLagMicroseconds?: number;
  minRms?: number;
  minCorrelation?: number;
  minSideEnergyDb?: number;
  maxCenterEnergyDb?: number;
};

type RequiredEstimatorOptions = Required<DirectionEstimatorOptions>;

const DEFAULT_ESTIMATOR_OPTIONS: RequiredEstimatorOptions = {
  minDurationMs: 60,
  maxAnalysisMs: 750,
  maxLagMicroseconds: 900,
  centerLagMicroseconds: 45,
  minRms: 0.004,
  minCorrelation: 0.56,
  minSideEnergyDb: 0.75,
  maxCenterEnergyDb: 1.5
};

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function unknownEstimate(
  reason: DirectionEstimateReason,
  details: Partial<Omit<DirectionEstimate, "direction" | "reason">> = {}
): DirectionEstimate {
  return {
    direction: "unknown",
    confidence: 0,
    lagSamples: details.lagSamples ?? 0,
    lagMicroseconds: details.lagMicroseconds ?? 0,
    channelEnergyRatio: details.channelEnergyRatio ?? null,
    peakCorrelation: details.peakCorrelation ?? 0,
    reason
  };
}

function rms(samples: Float32Array, start: number, length: number): number {
  let squared = 0;
  for (let index = start; index < start + length; index += 1) {
    squared += samples[index] * samples[index];
  }
  return length ? Math.sqrt(squared / length) : 0;
}

function normalizedCorrelation(
  left: Float32Array,
  right: Float32Array,
  start: number,
  length: number,
  lag: number
): number {
  const leftOffset = lag < 0 ? start - lag : start;
  const rightOffset = lag > 0 ? start + lag : start;
  const count = length - Math.abs(lag);
  if (count < 2) return 0;

  let leftSum = 0;
  let rightSum = 0;
  let leftSquared = 0;
  let rightSquared = 0;
  let product = 0;
  for (let index = 0; index < count; index += 1) {
    const leftValue = left[leftOffset + index];
    const rightValue = right[rightOffset + index];
    leftSum += leftValue;
    rightSum += rightValue;
    leftSquared += leftValue * leftValue;
    rightSquared += rightValue * rightValue;
    product += leftValue * rightValue;
  }

  const covariance = product - leftSum * rightSum / count;
  const leftVariance = leftSquared - leftSum * leftSum / count;
  const rightVariance = rightSquared - rightSum * rightSum / count;
  const denominator = Math.sqrt(Math.max(0, leftVariance) * Math.max(0, rightVariance));
  return denominator > 1e-12 ? covariance / denominator : 0;
}

function validateOptions(options: DirectionEstimatorOptions): RequiredEstimatorOptions {
  const merged = { ...DEFAULT_ESTIMATOR_OPTIONS, ...options };
  if (
    merged.minDurationMs < 20 ||
    merged.maxAnalysisMs < merged.minDurationMs ||
    merged.maxAnalysisMs > 2_000 ||
    merged.maxLagMicroseconds < 100 ||
    merged.maxLagMicroseconds > 2_000 ||
    merged.centerLagMicroseconds < 0 ||
    merged.centerLagMicroseconds >= merged.maxLagMicroseconds ||
    merged.minRms <= 0 ||
    merged.minCorrelation <= 0 ||
    merged.minCorrelation >= 1
  ) {
    throw new Error("Directional-audio estimator options are invalid.");
  }
  return merged;
}

/**
 * Estimates an acoustic source direction from a bounded window of stereo PCM.
 * It combines interaural delay and channel energy, and returns unknown whenever
 * those independent cues conflict or the stereo evidence is not trustworthy.
 */
export function estimateStereoDirection(
  left: Float32Array,
  right: Float32Array | null | undefined,
  sampleRate: number,
  options: DirectionEstimatorOptions = {}
): DirectionEstimate {
  if (!Number.isFinite(sampleRate) || sampleRate < 8_000 || sampleRate > 192_000) {
    return unknownEstimate("invalid_sample_rate");
  }
  if (!right) return unknownEstimate("mono_channel_missing");
  if (left.length !== right.length) return unknownEstimate("channel_length_mismatch");

  const config = validateOptions(options);
  const minSamples = Math.ceil(sampleRate * config.minDurationMs / 1_000);
  if (left.length < minSamples) return unknownEstimate("too_short");

  const analysisLength = Math.min(left.length, Math.ceil(sampleRate * config.maxAnalysisMs / 1_000));
  const analysisStart = Math.floor((left.length - analysisLength) / 2);
  const leftRms = rms(left, analysisStart, analysisLength);
  const rightRms = rms(right, analysisStart, analysisLength);
  const energyRatio = rightRms > 1e-12 ? leftRms / rightRms : leftRms > 1e-12 ? 1e6 : 1;
  if (Math.max(leftRms, rightRms) < config.minRms) {
    return unknownEstimate("silence", { channelEnergyRatio: energyRatio });
  }

  // Exact or near-exact channel duplication is dual-mono, not directional stereo.
  let differenceSquared = 0;
  for (let index = analysisStart; index < analysisStart + analysisLength; index += 1) {
    const difference = left[index] - right[index];
    differenceSquared += difference * difference;
  }
  const differenceRms = Math.sqrt(differenceSquared / analysisLength);
  if (differenceRms / Math.max(leftRms, rightRms, 1e-12) < 0.001) {
    return unknownEstimate("dual_mono", {
      channelEnergyRatio: energyRatio,
      peakCorrelation: 1
    });
  }

  const maxLagSamples = Math.max(1, Math.min(128, Math.round(sampleRate * config.maxLagMicroseconds / 1e6)));
  const correlations: Array<{ lag: number; correlation: number }> = [];
  for (let lag = -maxLagSamples; lag <= maxLagSamples; lag += 1) {
    correlations.push({
      lag,
      correlation: normalizedCorrelation(left, right, analysisStart, analysisLength, lag)
    });
  }
  correlations.sort((first, second) => second.correlation - first.correlation);
  const peak = correlations[0] ?? { lag: 0, correlation: 0 };
  const lagMicroseconds = peak.lag * 1e6 / sampleRate;
  const details = {
    lagSamples: peak.lag,
    lagMicroseconds,
    channelEnergyRatio: energyRatio,
    peakCorrelation: peak.correlation
  };

  const sideLagSamples = Math.max(1, Math.floor(sampleRate * config.centerLagMicroseconds / 1e6) + 1);
  const positivePeak = correlations
    .filter(({ lag }) => lag >= sideLagSamples)
    .reduce((best, current) => current.correlation > best ? current.correlation : best, -1);
  const negativePeak = correlations
    .filter(({ lag }) => lag <= -sideLagSamples)
    .reduce((best, current) => current.correlation > best ? current.correlation : best, -1);
  const overlapFloor = Math.max(0.42, config.minCorrelation * 0.8);
  if (
    positivePeak >= overlapFloor &&
    negativePeak >= overlapFloor &&
    Math.abs(positivePeak - negativePeak) <= 0.08
  ) {
    return unknownEstimate("ambiguous_overlap", details);
  }

  if (peak.correlation < config.minCorrelation) return unknownEstimate("weak_correlation", details);

  const secondary = correlations.find(
    ({ lag }) => Math.abs(lag - peak.lag) > Math.max(2, Math.ceil(sampleRate * 35 / 1e6))
  );
  const peakMargin = peak.correlation - (secondary?.correlation ?? 0);
  const energyDb = 20 * Math.log10(Math.max(energyRatio, 1e-6));
  const isCenterLag = Math.abs(lagMicroseconds) <= config.centerLagMicroseconds;
  const isCenterEnergy = Math.abs(energyDb) <= config.maxCenterEnergyDb;

  const correlationConfidence = clamp01((peak.correlation - config.minCorrelation) / (1 - config.minCorrelation));
  const uniquenessConfidence = clamp01((peakMargin - 0.025) / 0.22);
  if (isCenterLag && isCenterEnergy) {
    return {
      direction: "center",
      confidence: clamp01(0.75 * correlationConfidence + 0.25 * uniquenessConfidence),
      ...details,
      reason: "direction_center"
    };
  }

  const timeDirection: Exclude<AcousticDirection, "center" | "unknown"> = peak.lag > 0 ? "left" : "right";
  const energyDirection = energyDb >= config.minSideEnergyDb
    ? "left"
    : energyDb <= -config.minSideEnergyDb
      ? "right"
      : "center";
  if (isCenterLag || energyDirection !== timeDirection) {
    return unknownEstimate("conflicting_cues", details);
  }

  const energyConfidence = clamp01((Math.abs(energyDb) - config.minSideEnergyDb) / 4);
  const lagConfidence = clamp01((Math.abs(lagMicroseconds) - config.centerLagMicroseconds) / 300);
  const confidence = clamp01(
    0.55 * correlationConfidence +
    0.2 * uniquenessConfidence +
    0.15 * energyConfidence +
    0.1 * lagConfidence
  );
  return {
    direction: timeDirection,
    confidence,
    ...details,
    reason: timeDirection === "left" ? "direction_left" : "direction_right"
  };
}

export type CaptureProvenance =
  | "owner_mic"
  | "browser_tab"
  | "platform_identity"
  | "mixed_acoustic"
  | "unknown";

export type SpeakerLabel = "owner" | "lead" | "unknown";
export type VoiceIdentity = "owner_verified" | "owner_mismatch" | "unknown";

export type OwnerVerifierResult = {
  label?: "owner" | "unknown";
  similarity?: number | null;
  threshold?: number | null;
  reason?: string;
  decisionPolicy?: string;
  serviceAvailable?: boolean;
};

export type OwnerVoiceEvidence = {
  identity: VoiceIdentity;
  confidence: number;
  reason: "verified_owner" | "strong_owner_mismatch" | "insufficient_owner_evidence";
};

/**
 * Interprets the one-owner verifier without pretending it identifies a second
 * person. A safely below-threshold score is only an owner mismatch; it becomes
 * a lead later, and only with explicit two-person mode plus stable direction.
 */
export function interpretOwnerVerifierResult(
  result: OwnerVerifierResult,
  minimumMismatchMargin = 0.12
): OwnerVoiceEvidence {
  if (!Number.isFinite(minimumMismatchMargin) || minimumMismatchMargin < 0.08 || minimumMismatchMargin > 0.5) {
    throw new Error("Owner-verifier mismatch margin is invalid.");
  }
  const similarity = typeof result.similarity === "number" && Number.isFinite(result.similarity)
    ? result.similarity
    : null;
  const threshold = typeof result.threshold === "number" && Number.isFinite(result.threshold)
    ? result.threshold
    : null;
  const usable = result.serviceAvailable !== false
    && result.decisionPolicy === "owner_or_unknown_only"
    && similarity !== null
    && threshold !== null;
  if (
    usable &&
    result.label === "owner" &&
    result.reason === "owner_match" &&
    similarity >= threshold
  ) {
    return {
      identity: "owner_verified",
      confidence: clamp01(similarity),
      reason: "verified_owner"
    };
  }
  const mismatch = usable && result.label === "unknown" && result.reason === "below_owner_threshold"
    ? threshold - similarity
    : 0;
  if (mismatch >= minimumMismatchMargin) {
    return {
      identity: "owner_mismatch",
      confidence: clamp01(0.85 + 0.15 * (mismatch - minimumMismatchMargin) / Math.max(0.01, 1 - minimumMismatchMargin)),
      reason: "strong_owner_mismatch"
    };
  }
  return {
    identity: "unknown",
    confidence: 0,
    reason: "insufficient_owner_evidence"
  };
}

export type SpeakerFusionEvidence = {
  provenance: CaptureProvenance;
  direction: DirectionEstimate;
  voiceIdentity: VoiceIdentity;
  voiceConfidence: number;
  /** Required when provenance is platform_identity. */
  platformSpeaker?: SpeakerLabel;
  platformConfidence?: number;
  /** Must be explicitly true before mixed-room direction may infer a lead. */
  twoPartyAcousticMode?: boolean;
};

export type SpeakerFusionReason =
  | "dedicated_owner_mic"
  | "dedicated_browser_tab"
  | "platform_owner"
  | "platform_lead"
  | "platform_identity_unknown"
  | "verified_owner_voice"
  | "owner_direction_confirmed"
  | "owner_calibration_pending"
  | "owner_direction_conflict"
  | "two_party_mode_disabled"
  | "owner_direction_not_calibrated"
  | "lead_direction_pending"
  | "stable_opposite_direction"
  | "voice_direction_conflict"
  | "insufficient_evidence";

export type SpeakerFusionResult = {
  speaker: SpeakerLabel;
  confidence: number;
  reason: SpeakerFusionReason;
  ownerDirection: "left" | "right" | null;
  ownerCalibrationObservations: number;
  leadStabilityObservations: number;
};

export type DirectionalSpeakerFusionOptions = {
  ownerCalibrationObservations?: number;
  leadStabilityObservations?: number;
  strongDirectionConfidence?: number;
  strongVoiceConfidence?: number;
};

type SideDirection = "left" | "right";

/**
 * Fuses capture provenance, owner-voice verification and calibrated direction.
 * Direction is deliberately incapable of turning one voice non-match into a lead.
 */
export class DirectionalSpeakerFusion {
  private readonly ownerCalibrationTarget: number;
  private readonly leadStabilityTarget: number;
  private readonly strongDirectionConfidence: number;
  private readonly strongVoiceConfidence: number;
  private ownerDirection: SideDirection | null = null;
  private ownerCandidate: SideDirection | null = null;
  private ownerCandidateCount = 0;
  private ownerConflictCandidate: SideDirection | null = null;
  private ownerConflictCount = 0;
  private leadCandidate: SideDirection | null = null;
  private leadCandidateCount = 0;

  constructor(options: DirectionalSpeakerFusionOptions = {}) {
    this.ownerCalibrationTarget = options.ownerCalibrationObservations ?? 3;
    this.leadStabilityTarget = options.leadStabilityObservations ?? 2;
    this.strongDirectionConfidence = options.strongDirectionConfidence ?? 0.75;
    this.strongVoiceConfidence = options.strongVoiceConfidence ?? 0.85;
    if (
      this.ownerCalibrationTarget < 3 ||
      this.leadStabilityTarget < 2 ||
      this.strongDirectionConfidence < 0.5 ||
      this.strongDirectionConfidence > 1 ||
      this.strongVoiceConfidence < 0.5 ||
      this.strongVoiceConfidence > 1
    ) {
      throw new Error("Directional speaker fusion options are invalid.");
    }
  }

  evaluate(evidence: SpeakerFusionEvidence): SpeakerFusionResult {
    if (evidence.provenance === "owner_mic") {
      return this.result("owner", 1, "dedicated_owner_mic");
    }
    if (evidence.provenance === "browser_tab") {
      return this.result("lead", 1, "dedicated_browser_tab");
    }
    if (evidence.provenance === "platform_identity") {
      if (evidence.platformSpeaker === "owner") {
        return this.result("owner", clamp01(evidence.platformConfidence ?? 1), "platform_owner");
      }
      if (evidence.platformSpeaker === "lead") {
        return this.result("lead", clamp01(evidence.platformConfidence ?? 1), "platform_lead");
      }
      return this.result("unknown", 0, "platform_identity_unknown");
    }
    if (evidence.provenance !== "mixed_acoustic") {
      this.resetLeadCandidate();
      return this.result("unknown", 0, "insufficient_evidence");
    }

    const strongVoice = evidence.voiceConfidence >= this.strongVoiceConfidence;
    const sideDirection = this.strongSideDirection(evidence.direction);
    if (evidence.voiceIdentity === "owner_verified" && strongVoice) {
      if (this.ownerDirection && sideDirection && sideDirection !== this.ownerDirection) {
        this.resetLeadCandidate();
        this.observeOwnerConflict(sideDirection);
        return this.result("unknown", 0, "owner_direction_conflict");
      }
      this.resetOwnerConflict();
      if (!this.ownerDirection && sideDirection) this.observeOwnerDirection(sideDirection);
      this.resetLeadCandidate();
      if (this.ownerDirection && sideDirection === this.ownerDirection) {
        return this.result(
          "owner",
          Math.min(evidence.voiceConfidence, evidence.direction.confidence),
          "owner_direction_confirmed"
        );
      }
      return this.result(
        "owner",
        evidence.voiceConfidence,
        this.ownerDirection ? "verified_owner_voice" : "owner_calibration_pending"
      );
    }

    if (!evidence.twoPartyAcousticMode) {
      this.resetLeadCandidate();
      return this.result("unknown", 0, "two_party_mode_disabled");
    }
    if (!this.ownerDirection) {
      this.resetLeadCandidate();
      return this.result("unknown", 0, "owner_direction_not_calibrated");
    }
    if (evidence.voiceIdentity !== "owner_mismatch" || !strongVoice || !sideDirection) {
      this.resetLeadCandidate();
      return this.result("unknown", 0, "insufficient_evidence");
    }
    if (sideDirection === this.ownerDirection) {
      this.resetLeadCandidate();
      return this.result("unknown", 0, "voice_direction_conflict");
    }

    if (this.leadCandidate === sideDirection) this.leadCandidateCount += 1;
    else {
      this.leadCandidate = sideDirection;
      this.leadCandidateCount = 1;
    }
    if (this.leadCandidateCount < this.leadStabilityTarget) {
      return this.result("unknown", 0, "lead_direction_pending");
    }
    return this.result(
      "lead",
      Math.min(evidence.voiceConfidence, evidence.direction.confidence),
      "stable_opposite_direction"
    );
  }

  getCalibration(): Pick<
    SpeakerFusionResult,
    "ownerDirection" | "ownerCalibrationObservations" | "leadStabilityObservations"
  > {
    return {
      ownerDirection: this.ownerDirection,
      ownerCalibrationObservations: this.ownerCandidateCount,
      leadStabilityObservations: this.leadCandidateCount
    };
  }

  reset(): void {
    this.ownerDirection = null;
    this.ownerCandidate = null;
    this.ownerCandidateCount = 0;
    this.resetOwnerConflict();
    this.resetLeadCandidate();
  }

  private strongSideDirection(direction: DirectionEstimate): SideDirection | null {
    if (direction.confidence < this.strongDirectionConfidence) return null;
    return direction.direction === "left" || direction.direction === "right" ? direction.direction : null;
  }

  private observeOwnerDirection(direction: SideDirection): void {
    if (this.ownerCandidate === direction) this.ownerCandidateCount += 1;
    else {
      this.ownerCandidate = direction;
      this.ownerCandidateCount = 1;
    }
    if (this.ownerCandidateCount >= this.ownerCalibrationTarget) this.ownerDirection = direction;
  }

  private resetLeadCandidate(): void {
    this.leadCandidate = null;
    this.leadCandidateCount = 0;
  }

  private observeOwnerConflict(direction: SideDirection): void {
    if (this.ownerConflictCandidate === direction) this.ownerConflictCount += 1;
    else {
      this.ownerConflictCandidate = direction;
      this.ownerConflictCount = 1;
    }
    // A moved/rotated device must re-learn instead of permanently trusting the
    // old side. Three consecutive strong owner matches are required to begin a
    // fresh calibration, and every conflicting turn remains Unknown.
    if (this.ownerConflictCount >= this.ownerCalibrationTarget) {
      this.ownerDirection = null;
      this.ownerCandidate = direction;
      this.ownerCandidateCount = 1;
      this.resetOwnerConflict();
    }
  }

  private resetOwnerConflict(): void {
    this.ownerConflictCandidate = null;
    this.ownerConflictCount = 0;
  }

  private result(speaker: SpeakerLabel, confidence: number, reason: SpeakerFusionReason): SpeakerFusionResult {
    return {
      speaker,
      confidence: clamp01(confidence),
      reason,
      ownerDirection: this.ownerDirection,
      ownerCalibrationObservations: this.ownerCandidateCount,
      leadStabilityObservations: this.leadCandidateCount
    };
  }
}
