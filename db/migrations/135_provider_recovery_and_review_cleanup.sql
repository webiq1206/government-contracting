-- Additive recovery bookkeeping and a one-time pass of review items that
-- can no longer be priced before their response deadline.
--
-- Adds columns and updates matching rows. Existing tables stay in place
-- and existing rows are kept. Running the update again changes nothing: the rows
-- it archives are no longer open review items.

alter table ai_provider_facts
  add column if not exists probe_failure_count integer not null default 0,
  add column if not exists last_probe_at timestamptz,
  add column if not exists next_probe_at timestamptz;

alter table automation_incidents
  add column if not exists start_alert_at timestamptz,
  add column if not exists end_alert_at timestamptz;

alter table opportunities
  add column if not exists band_decision text,
  add column if not exists band_decision_reasoning text,
  add column if not exists band_decision_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'opportunities_band_decision_ck'
  ) then
    alter table opportunities
      add constraint opportunities_band_decision_ck
      check (band_decision is null or band_decision in ('pursue', 'pass'));
  end if;
end $$;

-- Five business days from the moment this migration runs. The ongoing sweep
-- reads the account's own setting after this; this statement only clears the
-- backlog that is already too late to price.
do $$
declare
  cutoff timestamptz := now();
  remaining integer := 5;
  dow integer;
  pass_note text := 'auto-pass: deadline';
begin
  while remaining > 0 loop
    cutoff := cutoff + interval '1 day';
    dow := extract(dow from (cutoff at time zone 'UTC'))::integer;
    if dow not in (0, 6) then
      remaining := remaining - 1;
    end if;
  end loop;

  update opportunities
     set stage = 'dismissed',
         status = 'archived',
         tier = 'dismiss',
         human_action_required = false,
         review_expires_at = null,
         review_warned_at = null,
         pursuit_state = 'aborted',
         pursuit_reason = 'passed',
         pursuit_changed_at = now(),
         pursuit_changed_by = 'review-lead-cleanup',
         pursuit_version = pursuit_version + 1,
         notes = case
           when coalesce(notes, '') = '' then pass_note
           when position(pass_note in notes) > 0 then notes
           else notes || E'\n' || pass_note
         end
   where status = 'open'
     and is_sources_sought is not true
     and stage not in ('bid_building', 'review_submit', 'submitted', 'won', 'lost', 'dismissed')
     and deadline is not null
     and deadline < cutoff;
end $$;
