-- Multi-tenant organizations, billing, password reset, and analytics events.
-- Existing rows are backfilled into a single "legacy" organization so the
-- current Brost Co deployment keeps working after migrate.

create table if not exists organizations (
  id                      uuid primary key default gen_random_uuid(),
  name                    text not null,
  slug                    text unique,
  -- Stripe
  stripe_customer_id      text unique,
  stripe_subscription_id  text unique,
  stripe_price_id         text,
  plan_key                text not null default 'none', -- none | standard | founding
  plan_amount_cents       integer,
  subscription_status     text not null default 'none',
  -- active | trialing | past_due | canceled | unpaid | incomplete | none
  price_locked            boolean not null default false,
  -- true when founding promo price must never be migrated to standard
  trial_ends_at           timestamptz,
  current_period_end      timestamptz,
  cancel_at_period_end    boolean not null default false,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

create index if not exists organizations_stripe_customer_idx
  on organizations (stripe_customer_id);
create index if not exists organizations_status_idx
  on organizations (subscription_status);

create table if not exists organization_members (
  org_id     uuid not null references organizations(id) on delete cascade,
  user_id    uuid not null references users(id) on delete cascade,
  role       text not null default 'owner', -- owner | admin | operator | viewer
  created_at timestamptz not null default now(),
  primary key (org_id, user_id)
);
create index if not exists organization_members_user_idx
  on organization_members (user_id);

-- Password reset tokens (single-use, short-lived).
create table if not exists password_reset_tokens (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references users(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  used_at    timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists password_reset_tokens_user_idx
  on password_reset_tokens (user_id);

-- Lightweight product analytics (landing + funnel).
create table if not exists analytics_events (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid references organizations(id) on delete set null,
  user_id    uuid references users(id) on delete set null,
  event      text not null,
  path       text,
  meta       jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists analytics_events_event_idx
  on analytics_events (event, created_at desc);
create index if not exists analytics_events_org_idx
  on analytics_events (org_id, created_at desc);

-- Seed one org for existing production data.
insert into organizations (id, name, slug, plan_key, subscription_status, price_locked)
select
  '00000000-0000-4000-8000-000000000001'::uuid,
  'BROST CO',
  'brost-co',
  'standard',
  'active',
  false
where not exists (
  select 1 from organizations where id = '00000000-0000-4000-8000-000000000001'::uuid
);

-- Attach existing users as owners of the legacy org.
insert into organization_members (org_id, user_id, role)
select '00000000-0000-4000-8000-000000000001'::uuid, u.id, 'owner'
  from users u
 where not exists (
   select 1 from organization_members m where m.user_id = u.id
 );

-- Add org_id to tenant-owned tables (nullable first, then backfill, then tighten).
alter table company_profile
  add column if not exists org_id uuid references organizations(id);
alter table scoring_weights
  add column if not exists org_id uuid references organizations(id);
alter table opportunities
  add column if not exists org_id uuid references organizations(id);
alter table subcontractors
  add column if not exists org_id uuid references organizations(id);
alter table quotes
  add column if not exists org_id uuid references organizations(id);
alter table pricing_comps
  add column if not exists org_id uuid references organizations(id);
alter table bids
  add column if not exists org_id uuid references organizations(id);
alter table contracts
  add column if not exists org_id uuid references organizations(id);
alter table communications
  add column if not exists org_id uuid references organizations(id);
alter table documents
  add column if not exists org_id uuid references organizations(id);
alter table templates
  add column if not exists org_id uuid references organizations(id);
alter table compliance_items
  add column if not exists org_id uuid references organizations(id);
alter table agent_logs
  add column if not exists org_id uuid references organizations(id);
alter table call_cards
  add column if not exists org_id uuid references organizations(id);
alter table integration_tokens
  add column if not exists org_id uuid references organizations(id);
alter table integration_settings
  add column if not exists org_id uuid references organizations(id);
alter table app_settings
  add column if not exists org_id uuid;
alter table content_library
  add column if not exists org_id uuid references organizations(id);
alter table custom_kpis
  add column if not exists org_id uuid references organizations(id);
alter table file_blobs
  add column if not exists org_id uuid references organizations(id);
alter table backlink_competitors
  add column if not exists org_id uuid references organizations(id);
alter table backlink_prospects
  add column if not exists org_id uuid references organizations(id);
alter table backlink_outreach
  add column if not exists org_id uuid references organizations(id);
alter table backlinks
  add column if not exists org_id uuid references organizations(id);
alter table authority_snapshots
  add column if not exists org_id uuid references organizations(id);

-- Backfill everything to the legacy org.
update company_profile set org_id = '00000000-0000-4000-8000-000000000001'::uuid where org_id is null;
update scoring_weights set org_id = '00000000-0000-4000-8000-000000000001'::uuid where org_id is null;
update opportunities set org_id = '00000000-0000-4000-8000-000000000001'::uuid where org_id is null;
update subcontractors set org_id = '00000000-0000-4000-8000-000000000001'::uuid where org_id is null;
update quotes set org_id = '00000000-0000-4000-8000-000000000001'::uuid where org_id is null;
update pricing_comps set org_id = '00000000-0000-4000-8000-000000000001'::uuid where org_id is null;
update bids set org_id = '00000000-0000-4000-8000-000000000001'::uuid where org_id is null;
update contracts set org_id = '00000000-0000-4000-8000-000000000001'::uuid where org_id is null;
update communications set org_id = '00000000-0000-4000-8000-000000000001'::uuid where org_id is null;
update documents set org_id = '00000000-0000-4000-8000-000000000001'::uuid where org_id is null;
update templates set org_id = '00000000-0000-4000-8000-000000000001'::uuid where org_id is null;
update compliance_items set org_id = '00000000-0000-4000-8000-000000000001'::uuid where org_id is null;
update agent_logs set org_id = '00000000-0000-4000-8000-000000000001'::uuid where org_id is null;
update call_cards set org_id = '00000000-0000-4000-8000-000000000001'::uuid where org_id is null;
update content_library set org_id = '00000000-0000-4000-8000-000000000001'::uuid where org_id is null;
update custom_kpis set org_id = '00000000-0000-4000-8000-000000000001'::uuid where org_id is null;
update file_blobs set org_id = '00000000-0000-4000-8000-000000000001'::uuid where org_id is null;
update backlink_competitors set org_id = '00000000-0000-4000-8000-000000000001'::uuid where org_id is null;
update backlink_prospects set org_id = '00000000-0000-4000-8000-000000000001'::uuid where org_id is null;
update backlink_outreach set org_id = '00000000-0000-4000-8000-000000000001'::uuid where org_id is null;
update backlinks set org_id = '00000000-0000-4000-8000-000000000001'::uuid where org_id is null;
update authority_snapshots set org_id = '00000000-0000-4000-8000-000000000001'::uuid where org_id is null;

-- integration_tokens / settings historically used provider as PK. Rebuild to
-- support per-org rows when the old unique provider constraint exists.
do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_name = 'integration_tokens' and column_name = 'provider'
  ) then
    update integration_tokens
       set org_id = '00000000-0000-4000-8000-000000000001'::uuid
     where org_id is null;
  end if;
  if exists (
    select 1 from information_schema.tables where table_name = 'integration_settings'
  ) then
    update integration_settings
       set org_id = '00000000-0000-4000-8000-000000000001'::uuid
     where org_id is null;
  end if;
end $$;

-- Indexes for tenant-scoped queries.
create index if not exists opportunities_org_idx on opportunities (org_id, stage, status);
create index if not exists subcontractors_org_idx on subcontractors (org_id);
create index if not exists call_cards_org_idx on call_cards (org_id, status);
create index if not exists documents_org_idx on documents (org_id);
create index if not exists quotes_org_idx on quotes (org_id);
create index if not exists bids_org_idx on bids (org_id);
create index if not exists communications_org_idx on communications (org_id);
create index if not exists company_profile_org_idx on company_profile (org_id, is_active);

-- Founding promo window (auto-set by app on first read if missing).
insert into app_settings (key, value_json)
values ('founding_promo', '{"ends_at": null, "started_at": null, "duration_days": 5}'::jsonb)
on conflict (key) do nothing;

-- RLS enable on new tables (owner connection bypasses).
do $$
declare
  tbl text;
begin
  foreach tbl in array array[
    'organizations', 'organization_members', 'password_reset_tokens', 'analytics_events'
  ]
  loop
    execute format('alter table public.%I enable row level security;', tbl);
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('revoke all on table public.%I from anon;', tbl);
    end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then
      execute format('revoke all on table public.%I from authenticated;', tbl);
    end if;
  end loop;
end $$;
