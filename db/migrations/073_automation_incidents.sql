-- A provider outage as a thing with a life, not a count of red rows.
--
-- `assessAutomation` groups today's failed runs by cause and is right to: five
-- agents failing on one exhausted credit balance is one problem with one fix.
-- But it is derived fresh on every request from a rolling six-hour window,
-- which means it can only ever answer "what is failing now".
--
-- Every question an operator asks during a recovery is about time, and none of
-- them can be answered from that window:
--
--   When did this start, and what has it cost me since?
--   The provider is funded now. Did anything actually prove that?
--   Which of the four hundred failures are still worth retrying?
--   Did the retry work, or did it just move the failures somewhere else?
--
-- The window itself is why the doctor reported a live outage that had stopped
-- three hours earlier: a rolling count of failures cannot tell "still broken"
-- from "was broken". An incident can, because it has an end.

create table if not exists automation_incidents (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references organizations(id) on delete cascade,

  -- detected | mitigating | provider_restored | test_passed | backlog_requeued
  -- | backlog_draining | recovered | recovery_failed
  state             text not null default 'detected',
  -- provider_credit | provider_rate_limit | provider_auth | network |
  -- provider_error | other. Coarse on purpose: this decides which failures are
  -- the same problem for the purpose of replaying them together.
  cause             text not null,
  -- blocking | degrading
  severity          text not null default 'blocking',
  provider          text,
  integration       text,

  started_at        timestamptz not null default now(),
  detected_at       timestamptz not null default now(),
  -- How this was noticed: a failed run, the doctor, a person. Worth keeping,
  -- because "nobody noticed for nine hours" is a finding about the product.
  detection_source  text not null default 'job_failure',

  -- Counts, recomputed on each assessment rather than incremented, so a missed
  -- update cannot leave them permanently wrong.
  failed_count      integer not null default 0,
  requeued_count    integer not null default 0,
  completed_count   integer not null default 0,
  remaining_count   integer not null default 0,

  last_provider_success_at timestamptz,
  last_agent_success_at    timestamptz,
  next_run_at              timestamptz,

  recommended_action text,
  repair_attempts    integer not null default 0,
  recovery_owner     text,

  -- The proof, or the absence of it. A test that has not run is null, which is
  -- not the same as a test that failed, and the UI must not read one as the
  -- other.
  test_ran_at       timestamptz,
  test_passed       boolean,
  test_detail       text,

  -- Set only when the queue drained AND a downstream record was confirmed
  -- changed. This is the column that makes "recovered" mean something.
  recovered_at      timestamptz,
  recovery_note     text,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'automation_incidents_state_ck') then
    alter table automation_incidents add constraint automation_incidents_state_ck
      check (state in ('detected','mitigating','provider_restored','test_passed',
                       'backlog_requeued','backlog_draining','recovered','recovery_failed'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'automation_incidents_severity_ck') then
    alter table automation_incidents add constraint automation_incidents_severity_ck
      check (severity in ('blocking','degrading'));
  end if;
  -- Recovered without a recovery time is a state that means nothing. The
  -- column is what makes the word checkable rather than decorative.
  if not exists (select 1 from pg_constraint where conname = 'automation_incidents_recovered_ck') then
    alter table automation_incidents add constraint automation_incidents_recovered_ck
      check (state <> 'recovered' or recovered_at is not null);
  end if;
end $$;

-- At most one open incident per organization per cause.
--
-- Without this, every assessment that ran while the provider was down would
-- open another incident for the same outage, and the recovery button would
-- have to guess which one it was recovering. Partial, because a NEW outage
-- months later must be allowed to open a new one.
create unique index if not exists automation_incidents_open_idx
  on automation_incidents (org_id, cause)
  where state <> 'recovered';

create index if not exists automation_incidents_org_idx
  on automation_incidents (org_id, started_at desc);

-- ---------------------------------------------------------------------------
-- The audit history. Every state change, who or what made it, and why.
--
-- Separate from the incident because the incident holds current state and this
-- holds how it got there, and collapsing the two loses the sequence: "test
-- failed, then passed" and "test passed" are different stories about the same
-- final row.
-- ---------------------------------------------------------------------------
create table if not exists incident_events (
  id           uuid primary key default gen_random_uuid(),
  incident_id  uuid not null references automation_incidents(id) on delete cascade,
  org_id       uuid not null references organizations(id) on delete cascade,
  from_state   text,
  to_state     text not null,
  -- An email address, or the name of the automation that did it. Never blank:
  -- an audit line with no actor is a line nobody can follow up.
  actor        text not null,
  detail       text,
  created_at   timestamptz not null default now()
);
create index if not exists incident_events_incident_idx
  on incident_events (incident_id, created_at);

-- ---------------------------------------------------------------------------
-- What a recovery actually requeued.
--
-- One row per replayed job, carrying the idempotency key. This is what makes a
-- second press of the recovery button do nothing rather than double the work,
-- and it is what lets the UI say how much of the backlog has drained without
-- guessing from a queue depth that also contains ordinary scheduled work.
-- ---------------------------------------------------------------------------
create table if not exists incident_requeues (
  id             uuid primary key default gen_random_uuid(),
  incident_id    uuid not null references automation_incidents(id) on delete cascade,
  org_id         uuid not null references organizations(id) on delete cascade,
  -- The job_runs row that failed.
  source_run_id  uuid,
  agent          text not null,
  opportunity_id uuid,
  -- recovery:<incident>:<run>. Unique, which is the enforcement.
  idempotency_key text not null,
  queued_at      timestamptz not null default now(),
  -- queued | succeeded | failed. Null result means it has not finished, which
  -- is not the same as it having failed.
  outcome        text,
  outcome_at     timestamptz
);
create unique index if not exists incident_requeues_key_idx
  on incident_requeues (idempotency_key);
create index if not exists incident_requeues_incident_idx
  on incident_requeues (incident_id, outcome);
