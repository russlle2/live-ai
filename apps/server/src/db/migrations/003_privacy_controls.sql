CREATE TABLE IF NOT EXISTS tenant_privacy_controls (
  tenant_id TEXT PRIMARY KEY,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  transcript_opt_out BOOLEAN NOT NULL DEFAULT false,
  encrypt_transcript_fields BOOLEAN NOT NULL DEFAULT true,
  retention_days INT NOT NULL DEFAULT 30,
  delete_requested_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS tenant_privacy_controls_updated_idx
  ON tenant_privacy_controls (updated_at DESC);
