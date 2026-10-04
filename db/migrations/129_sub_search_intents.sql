-- A requested second search is not evidence that it ran.
create table sub_search_intents (
 id uuid primary key default gen_random_uuid(),
 org_id uuid not null references organizations(id) on delete cascade,
 opportunity_id uuid not null references opportunities(id) on delete cascade,
 pursuit_version integer not null,
 state text not null default 'requested' check(state in ('requested','dispatching','queued','completed')),
 queue_id text, created_at timestamptz not null default now(), completed_at timestamptz,
 unique(opportunity_id,pursuit_version)
);
alter table sub_search_intents enable row level security;
revoke all on sub_search_intents from public;
do $$ begin
 if exists(select 1 from pg_roles where rolname='anon') then revoke all on sub_search_intents from anon; end if;
 if exists(select 1 from pg_roles where rolname='authenticated') then revoke all on sub_search_intents from authenticated; end if;
end $$;
