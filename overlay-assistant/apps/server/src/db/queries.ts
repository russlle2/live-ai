import { withClient } from "./pool.js";
import { storedTelemetryTenantId } from "../obs/identifiers.js";

export async function upsertSession(params: { sessionId: string; tenantId: string; repId: string; }): Promise<void> {
  const { sessionId, tenantId, repId } = params;
  await withClient(async (c) => {
    await c.query(
      `INSERT INTO sessions(session_id, tenant_id, rep_id)
       VALUES ($1, $2, $3)
       ON CONFLICT (session_id) DO UPDATE SET tenant_id = EXCLUDED.tenant_id, rep_id = EXCLUDED.rep_id`,
      [sessionId, tenantId, repId]
    );
  });
}

export async function endSession(sessionId: string): Promise<void> {
  await withClient(async (c) => {
    await c.query(`UPDATE sessions SET ended_at = now() WHERE session_id = $1`, [sessionId]);
  });
}

export type ObsEventInput = {
  tenantId: string;
  repId: string;
  sessionId?: string;
  service: string;
  eventType: string;
  data: unknown;
  at?: string;
};
export type ObsClientRunner = (
  operation: (client: {
    query: (text: string, values?: unknown[]) => Promise<unknown>;
  }) => Promise<void>
) => Promise<void>;

export async function insertObsEvent(e: ObsEventInput): Promise<void> {
  await insertObsEvents([e]);
}

export async function insertObsEvents(
  events: ObsEventInput[],
  clientRunner: ObsClientRunner = async (operation) =>
    withClient(async (client) => operation({
      query: (text, values) => client.query(text, values)
    }))
): Promise<void> {
  if (events.length === 0) return;
  const payload = events.map((event) => ({
    at: event.at ?? null,
    tenant_id: event.tenantId,
    rep_id: event.repId,
    session_id: event.sessionId ?? null,
    service: event.service,
    event_type: event.eventType,
    data: event.data ?? {}
  }));
  await clientRunner(async (c) => {
    await c.query(
      `INSERT INTO obs_events(at, tenant_id, rep_id, session_id, service, event_type, data)
       SELECT
         COALESCE(event.at::timestamptz, now()),
         event.tenant_id,
         event.rep_id,
         event.session_id,
         event.service,
         event.event_type,
         event.data
       FROM jsonb_to_recordset($1::jsonb) AS event(
         at text,
         tenant_id text,
         rep_id text,
         session_id text,
         service text,
         event_type text,
         data jsonb
       )`,
      [JSON.stringify(payload)]
    );
  });
}

export type TrustSummary = {
  tenantId: string;
  day: string;
  patchReceived: number;
  patchRejected: number;
  patchCoalesced: number;
  suggestionsShown: number;
  suggestionsApplied: number;
  suggestionsDismissed: number;
  muteOn: number;
  undo: number;
  trustScore: number;
};

export function computeTrustScoreV1(x: Omit<TrustSummary, "trustScore">): number {
  const shown = Math.max(1, x.suggestionsShown);
  const patchRejRate = x.patchRejected / Math.max(1, x.patchReceived);
  const muteRate = x.muteOn / shown;
  const undoRate = x.undo / shown;
  const dismissRate = x.suggestionsDismissed / shown;
  const applyRate = x.suggestionsApplied / shown;

  let score = 100;
  if (patchRejRate > 0.005) score -= 25;
  if (muteRate > 0.08) score -= 20;
  if (undoRate > 0.05) score -= 20;
  if (dismissRate > 0.4) score -= 15;
  score += Math.round(Math.min(10, Math.max(0, applyRate * 20)));
  return Math.max(0, Math.min(100, score));
}

export async function getTrustSummaryForTenant(tenantId: string): Promise<TrustSummary> {
  return withClient(async (c) => {
    const telemetryTenantId = storedTelemetryTenantId(tenantId);
    const { rows } = await c.query(
      `SELECT
         (now() AT TIME ZONE 'utc')::date AS day,
         SUM(CASE WHEN event_type='patch_received' THEN 1 ELSE 0 END)::int AS patch_received,
         SUM(CASE WHEN event_type='patch_rejected' THEN 1 ELSE 0 END)::int AS patch_rejected,
         SUM(CASE WHEN event_type='patch_coalesced' THEN 1 ELSE 0 END)::int AS patch_coalesced,
         SUM(CASE WHEN event_type='suggestion_shown' THEN 1 ELSE 0 END)::int AS suggestions_shown,
         SUM(CASE WHEN event_type='suggestion_applied' THEN 1 ELSE 0 END)::int AS suggestions_applied,
         SUM(CASE WHEN event_type='suggestion_dismissed' THEN 1 ELSE 0 END)::int AS suggestions_dismissed,
         SUM(CASE WHEN event_type='mute_on' THEN 1 ELSE 0 END)::int AS mute_on,
         SUM(CASE WHEN event_type='undo' THEN 1 ELSE 0 END)::int AS undo
       FROM obs_events
       WHERE tenant_id=$1 AND (at AT TIME ZONE 'utc')::date = (now() AT TIME ZONE 'utc')::date`,
      [telemetryTenantId]
    );

    const r = rows[0] ?? { day: new Date().toISOString().slice(0, 10) };
    const base = {
      tenantId,
      day: String(r.day),
      patchReceived: Number(r.patch_received ?? 0),
      patchRejected: Number(r.patch_rejected ?? 0),
      patchCoalesced: Number(r.patch_coalesced ?? 0),
      suggestionsShown: Number(r.suggestions_shown ?? 0),
      suggestionsApplied: Number(r.suggestions_applied ?? 0),
      suggestionsDismissed: Number(r.suggestions_dismissed ?? 0),
      muteOn: Number(r.mute_on ?? 0),
      undo: Number(r.undo ?? 0)
    };

    return { ...base, trustScore: computeTrustScoreV1(base) };
  });
}

/** The runtime is single-owner; purge every legacy and current metadata row. */
export async function purgeAllRuntimeDatabaseData(): Promise<Record<string, number>> {
  return withClient(async (c) => {
    await c.query("BEGIN");
    try {
      const tables = [
        "obs_events",
        "crm_write_events",
        "oauth_credentials",
        "trust_daily",
        "sessions"
      ] as const;
      const removed: Record<string, number> = {};
      for (const table of tables) {
        const result = await c.query(`DELETE FROM ${table}`);
        removed[table] = result.rowCount ?? 0;
      }
      await c.query("COMMIT");
      return removed;
    } catch (error) {
      await c.query("ROLLBACK");
      throw error;
    }
  });
}
