import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { MemoryFactInput } from "./personal_memory.js";
import { SlowStyleLearnerV2 } from "./slow_style_profile_v2.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    fs.rm(directory, { recursive: true, force: true })
  ));
});

async function learner() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "live-rhetoric-style-v2-"));
  temporaryDirectories.push(directory);
  const stored: MemoryFactInput[][] = [];
  const instance = new SlowStyleLearnerV2({
    directory,
    upsert: async (facts) => {
      stored.push(facts);
      return { inserted: facts.length, updated: 0, total: facts.length };
    },
    now: () => new Date("2026-07-20T18:00:00.000Z")
  });
  return { directory, stored, instance };
}

describe("SlowStyleLearnerV2", () => {
  it("promotes only after twelve eligible owner turns across three sessions", async () => {
    const { instance, stored } = await learner();
    let lastStatus = "";
    for (let index = 0; index < 12; index += 1) {
      const result = await instance.observe({
        sessionId: `session-${index % 3}`,
        turnId: `turn-${index}`,
        text: "I understand the concern. Let me verify the most important point first.",
        source: "owner_spontaneous"
      });
      lastStatus = result.status;
      if (index < 11) expect(result.status).not.toBe("promoted");
    }

    expect(lastStatus).toBe("promoted");
    expect(stored).toHaveLength(1);
    expect(stored[0]?.[0]).toMatchObject({
      id: "delivery_style_v2_profile",
      category: "communication_style",
      source: { type: "system", ref: "style-profile-v2" },
      userVerified: false
    });
    expect(stored[0]?.[0]?.fact).toContain("response");
  });

  it("stores numeric features but never the owner's exact wording", async () => {
    const { directory, instance } = await learner();
    const privateWording = "My highly distinctive private correction phrase";
    await instance.observe({
      sessionId: "session-1",
      turnId: "turn-1",
      text: privateWording,
      source: "guidance_changed"
    });

    const raw = await fs.readFile(
      path.join(directory, "style_feature_observations_v2.jsonl"),
      "utf8"
    );
    expect(raw).not.toContain(privateWording);
    expect(raw).not.toContain("private correction phrase");
    expect(raw).toContain("wordsPerResponse");
  });

  it("does not learn wording merely accepted from the model", async () => {
    const { instance, stored } = await learner();
    for (let index = 0; index < 15; index += 1) {
      await instance.observe({
        sessionId: `session-${index % 3}`,
        turnId: `turn-${index}`,
        text: "I repeated the suggested model wording exactly.",
        source: "guidance_accepted"
      });
    }
    expect(stored).toEqual([]);
    expect((await instance.profile()).version).toBe(0);
  });

  it("serializes concurrent observations and writes owner-only files", async () => {
    const { directory, instance } = await learner();
    await Promise.all(Array.from({ length: 12 }, (_, index) =>
      instance.observe({
        sessionId: `session-${index % 3}`,
        turnId: `turn-${index}`,
        text: "I hear you. Let us handle the central issue directly.",
        source: "owner_spontaneous"
      })
    ));

    const observationsPath = path.join(directory, "style_feature_observations_v2.jsonl");
    const profilePath = path.join(directory, "style_profile_v2.json");
    expect((await fs.stat(observationsPath)).mode & 0o777).toBe(0o600);
    expect((await fs.stat(profilePath)).mode & 0o777).toBe(0o600);
    expect((await fs.readFile(observationsPath, "utf8")).trim().split("\n"))
      .toHaveLength(12);
  });
});
