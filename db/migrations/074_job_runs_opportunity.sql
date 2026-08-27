-- Which record a job run was about.
--
-- `job_runs` recorded the agent, the trigger, the status and the error, and
-- nothing about the work itself. That was survivable while the table was only
-- ever read as a count of red rows.
--
-- It stops being survivable the moment a recovery has to decide what is worth
-- replaying, because every one of those decisions is about the record:
--
--   Does the opportunity still exist?
--   Did the operator stop this pursuit?
--   Has the deadline passed?
--   Did a later run already do this work?
--
-- Without this column none of those questions can be asked, and a recovery
-- either replays everything blindly, which the instructions rule out, or
-- replays nothing.
--
-- Nullable, and not backfilled. Plenty of agents are not about one record at
-- all (the sweeps, the monitor), and for historical rows nothing says which
-- record they were about: `agent_logs` carries an opportunity_id but a log
-- line is not the run, and matching them on timestamp would be a guess written
-- into a column that later reads as a fact.
alter table job_runs
  add column if not exists opportunity_id uuid references opportunities(id) on delete set null;

-- The recovery query: this organization's failures since an outage began,
-- joined to the record each was about.
create index if not exists job_runs_recovery_idx
  on job_runs (org_id, status, started_at)
  where status = 'error';

-- "Did a later run of this agent on this record succeed?" is asked once per
-- candidate failure, so it gets its own index rather than a sequential scan
-- per row.
create index if not exists job_runs_agent_record_idx
  on job_runs (agent, opportunity_id, started_at)
  where opportunity_id is not null;
