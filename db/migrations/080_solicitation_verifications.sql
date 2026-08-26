-- Every time this platform checked a solicitation against its source, and
-- what the check actually established.
--
-- The record before this could say what the analyst extracted. It could not
-- say when anybody last confirmed that against the notice, how much of the
-- notice was readable at the time, or what changed between one reading and the
-- next. `analysis_input_hash` gets close, and answers a narrower question:
-- whether the inputs to the last analysis are the inputs now. It says nothing
-- about whether those inputs still match what the agency has published.
--
-- The distinction matters because the failure is silent. A solicitation that
-- was amended three weeks ago looks, on every screen, exactly like one that
-- was not, and the bid goes out against superseded instructions.
--
-- Two things in here are deliberately awkward.
--
-- `state` has nine values rather than a boolean, because a run that failed
-- halfway, a run that read four of nine documents, and a run that found
-- nothing wrong are three different facts, and collapsing them means the first
-- two get displayed as the third.
--
-- And `snapshot` is taken BEFORE anything is checked. A comparison needs
-- something to compare against, and reconstructing "what the record said
-- before" from a record that has since been updated is guesswork.

create table if not exists solicitation_verifications (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references organizations(id) on delete cascade,
  opportunity_id uuid not null references opportunities(id) on delete cascade,

  -- source_and_amendments | documents | requirements_and_deadlines |
  -- trade_scopes | scoring_and_eligibility | bid_readiness | full
  scope          text not null,
  -- One of the nine states. Fails closed: a row that never got one reads as
  -- not_verified, never as verified.
  state          text not null default 'queued',

  -- Who asked. 'schedule' or an agent name when nobody did.
  requested_by   text not null,
  queued_at      timestamptz not null default now(),
  started_at     timestamptz,
  finished_at    timestamptz,

  -- The record as it stood before a single check ran.
  snapshot       jsonb,
  -- Fingerprints either side, so "nothing changed" is a comparison rather
  -- than an assertion.
  fingerprint_before text,
  fingerprint_after  text,

  -- Coverage. Null is unknown, and unknown is not zero: a run that never got
  -- as far as counting documents has not established that there are none.
  documents_expected  integer,
  documents_verified  integer,
  documents_unreadable integer,
  pages_processed     integer,

  -- [{scope, subject, kind, impact, before, after, citation, note}]
  findings       jsonb not null default '[]'::jsonb,
  -- Scopes that could not run at all, so a partial result cannot read as a
  -- complete one.
  failed_scopes  text[] not null default '{}',
  error          text,

  -- Set when an authorized person accepted the changes this run found.
  accepted_at    timestamptz,
  accepted_by    text,

  -- reverify:<opportunity>:<scope>. Stops a double click, a retry and a
  -- scheduled run from becoming three checks of the same thing.
  idempotency_key text not null
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'solicitation_verifications_scope_ck') then
    alter table solicitation_verifications add constraint solicitation_verifications_scope_ck
      check (scope in (
        'source_and_amendments','documents','requirements_and_deadlines',
        'trade_scopes','scoring_and_eligibility','bid_readiness','full'
      ));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'solicitation_verifications_state_ck') then
    alter table solicitation_verifications add constraint solicitation_verifications_state_ck
      check (state in (
        'not_verified','queued','in_progress','verified_no_changes','changes_found',
        'conflicts_found','partially_verified','failed','stale'
      ));
  end if;
  -- A clean verdict has to have finished and has to have read every document
  -- it expected to. This is the constraint that makes "Verified" mean
  -- something: without it, the claim is only as good as whichever code path
  -- happened to write the row.
  if not exists (select 1 from pg_constraint where conname = 'solicitation_verifications_clean_ck') then
    alter table solicitation_verifications add constraint solicitation_verifications_clean_ck
      check (
        state <> 'verified_no_changes'
        or (
          finished_at is not null
          and coalesce(documents_unreadable, 0) = 0
          and array_length(failed_scopes, 1) is null
          and coalesce(documents_verified, -1) >= coalesce(documents_expected, 0)
        )
      );
  end if;
  if not exists (select 1 from pg_constraint where conname = 'solicitation_verifications_accept_ck') then
    alter table solicitation_verifications add constraint solicitation_verifications_accept_ck
      check (
        (accepted_at is null and accepted_by is null)
        or (accepted_at is not null and length(btrim(coalesce(accepted_by, ''))) > 0)
      );
  end if;
end $$;

-- One live run per opportunity and scope. A partial unique index rather than a
-- table constraint so finished runs accumulate as history.
create unique index if not exists solicitation_verifications_live_idx
  on solicitation_verifications (idempotency_key)
  where state in ('queued','in_progress');

create index if not exists solicitation_verifications_opp_idx
  on solicitation_verifications (opportunity_id, queued_at desc);
create index if not exists solicitation_verifications_org_idx
  on solicitation_verifications (org_id, queued_at desc);
