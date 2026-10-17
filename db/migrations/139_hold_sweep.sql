-- Leases for holds the 10-minute sweep releases.
-- Run db:migrate BEFORE publishing this revision.
-- No rows are deleted. A preview that is already running keeps a null
-- running_since and is eligible for the sweep from its created_at.
--
-- The indexes are ordinary CREATE INDEX, not CONCURRENTLY. lib/migrate.ts
-- runs each file inside BEGIN/COMMIT, and CREATE INDEX CONCURRENTLY cannot
-- run in a transaction or beside the other statements in this file. The
-- hold-sweep fixture builds these tables with a handful of rows. Production
-- sizes are not stored in the repo.

alter table prospective_previews
  add column if not exists running_since timestamptz;

create index if not exists ai_provider_facts_pending_started_idx
  on ai_provider_facts (pending_started_at)
  where pending_attempt is not null;

create index if not exists api_usage_events_pending_started_idx
  on api_usage_events (started_at)
  where outcome = 'pending';

create index if not exists rfq_send_claims_reserved_age_idx
  on rfq_send_claims (created_at)
  where state = 'reserved';

create index if not exists job_runs_running_started_idx
  on job_runs (started_at)
  where status = 'running';

create index if not exists prospective_dispatch_open_started_idx
  on prospective_dispatch_claims (started_at)
  where finished_at is null;
