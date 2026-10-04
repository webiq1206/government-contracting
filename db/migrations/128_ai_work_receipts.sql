-- Work-level receipts survive a lost provider settlement ACK and later sweeps.
create table ai_work_receipts (
 org_id uuid not null references organizations(id) on delete cascade,
 work_key text not null, scope_key text not null, input_hash text not null, owner uuid not null,
 state text not null check(state in ('pending','complete','retryable')),
 result jsonb, started_at timestamptz not null default now(), completed_at timestamptz,
 primary key(org_id,work_key)
);
alter table ai_work_receipts enable row level security;
revoke all on ai_work_receipts from public;
do $$ begin
 if exists(select 1 from pg_roles where rolname='anon') then revoke all on ai_work_receipts from anon; end if;
 if exists(select 1 from pg_roles where rolname='authenticated') then revoke all on ai_work_receipts from authenticated; end if;
end $$;

create index ai_work_receipts_pending_scope on ai_work_receipts(org_id,scope_key) where state='pending';
