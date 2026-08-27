-- One pricing row per trade scope, and a calculation that cannot be edited
-- after the package was approved.
--
-- What existed was `quotes`: an amount, a payment-terms string, and a note.
-- Everything else a price actually depends on lived nowhere. Whether the quote
-- excluded the tax. Whether the sub excluded the crane and somebody else was
-- meant to carry it. Whether the number expires on Friday. Whether the firm
-- can start inside the schedule. Whether it was a firm price or a figure read
-- off the top of somebody's head on a phone call.
--
-- All of that was carried in the estimator's memory, and a bid built from it
-- looked, on screen, exactly like a bid built from signed quotes.
--
-- Two rules run through the columns below.
--
-- Unknown is not zero. Every money column is nullable and nothing defaults to
-- 0. A trade with no freight and a trade whose freight nobody has asked about
-- are different facts, so the second is recorded explicitly in
-- `pending_components` rather than inferred from a null. A total that includes
-- a pending component is not a total, and the domain module refuses to
-- produce one.
--
-- A number nobody can account for is not a number. A manual adjustment
-- carries its reason as a check constraint, the same way an excluded document
-- does: the point of the reason is that it exists six weeks later, when
-- somebody asks why the electrical line is eleven thousand dollars above the
-- quote on file.

create table if not exists trade_pricing_rows (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references organizations(id) on delete cascade,
  opportunity_id    uuid not null references opportunities(id) on delete cascade,

  -- The trade scope this row prices. `scope_key` is the normalised form of
  -- the trade name and is what uniqueness is enforced on, so "HVAC" and
  -- " hvac " cannot become two rows pricing the same work. `trade` keeps the
  -- name as the solicitation wrote it, because that is what the operator
  -- reads and what the outreach email said.
  scope_key         text not null,
  trade             text not null,

  -- Who is doing the work, and who does it if they fall through. A backup is
  -- not decoration: on a two-week turnaround, "we found somebody else" is a
  -- different bid from "we have nobody".
  selected_sub_id   uuid references subcontractors(id) on delete set null,
  backup_sub_id     uuid references subcontractors(id) on delete set null,

  -- The money. Null everywhere means nobody has established it. There is no
  -- default, deliberately.
  base_quote        numeric,
  taxes             numeric,
  freight           numeric,
  mobilization      numeric,
  bonding           numeric,
  manual_adjustment numeric,
  manual_adjustment_reason text,

  -- Components the operator has said apply to this trade but has no figure
  -- for yet. This is the difference between "no freight" and "freight, amount
  -- unknown", which a nullable column alone cannot express.
  pending_components text[] not null default '{}',

  -- [{ label, amount, included }]. An alternate that is included and has no
  -- amount makes the trade total unknown, the same as a missing base quote.
  alternates        jsonb not null default '[]'::jsonb,
  -- [{ text, covered_by, note }]. covered_by is
  -- another_trade | self_perform | not_required | unassigned.
  -- An unassigned exclusion is work a subcontractor has written out of their
  -- price and nobody has picked up. It is a coverage hole, not a discount.
  exclusions        jsonb not null default '[]'::jsonb,

  payment_terms     text,
  -- The date the quoted number stops being good for. Null is unknown, not
  -- "never expires".
  quote_expires_on  date,
  availability      text,
  lead_time_days    integer,

  -- firm | budgetary | rough | unknown. Fails closed: a row that never got
  -- one reads as unknown, never as firm.
  confidence        text not null default 'unknown',

  -- The quote document, W-9, or emailed price this row was typed from.
  supporting_document_id uuid references documents(id) on delete set null,
  -- The `quotes` row this was seeded from, when one exists. Kept so the older
  -- surfaces and this one cannot drift into two different prices.
  source_quote_id   uuid references quotes(id) on delete set null,

  updated_by        text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  unique (opportunity_id, scope_key)
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'trade_pricing_confidence_ck') then
    alter table trade_pricing_rows add constraint trade_pricing_confidence_ck
      check (confidence in ('firm','budgetary','rough','unknown'));
  end if;
  -- An adjustment with no reason is a number nobody can defend later. Zero is
  -- exempt because an adjustment of zero is not an adjustment.
  if not exists (select 1 from pg_constraint where conname = 'trade_pricing_adjustment_reason_ck') then
    alter table trade_pricing_rows add constraint trade_pricing_adjustment_reason_ck
      check (
        manual_adjustment is null
        or manual_adjustment = 0
        or length(btrim(coalesce(manual_adjustment_reason, ''))) >= 20
      );
  end if;
  -- Negative money in these columns is always a typo. A downward correction
  -- belongs in manual_adjustment, where it has to carry a reason.
  if not exists (select 1 from pg_constraint where conname = 'trade_pricing_nonneg_ck') then
    alter table trade_pricing_rows add constraint trade_pricing_nonneg_ck
      check (
        coalesce(base_quote, 0) >= 0
        and coalesce(taxes, 0) >= 0
        and coalesce(freight, 0) >= 0
        and coalesce(mobilization, 0) >= 0
        and coalesce(bonding, 0) >= 0
      );
  end if;
  if not exists (select 1 from pg_constraint where conname = 'trade_pricing_lead_time_ck') then
    alter table trade_pricing_rows add constraint trade_pricing_lead_time_ck
      check (lead_time_days is null or lead_time_days >= 0);
  end if;
  -- A backup that is the selected sub is not a backup.
  if not exists (select 1 from pg_constraint where conname = 'trade_pricing_backup_ck') then
    alter table trade_pricing_rows add constraint trade_pricing_backup_ck
      check (backup_sub_id is null or backup_sub_id is distinct from selected_sub_id);
  end if;
end $$;

create index if not exists trade_pricing_opp_idx on trade_pricing_rows (opportunity_id);
create index if not exists trade_pricing_org_idx on trade_pricing_rows (org_id);

-- ---------------------------------------------------------------------------
-- The calculation, frozen.
-- ---------------------------------------------------------------------------
--
-- A package that was approved was approved against particular numbers. If the
-- rows can move afterwards then the approval is a record of nothing: the
-- screen shows today's arithmetic beside a sign-off given for yesterday's,
-- and there is no way, from inside the product, to tell that they differ.
--
-- So approval and sending each write the whole calculation down, and the row
-- cannot be edited afterwards. The trigger below is the enforcement; a
-- convention would have lasted until the first hotfix.
create table if not exists bid_calculation_snapshots (
  id               uuid primary key default gen_random_uuid(),
  bid_id           uuid not null references bids(id) on delete cascade,
  org_id           uuid not null references organizations(id) on delete cascade,
  opportunity_id   uuid not null references opportunities(id) on delete cascade,

  -- approved | sent
  reason           text not null,
  taken_at         timestamptz not null default now(),
  actor            text not null,

  -- Every row, every total, every formula line, and every stated unknown, as
  -- they read at the moment of the decision.
  calculation      jsonb not null,
  -- sha256 of the canonical calculation text, so a snapshot shown later can be
  -- demonstrated to be the one that was taken rather than asserted to be.
  calculation_hash text not null
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'bid_calc_snapshot_reason_ck') then
    alter table bid_calculation_snapshots add constraint bid_calc_snapshot_reason_ck
      check (reason in ('approved','sent'));
  end if;
end $$;

create index if not exists bid_calc_snapshot_bid_idx on bid_calculation_snapshots (bid_id, taken_at desc);

create or replace function bid_calculation_snapshots_immutable() returns trigger as $$
begin
  if tg_op = 'UPDATE' then
    raise exception 'bid_calculation_snapshots rows are immutable';
  end if;
  -- A snapshot goes when its bid goes, and not otherwise. During a cascade the
  -- parent row is already deleted by the time this fires, which is what
  -- distinguishes "the bid was removed" from "somebody removed the evidence".
  if tg_op = 'DELETE' and exists (select 1 from bids where id = old.bid_id) then
    raise exception 'bid_calculation_snapshots rows cannot be deleted while the bid exists';
  end if;
  return old;
end;
$$ language plpgsql;

drop trigger if exists bid_calculation_snapshots_immutable_trg on bid_calculation_snapshots;
create trigger bid_calculation_snapshots_immutable_trg
  before update or delete on bid_calculation_snapshots
  for each row execute function bid_calculation_snapshots_immutable();
