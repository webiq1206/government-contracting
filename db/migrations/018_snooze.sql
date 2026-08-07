-- 018: Snooze. Lets the operator push a Today item (opportunity or call card)
-- out of sight until a chosen time; the item returns automatically. Snoozing
-- only affects what Today/queues SHOW, never the underlying automation:
-- deadline monitors, sweeps, and follow-ups keep running regardless.
alter table opportunities add column if not exists snoozed_until timestamptz;
alter table call_cards    add column if not exists snoozed_until timestamptz;

create index if not exists opportunities_snoozed_idx on opportunities (snoozed_until)
  where snoozed_until is not null;
