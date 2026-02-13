import { withClient } from "./pool";

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

export async function insertObsEvent(e: { tenantId: string; repId: string; sessionId?: string; service: string; eventType: string; data: unknown; at?: string; }): Promise<void> {
  await withClient(async (c) => {
    await c.query(
      `INSERT INTO obs_events(at, tenant_id, rep_id, session_id, service, event_type, data)
       VALUES (COALESCE($1::timestamptz, now()), $2, $3, $4, $5, $6, $7::jsonb)`,
      [e.at ?? null, e.tenantId, e.repId, e.sessionId ?? null, e.service, e.eventType, JSON.stringify(e.data ?? {})]
    );
  });
}

export type TrustSummary = {
  tenantId: string;
  day: string;
  patchReceived: number;
  patchRejected: number;
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
    const { rows } = await c.query(
      `SELECT
         (now() AT TIME ZONE 'utc')::date AS day,
         SUM(CASE WHEN event_type='patch_received' THEN 1 ELSE 0 END)::int AS patch_received,
         SUM(CASE WHEN event_type='patch_rejected' THEN 1 ELSE 0 END)::int AS patch_rejected,
         SUM(CASE WHEN event_type='suggestion_shown' THEN 1 ELSE 0 END)::int AS suggestions_shown,
         SUM(CASE WHEN event_type='suggestion_applied' THEN 1 ELSE 0 END)::int AS suggestions_applied,
         SUM(CASE WHEN event_type='suggestion_dismissed' THEN 1 ELSE 0 END)::int AS suggestions_dismissed,
         SUM(CASE WHEN event_type='mute_on' THEN 1 ELSE 0 END)::int AS mute_on,
         SUM(CASE WHEN event_type='undo' THEN 1 ELSE 0 END)::int AS undo
       FROM obs_events
       WHERE tenant_id=$1 AND (at AT TIME ZONE 'utc')::date = (now() AT TIME ZONE 'utc')::date`,
      [tenantId]
    );

    const r = rows[0] ?? { day: new Date().toISOString().slice(0, 10) };
    const base = {
      tenantId,
      day: String(r.day),
      patchReceived: Number(r.patch_received ?? 0),
      patchRejected: Number(r.patch_rejected ?? 0),
      suggestionsShown: Number(r.suggestions_shown ?? 0),
      suggestionsApplied: Number(r.suggestions_applied ?? 0),
      suggestionsDismissed: Number(r.suggestions_dismissed ?? 0),
      muteOn: Number(r.mute_on ?? 0),
      undo: Number(r.undo ?? 0)
    };

    return { ...base, trustScore: computeTrustScoreV1(base) };
  });
}
