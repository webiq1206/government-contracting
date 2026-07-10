-- Operator-defined KPIs for the Analytics dashboard. Each row picks one of a
-- fixed set of safe metrics (no free-form SQL) plus optional numeric params
-- (a lookback window, a minimum score). The dashboard computes each one live.
create table if not exists custom_kpis (
  id          uuid primary key default gen_random_uuid(),
  label       text not null,
  metric      text not null,
  params      jsonb not null default '{}'::jsonb,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now()
);
create index if not exists custom_kpis_sort_idx on custom_kpis (sort_order, created_at);

alter table custom_kpis enable row level security;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on table public.custom_kpis from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on table public.custom_kpis from authenticated;
  end if;
end $$;
