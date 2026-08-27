-- The facts a compliance item needs to be worked, and a record of who changed it.
--
-- The row held a category, a label, a date and a severity. Five of the things
-- an operator needs were missing entirely: which timezone the date is in, when
-- it repeats, how far ahead to warn, what happens when nobody acts, and who
-- last confirmed it against a document. And every edit was written to a flat
-- application log that this page never reads, so "who changed this date and
-- why" had no answer at all.

alter table compliance_items
  -- A renewal deadline is a wall-clock date somewhere. Stored so a countdown
  -- is computed against the place the obligation lives rather than against
  -- whichever server rendered the page.
  add column if not exists time_zone            text,

  -- Most of these repeat: a registration annually, insurance annually, a
  -- CPARS on a contract schedule. Without this every renewal was a new item
  -- somebody had to remember to create.
  add column if not exists recurrence           text,
  add column if not exists recurrence_months    integer,

  -- How far ahead this item warns, and what happens when nobody acts.
  add column if not exists window_days          integer,
  add column if not exists escalate_after_days  integer,
  add column if not exists escalate_to          text,

  -- When a person last checked it against the document, and who. Distinct
  -- from last_checked_at, which is when a machine last looked.
  add column if not exists verified_at          timestamptz,
  add column if not exists verified_by          uuid references users(id) on delete set null,

  -- Set when two sources disagree, or when a machine reading wants a person.
  -- Both carry their reason: a state with no explanation is one nobody can
  -- clear.
  add column if not exists conflict_detail      text,
  add column if not exists needs_review_reason  text,
  add column if not exists blocked_by           text,

  -- False when there is nothing the platform can check. A real answer rather
  -- than a failure, and the reason "Cannot monitor" is a state of its own.
  add column if not exists monitorable          boolean not null default true,

  -- Whether it is required or merely tracked.
  add column if not exists required             boolean not null default true,

  -- When the obligation was actually satisfied, as opposed to when a row was
  -- written about it.
  add column if not exists satisfied_at         timestamptz,

  -- A stored file rather than a pasted link. The old doc_url stays, because
  -- a Drive link somebody pasted is still the only copy for some rows.
  add column if not exists storage_path         text,
  add column if not exists original_filename    text,
  add column if not exists mime_type            text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'compliance_items_recurrence_ck') then
    alter table compliance_items add constraint compliance_items_recurrence_ck check (
      recurrence is null
      or (recurrence in ('annual','semiannual','quarterly','monthly','custom')
          and (recurrence <> 'custom' or recurrence_months > 0))
    );
  end if;

  if not exists (select 1 from pg_constraint where conname = 'compliance_items_windows_ck') then
    alter table compliance_items add constraint compliance_items_windows_ck check (
      (window_days is null or window_days > 0)
      and (escalate_after_days is null or escalate_after_days > 0)
      and (recurrence_months is null or recurrence_months > 0)
    );
  end if;
end $$;

/*
 * The stored severities become states.
 *
 * `ok` is deliberately not turned into anything. It meant "the monitor did
 * not flag this", which on an item with no date on file is exactly the
 * unearned green badge the new vocabulary exists to remove. Those rows are
 * cleared so the state is worked out from the facts on the row instead.
 */
update compliance_items set status = case status
  when 'warning'  then 'expiring_soon'
  when 'critical' then 'expired'
  when 'blocked'  then 'blocked'
  when 'resolved' then 'complete'
  else status end
 where status in ('warning','critical','blocked','resolved');

update compliance_items set status_override = case status_override
  when 'warning'  then 'expiring_soon'
  when 'critical' then 'expired'
  when 'blocked'  then 'blocked'
  when 'resolved' then 'complete'
  when 'ok'       then null
  else status_override end
 where status_override is not null;

-- Rows that were satisfied before satisfied_at existed. `resolved` was the
-- only value that meant "done", so it is the only one that can supply a date,
-- and updated_at is the closest thing to when somebody said so.
update compliance_items
   set satisfied_at = coalesce(satisfied_at, updated_at)
 where status = 'complete' and satisfied_at is null;

update compliance_items set status = 'incomplete' where status = 'ok';

do $$
begin
  if exists (select 1 from pg_constraint where conname = 'compliance_items_status_ck') then
    alter table compliance_items drop constraint compliance_items_status_ck;
  end if;
  alter table compliance_items add constraint compliance_items_status_ck check (
    status in ('conflicting','expired','blocked','needs_review',
               'expiring_soon','cannot_monitor','incomplete','complete')
  );
  alter table compliance_items add constraint compliance_items_status_override_ck check (
    status_override is null or status_override in
      ('conflicting','expired','blocked','needs_review',
       'expiring_soon','cannot_monitor','incomplete','complete')
  );
end $$;

alter table compliance_items alter column status set default 'incomplete';

-- Who changed what, and why.
--
-- Every edit went to a flat application log this page never reads, so the
-- question a compliance record exists to answer -- who moved this date, when,
-- and on what authority -- had nowhere to be answered from. On federal work
-- that is the question an auditor asks.
create table if not exists compliance_item_events (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references organizations(id) on delete cascade,
  item_id       uuid not null references compliance_items(id) on delete cascade,
  kind          text not null,
  -- What changed, in the words it will be read in.
  summary       text not null,
  -- The field-level before and after, for the cases where the sentence is not
  -- enough.
  changes       jsonb not null default '{}'::jsonb,
  actor_id      uuid references users(id) on delete set null,
  actor_label   text,
  created_at    timestamptz not null default now(),
  constraint compliance_item_events_kind_ck
    check (kind in ('created','edited','verified','state_changed','document','renewed','escalated','note')),
  constraint compliance_item_events_summary_ck check (length(btrim(summary)) > 0)
);

create index if not exists compliance_item_events_item_idx
  on compliance_item_events (item_id, created_at desc);

/*
 * History outlives the row it describes only as far as the organization: a
 * deleted item takes its events with it, which is the same rule the rest of
 * the schema uses. What must not happen is an event being deleted on its own
 * while the item it explains is still there.
 */
create or replace function compliance_event_immutable() returns trigger as $$
begin
  if tg_op = 'DELETE' then
    if exists (select 1 from compliance_items where id = old.item_id) then
      raise exception 'compliance_item_events rows cannot be deleted while the item exists';
    end if;
    return old;
  end if;
  raise exception 'compliance_item_events rows cannot be changed once written';
end $$ language plpgsql;

drop trigger if exists compliance_event_immutable_trg on compliance_item_events;
create trigger compliance_event_immutable_trg
  before update or delete on compliance_item_events
  for each row execute function compliance_event_immutable();
