-- 017: Generic app-level settings (non-secret platform state). First use:
-- the automation pause switch. Unlike integration_settings these values are
-- not credentials, so they are stored as plain jsonb.
create table if not exists app_settings (
  key        text primary key,
  value_json jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by text
);

-- RLS: match every other app table (owner connection bypasses; PostgREST denied).
do $$
begin
  execute 'alter table public.app_settings enable row level security;';
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on table public.app_settings from anon;';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on table public.app_settings from authenticated;';
  end if;
end $$;
