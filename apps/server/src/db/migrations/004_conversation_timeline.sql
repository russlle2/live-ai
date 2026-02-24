CREATE TABLE IF NOT EXISTS conversation_timeline_events (
  id BIGSERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  tenant_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  source TEXT NOT NULL,
  text_excerpt TEXT NOT NULL DEFAULT '',
  entities JSONB NOT NULL DEFAULT '[]'::jsonb,
  moments JSONB NOT NULL DEFAULT '[]'::jsonb,
  objections JSONB NOT NULL DEFAULT '[]'::jsonb,
  compliance_risks JSONB NOT NULL DEFAULT '[]'::jsonb,
  confidence NUMERIC(5,4) NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS conversation_timeline_tenant_session_idx
  ON conversation_timeline_events (tenant_id, session_id, created_at DESC);
