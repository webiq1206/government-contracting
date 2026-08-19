-- ============================================================================
-- Migration 0057, worker heartbeat
--
-- "Is the automation engine running?" was answered from the newest job_runs
-- row, which cannot tell these three apart:
--
--   * the worker is gone (deployment asleep, process exited)
--   * the worker is alive but wedged part-way through starting
--   * the worker is alive and well, and simply had no work due
--
-- All three look identical: an old timestamp. The owner spent a night being
-- told the engine was down when the real fault was a boot that never finished,
-- and no log line said so.
--
-- This row is written by the worker on a timer that runs independently of the
-- work it is doing, so a stale row means the process is gone or blocked, and a
-- fresh row carries the phase it is in ("ready" once handlers are registered).
--
-- One row, constant key: liveness is a platform fact, not a tenant fact, and a
-- second instance overwriting it is the correct answer to "something is alive".
-- ============================================================================

create table if not exists worker_heartbeat (
  id          text primary key,
  instance_id text not null,
  phase       text not null,
  detail      text,
  booted_at   timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Same Supabase lockdown every other table gets (see 002_rls.sql): RLS on with
-- no policy denies the public API roles, the owning role the app connects as is
-- unaffected.
do $$
begin
  execute 'alter table public.worker_heartbeat enable row level security';
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on table public.worker_heartbeat from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on table public.worker_heartbeat from authenticated';
  end if;
end $$;
