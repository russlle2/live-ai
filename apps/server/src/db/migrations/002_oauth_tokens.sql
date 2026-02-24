CREATE TABLE IF NOT EXISTS integration_oauth_state (
  id BIGSERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  tenant_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  state_token TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  used_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS integration_oauth_state_token_idx
  ON integration_oauth_state (provider, state_token);

CREATE INDEX IF NOT EXISTS integration_oauth_state_tenant_idx
  ON integration_oauth_state (tenant_id, provider, created_at DESC);

CREATE TABLE IF NOT EXISTS integration_oauth_tokens (
  id BIGSERIAL PRIMARY KEY,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  tenant_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  subject_id TEXT,
  access_token_enc TEXT NOT NULL,
  refresh_token_enc TEXT,
  token_type TEXT,
  scope TEXT,
  expires_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE UNIQUE INDEX IF NOT EXISTS integration_oauth_tokens_tenant_provider_idx
  ON integration_oauth_tokens (tenant_id, provider);
