-- A prospective preview never settles or adopts historical work. The global
-- fence also covers shared platform credentials. No expiry means no replay
-- after a stopped process or an uncertain provider/commit acknowledgement.
create table prospective_previews (
 id uuid primary key,
 org_id uuid not null references organizations(id),
 opportunity_id uuid not null references opportunities(id),
 pursuit_version integer not null,
 idempotency_key text not null,
 input_hash text not null,
 specification jsonb not null,
 approved_usd numeric(24,12) not null check(approved_usd >= 0),
 max_requests integer not null check(max_requests between 0 and 2),
 reserved_usd numeric(24,12) not null default 0 check(reserved_usd >= 0),
 requests integer not null default 0 check(requests >= 0),
 state text not null default 'prepared' check(state in ('prepared','running','complete','held')),
 owner uuid,
 result jsonb,
 created_by text not null,
 created_at timestamptz not null default now(),
 finished_at timestamptz,
 unique(org_id,idempotency_key),
 -- New keys, changed prompts and new approvals cannot replay the same scope.
 unique(org_id,opportunity_id,pursuit_version)
);
create table prospective_fence (
 id boolean primary key default true check(id),
 preview_id uuid not null references prospective_previews(id),
 rollout_reference text not null,
 activated_by text not null,
 activated_at timestamptz not null default now(),
 released_by text,
 released_at timestamptz
);
create table prospective_dispatch_claims (
 id uuid primary key,
 kind text not null check(kind in ('agent','enqueue','mail','api')),
 started_at timestamptz not null default now(),
 finished_at timestamptz
);
create index prospective_dispatch_open on prospective_dispatch_claims(id) where finished_at is null;
create table prospective_attempts (
 preview_id uuid not null references prospective_previews(id),
 step text not null check(step in ('recovery','analysis')),
 usage_id uuid not null unique references api_usage_events(id),
 reserved_usd numeric(24,12) not null check(reserved_usd > 0),
 primary key(preview_id,step)
);
do $$ declare t text; begin
 foreach t in array array['prospective_previews','prospective_fence','prospective_dispatch_claims','prospective_attempts'] loop
  execute format('alter table %I enable row level security',t);
  execute format('revoke all on %I from public',t);
  if exists(select 1 from pg_roles where rolname='anon') then execute format('revoke all on %I from anon',t); end if;
  if exists(select 1 from pg_roles where rolname='authenticated') then execute format('revoke all on %I from authenticated',t); end if;
 end loop;
end $$;
