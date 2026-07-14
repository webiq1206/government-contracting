-- Site-authority / backlink acquisition module.
-- Autonomous discovery + qualification + monitoring; the actual outreach/submission
-- is executed only after human approval (an `approval_status` gate), so the
-- platform never sends or publishes unattended.

-- Competitors whose backlink profiles we mine for prospects (auto-discovered
-- from Ahrefs organic competitors, or operator-added).
create table if not exists backlink_competitors (
  id            uuid primary key default gen_random_uuid(),
  domain        text not null unique,
  source        text not null default 'ahrefs_auto',  -- ahrefs_auto | operator
  domain_rating numeric,
  last_scanned_at timestamptz,
  created_at    timestamptz not null default now()
);

-- A candidate site/page we could earn a link from.
create table if not exists backlink_prospects (
  id                uuid primary key default gen_random_uuid(),
  domain            text not null,
  url               text,                       -- specific page (resource page, broken link, mention)
  opportunity_type  text not null,              -- competitor_gap | resource_page | broken_link |
                                                -- unlinked_mention | directory | association |
                                                -- guest_post | haro | partnership | supplier
  -- Qualification metrics (from Ahrefs / checks).
  domain_rating     numeric,                    -- DR 0-100
  relevance         numeric,                    -- 0-1 topical relevance to our niche
  traffic           bigint,                     -- est. monthly organic traffic
  spam_score        numeric,                    -- 0-100 (higher = spammier)
  indexed           boolean,                    -- indexed in Google
  link_type         text,                       -- dofollow | nofollow | unknown
  -- Derived qualification.
  priority_score    numeric,                    -- 0-100 composite, higher = pursue first
  tier              text,                       -- high | medium | low | reject
  qualification_json jsonb,                     -- reasons + raw metric snapshot
  -- Contact + provenance.
  contact_email     text,
  contact_json      jsonb,
  discovered_via    text,                       -- which finder/competitor surfaced it
  competitor_id     uuid references backlink_competitors(id) on delete set null,
  status            text not null default 'new', -- new | qualified | rejected | in_outreach | won | lost
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (domain, opportunity_type)
);
create index if not exists backlink_prospects_status_idx on backlink_prospects (status);
create index if not exists backlink_prospects_priority_idx on backlink_prospects (priority_score desc);

-- The outreach/acquisition action for a prospect. Drafted automatically, but
-- NOT executed until approval_status = 'approved' (human gate).
create table if not exists backlink_outreach (
  id              uuid primary key default gen_random_uuid(),
  prospect_id     uuid not null references backlink_prospects(id) on delete cascade,
  channel         text not null default 'email',   -- email | form | submission
  subject         text,
  body            text,
  approval_status text not null default 'pending', -- pending | approved | rejected | auto
  sent_at         timestamptz,
  replied_at      timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists backlink_outreach_approval_idx on backlink_outreach (approval_status);

-- Backlinks we actually have (tracked for won/lost detection).
create table if not exists backlinks (
  id               uuid primary key default gen_random_uuid(),
  source_domain    text not null,
  source_url       text,
  target_url       text,
  anchor           text,
  domain_rating    numeric,
  link_type        text,                         -- dofollow | nofollow
  first_seen_at    timestamptz not null default now(),
  last_seen_at     timestamptz not null default now(),
  lost_at          timestamptz,                  -- set when a previously-seen link disappears
  prospect_id      uuid references backlink_prospects(id) on delete set null,
  raw_json         jsonb,
  unique (source_url, target_url)
);
create index if not exists backlinks_lost_idx on backlinks (lost_at);

-- Point-in-time authority snapshots (our DR + referring domains) to chart the
-- trend toward DR 50.
create table if not exists authority_snapshots (
  id                uuid primary key default gen_random_uuid(),
  domain_rating     numeric,
  referring_domains integer,
  backlinks_total   integer,
  captured_at       timestamptz not null default now()
);

-- RLS: match every other app table (owner connection bypasses; PostgREST denied).
do $$
declare t text;
begin
  foreach t in array array['backlink_competitors','backlink_prospects','backlink_outreach','backlinks','authority_snapshots'] loop
    execute format('alter table public.%I enable row level security;', t);
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('revoke all on table public.%I from anon;', t);
    end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then
      execute format('revoke all on table public.%I from authenticated;', t);
    end if;
  end loop;
end $$;
