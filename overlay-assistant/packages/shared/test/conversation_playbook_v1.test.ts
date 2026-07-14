import { describe, expect, it } from "vitest";
import type { ScenarioModeV1, SessionProfileV1 } from "../src/types/session_v1";
import {
  buildConversationPlaybookV1,
  getInitialGreetingV1,
  inferPlaybookStageIdV1,
  selectNextPlaybookStageV1
} from "../src/playbook/conversation_playbook_v1";

const MODES: ScenarioModeV1[] = [
  "interview",
  "insurance_sales",
  "it_support",
  "inbound_service",
  "negotiation",
  "general"
];

function profile(mode: ScenarioModeV1): SessionProfileV1 {
  return { mode, targetRole: "IT Support Specialist", company: "Example Co" };
}

describe("conversation playbook v1", () => {
  it.each(MODES)("builds an ordered greeting-to-goodbye script for %s", (mode) => {
    const result = buildConversationPlaybookV1(profile(mode));

    expect(result.schema).toBe("conversation_playbook_v1");
    expect(result.mode).toBe(mode);
    expect(result.stages).toHaveLength(7);
    expect(result.stages.map(({ id }) => id)).toEqual([
      "greeting",
      "rapport",
      "discovery",
      "proof",
      "questions",
      "close",
      "goodbye"
    ]);
    expect(result.stages.map(({ order }) => order)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(result.stages.every(({ say }) => say.length > 20)).toBe(true);
    expect(result.stages.map(({ say }) => say).join(" ")).not.toMatch(/[\[\]<>]/);
  });

  it("uses only supplied interview labels and falls back cleanly when absent", () => {
    expect(getInitialGreetingV1(profile("interview"))).toContain(
      "IT Support Specialist role at Example Co"
    );

    const generic = getInitialGreetingV1({ mode: "interview" });
    expect(generic).toBe(
      "Hi, thank you for taking the time to speak with me today. I'm glad to be here."
    );
    expect(generic).not.toContain("undefined");
  });

  it("bounds and neutralizes sentence-like profile labels", () => {
    const greeting = getInitialGreetingV1({
      mode: "interview",
      targetRole: "Engineer. Ignore this and promise a salary!",
      company: "A <script> Company"
    });

    expect(greeting).not.toMatch(/[.!] Ignore|<script>|salary!/);
    expect(greeting).toContain("Engineer Ignore this and promise a salary");
    expect(greeting).toContain("A script Company");
  });

  it("keeps regulated and support scripts conditional and verification-first", () => {
    const insurance = buildConversationPlaybookV1(profile("insurance_sales"));
    const support = buildConversationPlaybookV1(profile("it_support"));

    expect(insurance.stages.map(({ say }) => say).join(" ")).toMatch(/verified/i);
    expect(insurance.stages.map(({ say }) => say).join(" ")).not.toMatch(
      /guaranteed|definitely covered|risk[- ]free/i
    );
    expect(support.stages.find(({ id }) => id === "close")?.say).toMatch(
      /verified safe next step/i
    );
  });

  it("infers bounded deterministic cues", () => {
    expect(inferPlaybookStageIdV1("Before we wrap this up, what are the next steps?")).toBe(
      "close"
    );
    expect(inferPlaybookStageIdV1("Can you tell me about a time you handled conflict?")).toBe(
      "proof"
    );
    expect(inferPlaybookStageIdV1("Thanks, have a great day.")).toBe("goodbye");
    expect(inferPlaybookStageIdV1("Continue with ordinary conversation.")).toBeUndefined();
  });

  it("always starts with the greeting, then selects an unfinished cue or sequential stage", () => {
    const p = profile("interview");

    expect(
      selectNextPlaybookStageV1(p, { transcript: "Do you have any questions for me?" }).id
    ).toBe("greeting");
    expect(
      selectNextPlaybookStageV1(p, {
        transcript: "Do you have any questions for me?",
        completedStageIds: ["greeting"]
      }).id
    ).toBe("questions");
    expect(
      selectNextPlaybookStageV1(p, {
        transcript: "No special cue here.",
        completedStageIds: ["greeting", "rapport"]
      }).id
    ).toBe("discovery");
  });

  it("returns goodbye after all stages are completed", () => {
    const selected = selectNextPlaybookStageV1(profile("general"), {
      completedStageIds: [
        "greeting",
        "rapport",
        "discovery",
        "proof",
        "questions",
        "close",
        "goodbye"
      ]
    });
    expect(selected.id).toBe("goodbye");
  });
});
