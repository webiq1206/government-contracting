-- Reusable content library. Operator-curated, pre-approved snippets (past-
-- performance write-ups, capability language, win themes, technical approaches,
-- boilerplate) that the AI agents retrieve from when drafting bid narratives and
-- Sources Sought responses. This is institutional knowledge the agents reuse so
-- every proposal gets stronger as the library grows. An empty library changes
-- nothing: retrieval returns nothing and the agents draft exactly as before.
create table if not exists content_library (
  id           uuid primary key default gen_random_uuid(),
  title        text not null,
  category     text not null default 'past_performance',
    -- past_performance | capability | win_theme | technical_approach | boilerplate
  body         text not null,
  tags         text[] not null default '{}',
    -- freeform keywords (trades, agencies, NAICS, topics) used to match content
    -- to an opportunity; the more specific the tags, the better the retrieval.
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists content_library_active_idx   on content_library (is_active);
create index if not exists content_library_category_idx on content_library (category);
create index if not exists content_library_tags_idx     on content_library using gin (tags);

-- Match the RLS posture of every other app table: the app's direct Postgres
-- connection (owner) bypasses RLS; the PostgREST public roles get nothing.
alter table content_library enable row level security;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on table public.content_library from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on table public.content_library from authenticated;
  end if;
end $$;
