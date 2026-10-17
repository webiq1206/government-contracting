-- Additive recovery bookkeeping.
--
-- Schema only. Existing tables stay in place and existing rows are kept.
-- Review items inside the bid lead time are passed by the review-expiry
-- sweep, which stops follow-up work for each archived opportunity.

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
