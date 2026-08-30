-- ---------------------------------------------------------------------------
-- Migration 0100, the daily activity recap.
--
-- Three things get stored, and nothing else:
--
--   1. Where each person is, and whether they want the mail. A recap that
--      summarises "yesterday" has to know when yesterday ended for the person
--      reading it, and until now nothing in this product stored a time zone
--      for anybody. Six in the morning is only a promise if it means six where
--      they are.
--
--   2. What we sent, to whom, for which local day, with the rendered copy
--      kept. The rendered copy is the point: "resend it" and "what did it
--      actually say" are the two questions asked about a mail that went
--      astray, and regenerating the recap days later answers neither, because
--      the underlying records have moved on since.
--
--   3. Which urgent items have already been shown. An item that has been
--      urgent for four mornings should read as four days old, not as news.
--      That needs a memory of the first morning it appeared, which no
--      operational table holds.
-- ---------------------------------------------------------------------------

-- The reader's own time zone (IANA name, e.g. "America/Boise"). Null means
-- never chosen, and every consumer reads that as the account default rather
-- than as UTC: an unset value must not silently move somebody's morning.
alter table users add column if not exists timezone text;

-- Personal opt-out. The account decides who is eligible; a person can still
-- decline. Default false, because an eligible recipient who has never had an
-- opinion should receive the thing the account turned on.
alter table users add column if not exists recap_opt_out boolean not null default false;

-- ---------------------------------------------------------------------------
-- One row per recipient per local day per scope.
-- ---------------------------------------------------------------------------
create table if not exists recap_deliveries (
  id                  uuid primary key default gen_random_uuid(),
  -- Null only for the platform-wide recap, which is about every tenant and
  -- therefore belongs to none of them.
  org_id              uuid references organizations(id) on delete cascade,
  -- Kept nullable so a delivery record survives the person leaving. The
  -- history is an audit of what this system sent, and deleting the evidence
  -- along with the account would be the wrong half to keep.
  user_id             uuid references users(id) on delete set null,
  recipient_email     text not null,
  scope               text not null default 'org'
                        check (scope in ('org', 'platform')),
  -- The day being summarised, in the recipient's own zone. A date, not a
  -- timestamp: "which morning was this" has no time of day.
  local_date          date not null,
  -- The zone that produced local_date, recorded because it can change. A
  -- recipient who moves must not have yesterday's send re-evaluated under
  -- today's zone and sent twice.
  timezone            text not null,
  status              text not null default 'pending'
                        check (status in ('pending', 'sent', 'failed', 'bounced')),
  -- The scheduled window was missed and this went out later the same day. The
  -- mail says so; so does the history.
  late                boolean not null default false,
  -- Nothing of consequence happened, so the short variant was sent.
  quiet               boolean not null default false,
  -- A test send or a preview-driven send. Excluded from the once-per-day
  -- constraint below, because testing the thing must not consume the real
  -- morning's slot.
  test                boolean not null default false,
  due_at              timestamptz,
  sent_at             timestamptz,
  attempts            integer not null default 0,
  urgent_count        integer not null default 0,
  subject             text,
  -- The exact bytes that were sent. See the header.
  html                text,
  text_body           text,
  provider_message_id text,
  error               text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- The duplicate-send guard, and the reason a retry is safe. Two workers, a
-- restart mid-send, or a scheduler that fires twice in the same minute all end
-- at the same row instead of at two mails.
--
-- coalesce, because a null org_id (platform scope) would otherwise never
-- collide with itself: null is not equal to null in a unique index.
create unique index if not exists recap_deliveries_once_idx
  on recap_deliveries (
    coalesce(org_id, '00000000-0000-4000-8000-000000000000'::uuid),
    lower(recipient_email),
    local_date,
    scope
  )
  where test = false;

create index if not exists recap_deliveries_org_day_idx
  on recap_deliveries (org_id, local_date desc);

create index if not exists recap_deliveries_status_idx
  on recap_deliveries (status, sent_at desc);

-- Bounce matching looks up a recent send to this address.
create index if not exists recap_deliveries_recipient_idx
  on recap_deliveries (lower(recipient_email), sent_at desc);

-- ---------------------------------------------------------------------------
-- How long each urgent item has been urgent.
-- ---------------------------------------------------------------------------
create table if not exists recap_urgent_items (
  org_id       uuid not null references organizations(id) on delete cascade,
  -- A stable identity for the thing, not for the row that reported it:
  -- "deadline:<opportunity id>", "failed-send:<communication id>". The same
  -- key on a later morning is the same item, one day older.
  item_key     text not null,
  first_seen_on date not null,
  last_seen_on  date not null,
  created_at    timestamptz not null default now(),
  primary key (org_id, item_key)
);

create index if not exists recap_urgent_items_seen_idx
  on recap_urgent_items (org_id, last_seen_on desc);

-- ---------------------------------------------------------------------------
-- RLS lockdown, matching 002_rls.sql: the server connects as the table owner
-- and bypasses this, so it exists to deny the Supabase/PostgREST roles, which
-- have no business reading anybody's mail history.
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['recap_deliveries', 'recap_urgent_items'] loop
    execute format('alter table public.%I enable row level security;', t);
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('revoke all on table public.%I from anon;', t);
    end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then
      execute format('revoke all on table public.%I from authenticated;', t);
    end if;
  end loop;
end
$$;
