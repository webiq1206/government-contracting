-- A daily ledger of SAM.gov calls, per organization.
--
-- SAM rate limits a public API key at roughly 1,000 requests a day. The
-- opportunity monitor was budgeted at 150 requests per run on a two-hourly
-- cron: twelve runs, about 1,800 requests, comfortably past the ceiling before
-- counting the entity and exclusion lookups that draw on the same quota.
--
-- Now that every organization supplies its own key, that is not a
-- key-sharing problem, it is every customer exceeding their own limit and
-- having ingestion throttled by SAM without the platform ever saying why.
--
-- Arithmetic alone cannot hold this: the cron can be retuned, an agent can be
-- run by hand, and entity lookups happen outside the monitor entirely. A
-- ledger the client checks on every call is the only version that stays true.

create table if not exists sam_daily_calls (
  org_id  uuid not null references organizations(id) on delete cascade,
  -- UTC day. SAM's own reset is not published precisely, so a fixed UTC
  -- boundary is the predictable choice and errs toward under-using.
  day     date not null default (now() at time zone 'utc')::date,
  calls   integer not null default 0,
  primary key (org_id, day)
);

-- Yesterday's rows are dead weight; the retention sweep can trim them.
create index if not exists sam_daily_calls_day_idx on sam_daily_calls (day);
