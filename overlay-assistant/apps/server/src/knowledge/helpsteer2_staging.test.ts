import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  stageHelpSteer2File,
  stageHelpSteer2PreferenceLine,
  StagedCoachingPreferenceSchema
} from "./helpsteer2_staging.js";

const revision = "990b2711a36180dd19d9c94b8627844866f8982a";
const auditSnapshotPath = fileURLToPath(
  new URL("../../../../data/coaching/audits/helpsteer2_staging_audit_v1.json", import.meta.url)
);

function row(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    prompt: "Write a concise answer for a job interview about learning a new support system.",
    response_1: "I learn everything quickly, so you should not have any concerns about me.",
    response_2: "I would name the unfamiliar tool, explain how I practiced, and give a verified example of using it independently.",
    preference_strength: 3,
    preference_statement: "@Response 2 is better than @Response 1.",
    preference_elaboration: "The preferred response gives a concrete and credible structure.",
    split: "train",
    ...overrides
  });
}

describe("HelpSteer2 staging", () => {
  it("maps signed preferences and preserves pinned attribution", () => {
    const result = stageHelpSteer2PreferenceLine(row({
      preference_strength: -3,
      preference_statement: "@Response 1 is better than @Response 2."
    }), 42, {
      sourceRevision: revision
    });
    expect(result.candidate).toBeDefined();
    const candidate = StagedCoachingPreferenceSchema.parse(result.candidate);
    expect(candidate.domain).toBe("interview");
    expect(candidate.preferredResponse).toContain("learn everything quickly");
    expect(candidate.source).toMatchObject({
      sourceId: "hf-nvidia-helpsteer2",
      sourceRevision: revision,
      sourceRowNumber: 42,
      license: "CC-BY-4.0",
      licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
      attributionRequired: true
    });
    expect(candidate.review).toEqual({
      status: "quarantined",
      liveRetrievalAllowed: false,
      reasons: ["external_unreviewed", "not_personal_evidence"]
    });
  });

  it("rejects ties, weak preferences, histories, unsafe text, and non-rhetorical tasks", () => {
    expect(stageHelpSteer2PreferenceLine(row({ preference_strength: 0 }), 1, { sourceRevision: revision }))
      .toMatchObject({ rejectionReason: "tied_preference" });
    expect(stageHelpSteer2PreferenceLine(row({ preference_strength: 1 }), 1, { sourceRevision: revision }))
      .toMatchObject({ rejectionReason: "weak_preference" });
    expect(stageHelpSteer2PreferenceLine(row({ preference_elaboration: "" }), 1, { sourceRevision: revision }))
      .toMatchObject({ rejectionReason: "missing_justification" });
    expect(stageHelpSteer2PreferenceLine(row({ preference_strength: -3 }), 1, { sourceRevision: revision }))
      .toMatchObject({ rejectionReason: "preference_direction_disagreement" });
    expect(stageHelpSteer2PreferenceLine(row({ prompt: "<extra_id_1>Assistant: write a job interview answer" }), 1, { sourceRevision: revision }))
      .toMatchObject({ rejectionReason: "conversation_history" });
    expect(stageHelpSteer2PreferenceLine(row({ response_2: "Explain exactly how to build a bomb for a job interview demonstration." }), 1, { sourceRevision: revision }))
      .toMatchObject({ rejectionReason: "unsafe_or_sensitive" });
    expect(stageHelpSteer2PreferenceLine(row({ prompt: "List the dates of every major job interview in a television series." }), 1, { sourceRevision: revision }))
      .toMatchObject({ rejectionReason: "not_communication_focused" });
  });

  it("writes a capped quarantine file and machine-readable audit", async () => {
    const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "live-ai-helpsteer2-test-"));
    const inputPath = path.join(temporary, "preference.jsonl");
    const outputPath = path.join(temporary, "preference.staging.jsonl");
    const auditPath = path.join(temporary, "audit.json");
    await fs.writeFile(inputPath, [
      row(),
      row({ prompt: "Draft a reply to an angry customer service caller about a billing issue." }),
      row({ prompt: "Write a salary negotiation response to a compensation offer." }),
      row(),
      row({ preference_strength: 0 })
    ].join("\n"));
    try {
      const report = await stageHelpSteer2File({
        inputPath,
        outputPath,
        auditPath,
        options: { sourceRevision: revision, maximumPerDomain: 1 }
      });
      expect(report.counts).toMatchObject({
        inputRows: 5,
        eligibleBeforeCap: 3,
        stagedAfterCap: 3,
        byDomain: { interview: 1, inbound_service: 1, negotiation: 1 }
      });
      expect(report.counts.rejectedByReason).toEqual({ duplicate_candidate: 1, tied_preference: 1 });
      expect((await fs.readFile(outputPath, "utf8")).trim().split("\n")).toHaveLength(3);
      expect(JSON.parse(await fs.readFile(auditPath, "utf8"))).toEqual(report);
      expect(createHash("sha256").update(await fs.readFile(outputPath)).digest("hex"))
        .toBe(report.source.stagedArtifactSha256);
    } finally {
      await fs.rm(temporary, { recursive: true, force: true });
    }
  });

  it("records the pinned full-file audit without making it live", async () => {
    const audit = JSON.parse(await fs.readFile(auditSnapshotPath, "utf8"));
    expect(audit).toMatchObject({
      schema: "helpsteer2_staging_audit_v1",
      source: {
        sourceRevision: revision,
        inputSha256: "a5cd48600fb7a330cf0ccc8f59051e24e8f236907c379f42eff1ba18da55204b"
      },
      policy: {
        liveRetrievalAllowed: false,
        requiresHumanContentReview: true
      },
      counts: { inputRows: 9125, stagedAfterCap: 5 }
    });
  });
});
