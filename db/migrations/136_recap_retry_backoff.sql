-- When a morning recap hits a Gmail rate limit, the next automatic claim waits.
-- Adds one column. Existing rows stay. Nothing is removed.

alter table recap_deliveries
  add column if not exists next_retry_at timestamptz;
