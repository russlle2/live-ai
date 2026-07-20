import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {
  emptyStyleProfileV2,
  extractStyleFeaturesV2,
  promoteStyleProfileV2,
  type StyleObservationSourceV2,
  type StyleObservationV2,
  type StyleProfileV2,
  type StylePromotionStatusV2
} from "@overlay-assistant/runtime";
import type { MemoryFactInput } from "./personal_memory.js";

const OBSERVATION_FILE = "style_feature_observations_v2.jsonl";
const PROFILE_FILE = "style_profile_v2.json";
const MAX_OBSERVATION_READ_BYTES = 2 * 1024 * 1024;

type UpsertMemory = (
  facts: MemoryFactInput[]
) => Promise<{ inserted: number; updated: number; total: number }>;

export type SlowStyleObservationResult =
  | {
      status: StylePromotionStatusV2 | "duplicate" | "too_short";
      profileVersion: number;
      eligibleObservations: number;
    };

export class SlowStyleLearnerV2 {
  private queue = Promise.resolve();
  private readonly observationsPath: string;
  private readonly profilePath: string;
  private readonly now: () => Date;
  private readonly upsert: UpsertMemory;

  constructor(options: {
    directory: string;
    upsert: UpsertMemory;
    now?: () => Date;
  }) {
    this.observationsPath = path.join(options.directory, OBSERVATION_FILE);
    this.profilePath = path.join(options.directory, PROFILE_FILE);
    this.upsert = options.upsert;
    this.now = options.now ?? (() => new Date());
  }

  async observe(input: {
    sessionId: string;
    turnId: string;
    text: string;
    source: StyleObservationSourceV2;
  }): Promise<SlowStyleObservationResult> {
    const features = extractStyleFeaturesV2(input.text);
    if (!features) {
      const current = await this.profile();
      return {
        status: "too_short",
        profileVersion: current.version,
        eligibleObservations: 0
      };
    }
    const observedAt = this.now().toISOString();
    const observation: StyleObservationV2 = {
      observationId: deterministicObservationId(input.sessionId, input.turnId),
      sessionId: input.sessionId,
      turnId: input.turnId,
      observedAt,
      features,
      source: input.source
    };

    let result: SlowStyleObservationResult | undefined;
    this.queue = this.queue.catch(() => undefined).then(async () => {
      const profile = await this.readProfile();
      const recent = await this.readObservations();
      if (
        profile.evidenceObservationIds.includes(observation.observationId) ||
        recent.some((item) => item.observationId === observation.observationId)
      ) {
        result = {
          status: "duplicate",
          profileVersion: profile.version,
          eligibleObservations: 0
        };
        return;
      }

      await this.appendObservation(observation);
      const promotion = promoteStyleProfileV2(
        profile,
        [...recent, observation],
        observedAt
      );
      if (promotion.status === "promoted") {
        await this.writeProfile(promotion.profile);
        await this.upsert([styleProfileMemoryFact(promotion.profile)]);
      }
      result = {
        status: promotion.status,
        profileVersion: promotion.profile.version,
        eligibleObservations: promotion.eligibleObservations
      };
    });
    await this.queue;
    if (!result) throw new Error("slow style observation did not produce a result");
    return result;
  }

  async profile(): Promise<StyleProfileV2> {
    await this.queue.catch(() => undefined);
    return this.readProfile();
  }

  private async readProfile(): Promise<StyleProfileV2> {
    try {
      const parsed = JSON.parse(await fs.readFile(this.profilePath, "utf8")) as StyleProfileV2;
      // The promotion boundary validates every profile field and returns a clone.
      return promoteStyleProfileV2(parsed, [], this.now().toISOString()).profile;
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
        return emptyStyleProfileV2();
      }
      throw error;
    }
  }

  private async readObservations(): Promise<StyleObservationV2[]> {
    let handle: fs.FileHandle | undefined;
    try {
      handle = await fs.open(this.observationsPath, "r");
      const stat = await handle.stat();
      const bytesToRead = Math.min(stat.size, MAX_OBSERVATION_READ_BYTES);
      const start = Math.max(0, stat.size - bytesToRead);
      const buffer = Buffer.alloc(bytesToRead);
      await handle.read(buffer, 0, bytesToRead, start);
      let text = buffer.toString("utf8");
      if (start > 0) {
        const firstNewline = text.indexOf("\n");
        text = firstNewline >= 0 ? text.slice(firstNewline + 1) : "";
      }
      const observations: StyleObservationV2[] = [];
      for (const line of text.split("\n")) {
        if (!line.trim()) continue;
        try {
          observations.push(JSON.parse(line) as StyleObservationV2);
        } catch {
          // Isolate a crash-truncated line; validation occurs at promotion.
        }
      }
      return observations.slice(-1_000);
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return [];
      throw error;
    } finally {
      await handle?.close();
    }
  }

  private async appendObservation(observation: StyleObservationV2): Promise<void> {
    const directory = path.dirname(this.observationsPath);
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    await fs.chmod(directory, 0o700);
    await fs.appendFile(
      this.observationsPath,
      `${JSON.stringify(observation)}\n`,
      { mode: 0o600 }
    );
    await fs.chmod(this.observationsPath, 0o600);
  }

  private async writeProfile(profile: StyleProfileV2): Promise<void> {
    const directory = path.dirname(this.profilePath);
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    await fs.chmod(directory, 0o700);
    const temporary = `${this.profilePath}.${process.pid}.${Date.now()}.tmp`;
    try {
      await fs.writeFile(temporary, `${JSON.stringify(profile, null, 2)}\n`, {
        mode: 0o600
      });
      await fs.rename(temporary, this.profilePath);
      await fs.chmod(this.profilePath, 0o600);
    } catch (error) {
      await fs.unlink(temporary).catch(() => undefined);
      throw error;
    }
  }
}

function deterministicObservationId(sessionId: string, turnId: string): string {
  const digest = createHash("sha256")
    .update("slow-style-observation-v2\0")
    .update(sessionId)
    .update("\0")
    .update(turnId)
    .digest("hex")
    .slice(0, 24);
  return `style-obs-${digest}`;
}

function styleProfileMemoryFact(profile: StyleProfileV2): MemoryFactInput {
  const responseLength = profile.features.wordsPerResponse <= 16
    ? "concise"
    : profile.features.wordsPerResponse >= 35
      ? "detailed"
      : "balanced-length";
  const directness = profile.features.directness >= 0.65
    ? "direct"
    : profile.features.directness <= 0.4
      ? "reflective"
      : "balanced";
  const warmth = profile.features.warmth >= 0.65
    ? "warm"
    : profile.features.warmth <= 0.4
      ? "reserved"
      : "neutral-warm";
  const questionStyle = profile.features.questionRatio >= 0.35
    ? "question-led"
    : profile.features.questionRatio <= 0.1
      ? "statement-led"
      : "a mix of statements and questions";
  return {
    id: "delivery_style_v2_profile",
    category: "communication_style",
    fact: `Current delivery profile favors ${responseLength}, ${directness}, ${warmth} responses with ${questionStyle}.`,
    keywords: [
      "speaking style",
      "delivery style",
      responseLength,
      directness,
      warmth,
      questionStyle
    ],
    source: {
      type: "system",
      ref: "style-profile-v2",
      timestamp: profile.promotedAt ?? undefined,
      title: "Slow aggregate speaking-style profile"
    },
    confidence: Math.min(0.95, 0.6 + profile.observationCount / 200),
    sensitivity: "normal",
    temporality: "current",
    userVerified: false
  };
}
