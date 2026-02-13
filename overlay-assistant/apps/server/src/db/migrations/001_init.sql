-- overlay-assistant demo schema
-- NOTE: This schema stores only derived + event metadata. Do NOT store raw transcripts.

CREATE TABLE IF NOT EXISTS sessions (
  session_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  rep_id TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS obs_events (
  id BIGSERIAL PRIMARY KEY,
  at TIMESTAMPTZ NOT NULL DEFAULT now(),
  tenant_id TEXT NOT NULL,
  rep_id TEXT NOT NULL,
  session_id TEXT,
  service TEXT NOT NULL,
  event_type TEXT NOT NULL,
  data JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS obs_events_tenant_at_idx ON obs_events (tenant_id, at DESC);
CREATE INDEX IF NOT EXISTS obs_events_session_at_idx ON obs_events (session_id, at DESC);
CREATE INDEX IF NOT EXISTS obs_events_event_type_idx ON obs_events (event_type);

CREATE TABLE IF NOT EXISTS crm_write_events (
  id BIGSERIAL PRIMARY KEY,
  at TIMESTAMPTZ NOT NULL DEFAULT now(),
  tenant_id TEXT NOT NULL,
  integration TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  status TEXT NOT NULL,
  request JSONB NOT NULL DEFAULT '{}'::jsonb,
  response JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE UNIQUE INDEX IF NOT EXISTS crm_write_events_idem_idx
  ON crm_write_events (tenant_id, integration, idempotency_key);

CREATE TABLE IF NOT EXISTS trust_daily (
  day DATE NOT NULL,
  tenant_id TEXT NOT NULL,
  patch_received INT NOT NULL DEFAULT 0,
  patch_rejected INT NOT NULL DEFAULT 0,
  suggestions_shown INT NOT NULL DEFAULT 0,
  suggestions_applied INT NOT NULL DEFAULT 0,
  suggestions_dismissed INT NOT NULL DEFAULT 0,
  mute_on INT NOT NULL DEFAULT 0,
  undo INT NOT NULL DEFAULT 0,
  trust_score INT NOT NULL DEFAULT 0,
  PRIMARY KEY (day, tenant_id)
);
