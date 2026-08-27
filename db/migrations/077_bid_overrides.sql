-- Overriding a warning, with a name against it.
--
-- `force: true` was a boolean in a request body. It got a package past the
-- submit-lead-hours rule and past a package that was not marked ready, and
-- left behind a log line saying somebody submitted. Nothing recorded which
-- warning was overridden, why, or what the person believed at the time.
--
-- That is the difference between a decision and a bypass. A contracting
-- officer asking six weeks later why a bid went out ninety minutes before
-- close has a fair question, and "somebody passed force" is not an answer.
--
-- Hard blockers never reach this table: a missing mandatory form is not a
-- judgement call, and the submit endpoint refuses those regardless of force.
-- This is for the warnings, where a person genuinely may know something the
-- rules do not.

create table if not exists bid_overrides (
  id           uuid primary key default gen_random_uuid(),
  bid_id       uuid not null references bids(id) on delete cascade,
  org_id       uuid not null references organizations(id) on delete cascade,

  -- The specific warning, not "the checks".
  requirement  text not null,
  -- In the operator's own words. Required, and required to be a sentence:
  -- see lib/domain/override.ts for why the floor is where it is.
  reason       text not null,
  -- notable | serious
  risk         text not null default 'serious',

  actor        text not null,
  created_at   timestamptz not null default now(),

  -- Left for the second-approval flow the instructions describe as optional.
  -- Null means nobody has countersigned, which is not the same as nobody
  -- needing to, and the UI must not read one as the other.
  approved_by  text,
  approved_at  timestamptz
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'bid_overrides_reason_ck') then
    alter table bid_overrides add constraint bid_overrides_reason_ck
      check (length(btrim(reason)) >= 20);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'bid_overrides_risk_ck') then
    alter table bid_overrides add constraint bid_overrides_risk_ck
      check (risk in ('notable','serious'));
  end if;
end $$;

create index if not exists bid_overrides_bid_idx on bid_overrides (bid_id, created_at);
-- "What has this account waved through, and who signed it" is a question an
-- owner should be able to ask without reading every bid.
create index if not exists bid_overrides_org_idx on bid_overrides (org_id, created_at desc);
