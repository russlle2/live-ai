-- Tenant-scoped OAuth credential storage (encrypted at rest)
CREATE TABLE IF NOT EXISTS oauth_credentials (
  id BIGSERIAL PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  integration TEXT NOT NULL,
  encrypted_blob TEXT NOT NULL,
  iv TEXT NOT NULL,
  auth_tag TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS oauth_credentials_tenant_integration_idx
  ON oauth_credentials (tenant_id, integration);
