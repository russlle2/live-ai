import { describe, expect, it, vi } from "vitest";
import {
  insertObsEvents,
  type ObsClientRunner,
  type ObsEventInput
} from "./queries.js";

describe("batched observability persistence", () => {
  it("writes a complete event batch with one parameterized query", async () => {
    const query = vi.fn(async (_sql: string, _parameters?: unknown[]) => ({
      rowCount: 2
    }));
    const withClient: ObsClientRunner = async (operation) =>
      operation({ query });
    const events: ObsEventInput[] = [
      {
        tenantId: "tenant-1",
        repId: "rep-1",
        sessionId: "session-1",
        service: "coach",
        eventType: "first",
        data: { latencyMs: 10 },
        at: "2026-07-20T18:00:00.000Z"
      },
      {
        tenantId: "tenant-1",
        repId: "rep-1",
        service: "coach",
        eventType: "second",
        data: { latencyMs: 20 }
      }
    ];

    await expect(insertObsEvents(events, withClient)).resolves.toBeUndefined();
    expect(query).toHaveBeenCalledTimes(1);
    const [sql, parameters] = query.mock.calls[0]!;
    expect(String(sql)).toContain("jsonb_to_recordset");
    expect(parameters).toHaveLength(1);
    if (!parameters) throw new Error("expected query parameters");
    expect(JSON.parse(String(parameters[0]))).toHaveLength(2);
  });

  it("does not open a database client for an empty batch", async () => {
    const withClient: ObsClientRunner = vi.fn(async () => undefined);
    await insertObsEvents([], withClient);
    expect(withClient).not.toHaveBeenCalled();
  });
});
