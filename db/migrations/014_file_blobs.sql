-- Durable document storage in Postgres. Generated bid PDFs/DOCX and captured
-- solicitation attachments are stored here as bytea so they survive redeploys
-- (Replit's disk is ephemeral) WITHOUT any external object-storage service. The
-- database is already the platform's durable source of truth, so files ride
-- along with it, no separate account that can lapse or be paused.
create table if not exists file_blobs (
  path        text primary key,
  mime        text,
  bytes       bytea not null,
  created_at  timestamptz not null default now()
);

alter table file_blobs enable row level security;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on table public.file_blobs from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on table public.file_blobs from authenticated;
  end if;
end $$;
