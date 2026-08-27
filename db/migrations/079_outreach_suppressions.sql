-- Telling the platform to stop contacting somebody, and having it remember.
--
-- Skipping a call already worked: it set `status = 'skipped'` and a free-text
-- note. What it could not do is last. The next Call Prep run built the card
-- again, the next follow-up sweep sent the next email, and the operator's
-- decision survived exactly as long as the row they clicked on.
--
-- The narrow reading of that bug is a re-appearing task. The real one reaches
-- a subcontractor: a firm that asked not to be rung keeps getting rung, over
-- the operator's name, and the operator has no way to know it is happening.
--
-- Three columns carry the scope, and each null widens it by exactly one step.
-- A row with an opportunity and a trade stops one trade on one bid. Drop the
-- trade and it stops the whole bid. Drop the opportunity too and it stops that
-- firm across the account. There is deliberately no fourth level: no
-- suppression here can reach another organization's records.
--
-- A skip scoped to `once` writes nothing at all. A one-time skip that quietly
-- created a standing rule is how an operator stops speaking to a firm forever
-- because they were busy on a Tuesday.

create table if not exists outreach_suppressions (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references organizations(id) on delete cascade,
  subcontractor_id uuid not null references subcontractors(id) on delete cascade,

  -- Null: every opportunity this organization has with this firm.
  opportunity_id   uuid references opportunities(id) on delete cascade,
  -- Null: every trade inside whatever the opportunity scope is.
  trade            text,

  -- call | email | all.
  --
  -- Kept apart because a firm that will not take phone calls will often still
  -- answer email, and stopping both because somebody said "do not ring them"
  -- closes a channel nobody asked to close.
  channel          text not null,

  -- One of the structured reasons, so these can be counted. Forty differently
  -- worded free-text notes saying "they already emailed" is a scheduling
  -- defect nobody can see.
  reason           text not null,
  note             text,
  actor            text not null,
  created_at       timestamptz not null default now(),

  -- Removed by an authorized user. Kept as history rather than deleted: the
  -- question "who decided to start calling them again, and when" has to have
  -- an answer.
  lifted_at        timestamptz,
  lifted_by        text
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'outreach_suppressions_channel_ck') then
    alter table outreach_suppressions add constraint outreach_suppressions_channel_ck
      check (channel in ('call','email','all'));
  end if;
  -- A lift with no name against it is not a lift anybody can account for.
  if not exists (select 1 from pg_constraint where conname = 'outreach_suppressions_lift_ck') then
    alter table outreach_suppressions add constraint outreach_suppressions_lift_ck
      check (
        (lifted_at is null and lifted_by is null)
        or (lifted_at is not null and length(btrim(coalesce(lifted_by, ''))) > 0)
      );
  end if;
  -- A trade without an opportunity is a scope nothing can evaluate: trade
  -- names are per-solicitation, so "stop Electrical everywhere" would mean
  -- whatever each analysis happened to call it.
  if not exists (select 1 from pg_constraint where conname = 'outreach_suppressions_scope_ck') then
    alter table outreach_suppressions add constraint outreach_suppressions_scope_ck
      check (trade is null or opportunity_id is not null);
  end if;
end $$;

-- The lookup every send and every call-prep run makes.
create index if not exists outreach_suppressions_lookup_idx
  on outreach_suppressions (org_id, subcontractor_id)
  where lifted_at is null;

-- "What has this account stopped, and who stopped it" without reading every
-- subcontractor.
create index if not exists outreach_suppressions_org_idx
  on outreach_suppressions (org_id, created_at desc);

-- ---------------------------------------------------------------------------
-- What a skip actually recorded
-- ---------------------------------------------------------------------------
--
-- `response_json` held the reason as prose inside a blob. That is fine for a
-- person reading one card and useless for the question that matters, which is
-- how often the queue is offering calls that did not need making.
alter table call_cards
  -- One of the structured skip reasons.
  add column if not exists skip_reason  text,
  add column if not exists skip_note    text,
  -- once | opportunity_trade | subcontractor.
  add column if not exists skip_scope   text,
  add column if not exists skipped_by   text,
  -- Whether a dial actually happened before the operator gave up.
  --
  -- Without this, a skip counts as an attempt, and a firm the queue offered
  -- four times and nobody rang reads as one that was chased four times and
  -- never answered. Those are opposite facts about the same company.
  add column if not exists dialed       boolean not null default false;
