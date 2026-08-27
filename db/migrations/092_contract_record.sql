-- What a contract has, in tables that can be written to.
--
-- The record held a number, two dates, two subcontractor slots and two jsonb
-- columns. Both jsonb columns were rendered on the card and neither had a
-- write path anywhere in the application, so the two richest fields on the
-- contract were permanently empty: milestones came back '[]' from the award
-- insert and coordination_log was never touched at all. A field that can only
-- be read is a field that is always blank.
--
-- Everything a contract actually accumulates after award -- what was
-- delivered and when, what changed, what was invoiced and paid, what went
-- wrong, and what was said to whom -- had nowhere to live.

alter table contracts
  -- Closeout as two moments rather than a status flip. Starting closeout and
  -- finishing it are weeks apart on federal work, and the gap is where final
  -- invoices and retainage sit.
  add column if not exists closeout_started_at   timestamptz,
  add column if not exists closeout_completed_at timestamptz,
  add column if not exists closeout_notes        text,
  add column if not exists retainage_pct         numeric,
  -- What the contract itself requires, as distinct from what the company
  -- happens to carry. Null means nobody has read the contract for it.
  add column if not exists insurance_required    text,
  add column if not exists bond_required_cents   bigint,
  -- Set when a contract was recorded by hand rather than created by a win, so
  -- the record says where it came from.
  add column if not exists created_manually      boolean not null default false,
  add column if not exists created_by            uuid references users(id) on delete set null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'contracts_retainage_ck') then
    alter table contracts add constraint contracts_retainage_ck
      check (retainage_pct is null or (retainage_pct >= 0 and retainage_pct <= 100));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'contracts_closeout_order_ck') then
    alter table contracts add constraint contracts_closeout_order_ck check (
      closeout_completed_at is null
      or (closeout_started_at is not null and closeout_completed_at >= closeout_started_at)
    );
  end if;
end $$;

/*
 * Milestones and deliverables, in one table.
 *
 * They are the same shape -- a named thing with a date and a state -- and the
 * difference is only whether the agency receives something. Splitting them
 * would mean two lists somebody has to reconcile to answer "what is due next".
 */
create table if not exists contract_milestones (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references organizations(id) on delete cascade,
  contract_id    uuid not null references contracts(id) on delete cascade,
  kind           text not null default 'milestone',
  name           text not null,
  detail         text,
  due_at         date,
  -- Null while outstanding. The completion date, not a boolean, because "when"
  -- is the question asked about a delivered milestone.
  completed_at   timestamptz,
  completed_by   uuid references users(id) on delete set null,
  amount_cents   bigint,
  -- What the agency was actually given, when there is something.
  evidence_note  text,
  sort_order     integer not null default 0,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint contract_milestones_kind_ck check (kind in ('milestone','deliverable')),
  constraint contract_milestones_name_ck check (length(btrim(name)) > 0),
  constraint contract_milestones_amount_ck check (amount_cents is null or amount_cents >= 0)
);

create index if not exists contract_milestones_contract_idx
  on contract_milestones (contract_id, sort_order, due_at);

/*
 * Modifications, kept source-supported.
 *
 * A post-award change to scope, value or dates is the thing most likely to be
 * remembered wrong, so a modification carries the document it came from and
 * the value delta rather than only a description. `superseded_by` lets a
 * correction stand without erasing what was believed before it.
 */
create table if not exists contract_modifications (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references organizations(id) on delete cascade,
  contract_id     uuid not null references contracts(id) on delete cascade,
  mod_number      text not null,
  kind            text not null,
  summary         text not null,
  -- Signed: a deductive change order is negative, and storing it unsigned is
  -- how a contract's value drifts upward every time somebody takes work away.
  value_delta_cents bigint,
  new_end_date    date,
  effective_at    date,
  -- Where this came from, so a value change can be checked against paper.
  source_document text,
  source_note     text,
  superseded_by   uuid references contract_modifications(id) on delete set null,
  recorded_by     uuid references users(id) on delete set null,
  created_at      timestamptz not null default now(),
  constraint contract_modifications_kind_ck
    check (kind in ('scope','value','schedule','administrative','termination')),
  constraint contract_modifications_number_ck check (length(btrim(mod_number)) > 0),
  constraint contract_modifications_summary_ck check (length(btrim(summary)) > 0),
  constraint contract_modifications_not_self_ck check (superseded_by is null or superseded_by <> id)
);

create unique index if not exists contract_modifications_number_idx
  on contract_modifications (contract_id, lower(btrim(mod_number)));

/*
 * Invoices, with payment on the same row.
 *
 * An invoice and its payment are one fact with two dates. Two tables would
 * mean a payment could exist without an invoice, which on federal work is not
 * a thing that happens and is a thing a reconciliation would then have to
 * explain.
 */
create table if not exists contract_invoices (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references organizations(id) on delete cascade,
  contract_id    uuid not null references contracts(id) on delete cascade,
  invoice_number text not null,
  amount_cents   bigint not null,
  period_start   date,
  period_end     date,
  submitted_at   timestamptz,
  paid_at        timestamptz,
  paid_cents     bigint,
  -- Set when an invoice was refused, with the reason. An unpaid invoice and a
  -- rejected one need opposite next actions.
  rejected_at    timestamptz,
  rejected_reason text,
  note           text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint contract_invoices_number_ck check (length(btrim(invoice_number)) > 0),
  constraint contract_invoices_amount_ck check (amount_cents >= 0),
  constraint contract_invoices_paid_ck
    check (paid_at is null or (paid_cents is not null and paid_cents >= 0)),
  -- Paid and rejected are mutually exclusive claims about the same invoice.
  constraint contract_invoices_state_ck check (paid_at is null or rejected_at is null),
  constraint contract_invoices_rejected_ck
    check (rejected_at is null or length(btrim(coalesce(rejected_reason, ''))) > 0)
);

create unique index if not exists contract_invoices_number_idx
  on contract_invoices (contract_id, lower(btrim(invoice_number)));

create index if not exists contract_invoices_contract_idx
  on contract_invoices (contract_id, coalesce(submitted_at, created_at) desc);

/*
 * Issues raised on a contract.
 *
 * The card showed five derived risks computed from dates. Those are real, and
 * they are also the only five things the record could ever say was wrong: a
 * differing site condition, a late agency response, a subcontractor walking
 * off, none of them had anywhere to be written down.
 */
create table if not exists contract_issues (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references organizations(id) on delete cascade,
  contract_id   uuid not null references contracts(id) on delete cascade,
  title         text not null,
  detail        text,
  severity      text not null default 'normal',
  raised_at     timestamptz not null default now(),
  raised_by     uuid references users(id) on delete set null,
  -- Null while open. Resolving requires saying how, so a closed issue is one
  -- somebody can learn from.
  resolved_at   timestamptz,
  resolution    text,
  created_at    timestamptz not null default now(),
  constraint contract_issues_title_ck check (length(btrim(title)) > 0),
  constraint contract_issues_severity_ck check (severity in ('normal','serious','blocking')),
  constraint contract_issues_resolution_ck
    check (resolved_at is null or length(btrim(coalesce(resolution, ''))) > 0)
);

create index if not exists contract_issues_contract_idx
  on contract_issues (contract_id, (resolved_at is null) desc, raised_at desc);

/*
 * Coordination proof.
 *
 * On a small-business set-aside the prime has to be able to show it actually
 * ran the work rather than passing it through. That evidence is a log of
 * dated contacts, and the column meant to hold it could not be written.
 */
create table if not exists contract_coordination (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references organizations(id) on delete cascade,
  contract_id   uuid not null references contracts(id) on delete cascade,
  happened_at   timestamptz not null default now(),
  channel       text not null,
  with_whom     text not null,
  subcontractor_id uuid references subcontractors(id) on delete set null,
  summary       text not null,
  recorded_by   uuid references users(id) on delete set null,
  created_at    timestamptz not null default now(),
  constraint contract_coordination_channel_ck
    check (channel in ('call','email','meeting','site_visit','other')),
  constraint contract_coordination_with_ck check (length(btrim(with_whom)) > 0),
  constraint contract_coordination_summary_ck check (length(btrim(summary)) > 0)
);

create index if not exists contract_coordination_contract_idx
  on contract_coordination (contract_id, happened_at desc);

/*
 * Carry across whatever the two write-less jsonb columns happen to hold.
 *
 * In practice both are empty everywhere, because nothing ever wrote to them.
 * Done anyway rather than assumed, since assuming a column is empty is how
 * data gets dropped in a migration nobody re-reads.
 */
insert into contract_milestones (org_id, contract_id, name, detail, due_at, completed_at, amount_cents)
select c.org_id, c.id,
       coalesce(nullif(btrim(m->>'name'), ''), 'Untitled milestone'),
       nullif(btrim(m->>'detail'), ''),
       nullif(m->>'due', '')::date,
       case when lower(coalesce(m->>'status','')) in ('complete','completed','done')
            then c.updated_at else null end,
       case when (m->>'amount') ~ '^[0-9]+(\.[0-9]+)?$'
            then round((m->>'amount')::numeric * 100) else null end
  from contracts c
  cross join lateral jsonb_array_elements(
    case when jsonb_typeof(c.milestones) = 'array' then c.milestones else '[]'::jsonb end
  ) as m
 where c.org_id is not null
   and not exists (select 1 from contract_milestones cm where cm.contract_id = c.id);

insert into contract_coordination (org_id, contract_id, happened_at, channel, with_whom, summary)
select c.org_id, c.id,
       coalesce(nullif(e->>'at', '')::timestamptz, c.updated_at),
       'other',
       coalesce(nullif(btrim(e->>'with'), ''), 'Not recorded'),
       coalesce(nullif(btrim(e->>'note'), ''), nullif(btrim(e->>'summary'), ''), 'Not recorded')
  from contracts c
  cross join lateral jsonb_array_elements(
    case when jsonb_typeof(c.coordination_log) = 'array' then c.coordination_log else '[]'::jsonb end
  ) as e
 where c.org_id is not null
   and not exists (select 1 from contract_coordination cc where cc.contract_id = c.id);
