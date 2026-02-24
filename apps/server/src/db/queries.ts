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

export type PrivacyControlsV1 = {
  tenantId: string;
  transcriptOptOut: boolean;
  encryptTranscriptFields: boolean;
  retentionDays: number;
};

export async function getPrivacyControls(tenantId: string): Promise<PrivacyControlsV1> {
  return withClient(async (c) => {
    const { rows } = await c.query(
      `SELECT tenant_id, transcript_opt_out, encrypt_transcript_fields, retention_days
       FROM tenant_privacy_controls
       WHERE tenant_id = $1
       LIMIT 1`,
      [tenantId]
    );

    const row = rows[0];
    if (!row) {
      return {
        tenantId,
        transcriptOptOut: false,
        encryptTranscriptFields: true,
        retentionDays: 30
      };
    }

    return {
      tenantId,
      transcriptOptOut: Boolean(row.transcript_opt_out),
      encryptTranscriptFields: Boolean(row.encrypt_transcript_fields),
      retentionDays: Number(row.retention_days ?? 30)
    };
  });
}

export async function upsertPrivacyControls(params: {
  tenantId: string;
  transcriptOptOut: boolean;
  encryptTranscriptFields: boolean;
  retentionDays: number;
}): Promise<void> {
  await withClient(async (c) => {
    await c.query(
      `INSERT INTO tenant_privacy_controls(tenant_id, transcript_opt_out, encrypt_transcript_fields, retention_days, updated_at)
       VALUES ($1, $2, $3, $4, now())
       ON CONFLICT (tenant_id)
       DO UPDATE SET
         transcript_opt_out = EXCLUDED.transcript_opt_out,
         encrypt_transcript_fields = EXCLUDED.encrypt_transcript_fields,
         retention_days = EXCLUDED.retention_days,
         updated_at = now()`,
      [params.tenantId, params.transcriptOptOut, params.encryptTranscriptFields, Math.max(1, Math.min(3650, params.retentionDays))]
    );
  });
}

export async function deleteSessionArtifacts(params: { tenantId: string; sessionId: string }): Promise<{ deletedObs: number; deletedCrm: number; deletedTimeline: number; endedSessions: number }> {
  return withClient(async (c) => {
    const obs = await c.query(`DELETE FROM obs_events WHERE tenant_id = $1 AND session_id = $2`, [params.tenantId, params.sessionId]);
    const crm = await c.query(
      `DELETE FROM crm_write_events
       WHERE tenant_id = $1
         AND (request ->> 'sessionId' = $2 OR request ->> 'session_id' = $2 OR response ->> 'session_id' = $2)`,
      [params.tenantId, params.sessionId]
    );
    const timeline = await c.query(
      `DELETE FROM conversation_timeline_events
       WHERE tenant_id = $1 AND session_id = $2`,
      [params.tenantId, params.sessionId]
    );
    const sess = await c.query(`UPDATE sessions SET ended_at = now() WHERE tenant_id = $1 AND session_id = $2`, [params.tenantId, params.sessionId]);
    await c.query(
      `UPDATE tenant_privacy_controls
       SET delete_requested_at = now(), updated_at = now()
       WHERE tenant_id = $1`,
      [params.tenantId]
    );

    return {
      deletedObs: obs.rowCount ?? 0,
      deletedCrm: crm.rowCount ?? 0,
      deletedTimeline: timeline.rowCount ?? 0,
      endedSessions: sess.rowCount ?? 0
    };
  });
}

export type TimelineEventV1 = {
  id: number;
  createdAt: string;
  source: string;
  textExcerpt: string;
  entities: Array<{ type: string; value: string; confidence?: number }>;
  moments: string[];
  objections: string[];
  complianceRisks: Array<{ type: string; severity: string; phrase: string }>;
  confidence: number;
};

export async function insertConversationTimelineEvent(params: {
  tenantId: string;
  sessionId: string;
  source: string;
  textExcerpt: string;
  entities: unknown[];
  moments: unknown[];
  objections: string[];
  complianceRisks: unknown[];
  confidence: number;
}): Promise<TimelineEventV1> {
  return withClient(async (c) => {
    const { rows } = await c.query(
      `INSERT INTO conversation_timeline_events(
         tenant_id, session_id, source, text_excerpt, entities, moments, objections, compliance_risks, confidence
       ) VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7::jsonb, $8::jsonb, $9)
       RETURNING id, created_at, source, text_excerpt, entities, moments, objections, compliance_risks, confidence`,
      [
        params.tenantId,
        params.sessionId,
        params.source,
        params.textExcerpt.slice(0, 2000),
        JSON.stringify(params.entities ?? []),
        JSON.stringify(params.moments ?? []),
        JSON.stringify(params.objections ?? []),
        JSON.stringify(params.complianceRisks ?? []),
        Math.max(0, Math.min(1, params.confidence))
      ]
    );

    const r = rows[0] as any;
    return {
      id: Number(r.id),
      createdAt: new Date(r.created_at).toISOString(),
      source: String(r.source ?? "unknown"),
      textExcerpt: String(r.text_excerpt ?? ""),
      entities: Array.isArray(r.entities) ? r.entities : [],
      moments: Array.isArray(r.moments) ? r.moments.map((x: unknown) => String(x)) : [],
      objections: Array.isArray(r.objections) ? r.objections.map((x: unknown) => String(x)) : [],
      complianceRisks: Array.isArray(r.compliance_risks) ? r.compliance_risks : [],
      confidence: Number(r.confidence ?? 0)
    };
  });
}

export async function getConversationTimeline(params: {
  tenantId: string;
  sessionId: string;
  limit?: number;
  sinceId?: number;
}): Promise<TimelineEventV1[]> {
  return withClient(async (c) => {
    const limit = Math.max(1, Math.min(200, Number(params.limit ?? 60)));
    const sinceId = Number(params.sinceId ?? 0);
    const hasSince = Number.isFinite(sinceId) && sinceId > 0;

    const { rows } = hasSince
      ? await c.query(
          `SELECT id, created_at, source, text_excerpt, entities, moments, objections, compliance_risks, confidence
           FROM conversation_timeline_events
           WHERE tenant_id = $1 AND session_id = $2 AND id > $3
           ORDER BY id ASC
           LIMIT $4`,
          [params.tenantId, params.sessionId, sinceId, limit]
        )
      : await c.query(
          `SELECT id, created_at, source, text_excerpt, entities, moments, objections, compliance_risks, confidence
           FROM conversation_timeline_events
           WHERE tenant_id = $1 AND session_id = $2
           ORDER BY created_at DESC
           LIMIT $3`,
          [params.tenantId, params.sessionId, limit]
        );

    return rows.map((r: any) => ({
      id: Number(r.id),
      createdAt: new Date(r.created_at).toISOString(),
      source: String(r.source ?? "unknown"),
      textExcerpt: String(r.text_excerpt ?? ""),
      entities: Array.isArray(r.entities) ? r.entities : [],
      moments: Array.isArray(r.moments) ? r.moments.map((x: unknown) => String(x)) : [],
      objections: Array.isArray(r.objections) ? r.objections.map((x: unknown) => String(x)) : [],
      complianceRisks: Array.isArray(r.compliance_risks) ? r.compliance_risks : [],
      confidence: Number(r.confidence ?? 0)
    }));
  });
}

export async function enforceRetentionPolicies(params?: { tenantId?: string }): Promise<{
  tenantsProcessed: number;
  deletedObs: number;
  deletedTimeline: number;
  deletedCrm: number;
  deletedSessions: number;
}> {
  return withClient(async (c) => {
    const tenantRows = params?.tenantId
      ? [{ tenant_id: params.tenantId }]
      : (
        await c.query(
          `SELECT DISTINCT tenant_id FROM (
             SELECT tenant_id FROM sessions
             UNION SELECT tenant_id FROM obs_events
             UNION SELECT tenant_id FROM conversation_timeline_events
             UNION SELECT tenant_id FROM crm_write_events
             UNION SELECT tenant_id FROM tenant_privacy_controls
           ) t
           WHERE tenant_id IS NOT NULL`
        )
      ).rows;

    let deletedObs = 0;
    let deletedTimeline = 0;
    let deletedCrm = 0;
    let deletedSessions = 0;

    for (const t of tenantRows) {
      const tenantId = String((t as any).tenant_id || "");
      if (!tenantId) continue;

      const ctrl = await c.query(
        `SELECT retention_days FROM tenant_privacy_controls WHERE tenant_id = $1 LIMIT 1`,
        [tenantId]
      );
      const retentionDays = Math.max(1, Math.min(3650, Number(ctrl.rows[0]?.retention_days ?? 30)));
      const cutoffInterval = `${retentionDays} days`;

      const obs = await c.query(
        `DELETE FROM obs_events
         WHERE tenant_id = $1
           AND at < now() - $2::interval`,
        [tenantId, cutoffInterval]
      );
      deletedObs += obs.rowCount ?? 0;

      const tl = await c.query(
        `DELETE FROM conversation_timeline_events
         WHERE tenant_id = $1
           AND created_at < now() - $2::interval`,
        [tenantId, cutoffInterval]
      );
      deletedTimeline += tl.rowCount ?? 0;

      const crm = await c.query(
        `DELETE FROM crm_write_events
         WHERE tenant_id = $1
           AND at < now() - $2::interval`,
        [tenantId, cutoffInterval]
      );
      deletedCrm += crm.rowCount ?? 0;

      const sess = await c.query(
        `DELETE FROM sessions
         WHERE tenant_id = $1
           AND COALESCE(ended_at, started_at) < now() - $2::interval`,
        [tenantId, cutoffInterval]
      );
      deletedSessions += sess.rowCount ?? 0;
    }

    return {
      tenantsProcessed: tenantRows.length,
      deletedObs,
      deletedTimeline,
      deletedCrm,
      deletedSessions
    };
  });
}
