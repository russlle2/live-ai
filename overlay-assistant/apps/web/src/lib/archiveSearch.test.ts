import { describe, expect, it } from "vitest";
import { normalizeArchiveResults } from "./archiveSearch";

describe("normalizeArchiveResults", () => {
  it("keeps bounded source-linked transcript fields", () => {
    expect(normalizeArchiveResults([{
      sessionId: "session-1",
      speaker: "lead",
      text: "The client prioritized reliability.",
      at: "2026-07-20T18:00:00.000Z",
      mode: "general",
      score: 30,
      hidden: "discard"
    }])).toEqual([{
      sessionId: "session-1",
      speaker: "lead",
      text: "The client prioritized reliability.",
      at: "2026-07-20T18:00:00.000Z",
      mode: "general",
      score: 30
    }]);
  });

  it("drops malformed rows and clamps unsafe display values", () => {
    const results = normalizeArchiveResults([
      null,
      { sessionId: "", text: "missing" },
      {
        sessionId: "session-1",
        speaker: "unexpected",
        text: "x".repeat(25_000),
        at: "not-a-date",
        mode: "unknown",
        score: Number.POSITIVE_INFINITY
      }
    ]);
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      speaker: "unknown",
      at: "",
      score: 0
    });
    expect(results[0]?.text).toHaveLength(20_000);
  });
});
