-- Performance indexes for high-frequency trust and usage queries

CREATE INDEX IF NOT EXISTS obs_events_tenant_day_event_idx
  ON obs_events (tenant_id, ((at AT TIME ZONE 'utc')::date), event_type);

CREATE INDEX IF NOT EXISTS obs_events_ai_usage_idx
  ON obs_events (tenant_id, at DESC)
  WHERE event_type = 'ai_token_usage';
