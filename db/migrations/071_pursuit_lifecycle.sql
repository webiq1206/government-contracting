-- ============================================================================
-- Migration 0071, pursuit lifecycle: pause and abort
--
-- An operator can dismiss an opportunity and can move it between stages.
-- Neither of those stops work already in flight, and neither is a decision
-- the automation can see before it acts. So an opportunity the operator has
-- finished with keeps sending: a queued follow-up goes out, a recovery sweep
-- re-enqueues a scoring job, Sub Finder sources more candidates for a bid
-- nobody is submitting.
--
-- These columns give the automation something to check. `pursuit_state` is
-- the marker every send and state change reads before it acts:
--
--   active   the default, and the only state in which automation may act
--   paused   temporarily stopped, resumable, everything preserved
--   aborted  permanently stopped; restarting requires full revalidation
--
-- Deliberately separate from `status` and `stage`. `status` is what the
-- SOLICITATION is doing (open, expired, canceled by the agency) and `stage`
-- is how far the work got. Neither can express "we have stopped working on
-- this", which is a decision about us rather than about the notice, and
-- overloading either would make an abort indistinguishable from an agency
-- cancellation in every report that reads them.
--
-- Nullable with a default of 'active', so every existing row is active
-- without a backfill and without a lock on a large table.
-- ============================================================================

alter table opportunities
  add column if not exists pursuit_state text not null default 'active',
  add column if not exists pursuit_changed_at timestamptz,
  add column if not exists pursuit_changed_by text,
  add column if not exists pursuit_reason text,
  add column if not exists pursuit_note text,
  -- Bumped on every abort and restart, so a job enqueued before an abort can
  -- be told from one enqueued after the restart that followed it. Without
  -- this, a restart would revive jobs the abort was supposed to have stopped.
  add column if not exists pursuit_version integer not null default 1;

alter table opportunities
  drop constraint if exists opportunities_pursuit_state_check;
alter table opportunities
  add constraint opportunities_pursuit_state_check
  check (pursuit_state in ('active', 'paused', 'aborted'));

-- Every agent sweep asks "which opportunities may I work on", which is this
-- predicate plus status. Partial because the answer is almost always active
-- and an index over one value carries no information.
create index if not exists opportunities_pursuit_stopped_idx
  on opportunities (org_id, pursuit_state)
  where pursuit_state <> 'active';
