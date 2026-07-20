export type ArchiveSearchResult = {
  sessionId: string;
  speaker: "rep" | "lead" | "unknown";
  text: string;
  at: string;
  mode: string;
  score: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function boundedText(value: unknown, maximum: number): string {
  return typeof value === "string" ? value.slice(0, maximum) : "";
}

export function normalizeArchiveResults(
  values: unknown[]
): ArchiveSearchResult[] {
  const results: ArchiveSearchResult[] = [];
  for (const value of values) {
    if (!isRecord(value)) continue;
    const sessionId = boundedText(value.sessionId, 240).trim();
    const text = boundedText(value.text, 20_000);
    if (!sessionId || !text) continue;
    const speaker = value.speaker === "rep" || value.speaker === "lead"
      ? value.speaker
      : "unknown";
    const at = typeof value.at === "string" && Number.isFinite(Date.parse(value.at))
      ? value.at.slice(0, 100)
      : "";
    const score = typeof value.score === "number" && Number.isFinite(value.score)
      ? Math.max(0, value.score)
      : 0;
    results.push({
      sessionId,
      speaker,
      text,
      at,
      mode: boundedText(value.mode, 100) || "general",
      score
    });
  }
  return results;
}
