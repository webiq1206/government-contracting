-- Costs stay NUMERIC in SQL. Round only the aggregate invoice, never each call.
create table api_usage_preferences (
  org_id uuid not null references organizations(id),
  env_key text not null,
  source text not null check (source in ('platform','tenant')),
  accepted_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (org_id, env_key),
  check (source <> 'platform' or accepted_at is not null)
);
create table api_usage_events (
  id uuid primary key,
  org_id uuid references organizations(id),
  user_id text,
  provider text not null,
  service text not null,
  feature text not null,
  workflow text,
  related_id text,
  credential_source text not null check (credential_source in ('platform','tenant','unknown')),
  credential_fingerprint text not null,
  billing_accepted boolean not null default false,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  outcome text not null default 'pending' check (outcome in ('pending','success','failed')),
  provider_request_id text,
  usage jsonb not null default '{}',
  provider_cost numeric(24,12) check (provider_cost >= 0),
  reserved_cost numeric(24,12) not null default 0 check(reserved_cost >= 0),
  estimated_cost numeric(24,12) check (estimated_cost >= 0),
  tenant_charge numeric(24,12) generated always as
    (case when credential_source = 'platform' and billing_accepted then provider_cost * 1.25 else 0 end) stored,
  currency text not null default 'USD' check (currency = 'USD'),
  billing_status text not null default 'review' check (billing_status in ('review','unbilled','pending','billed','paid','credited','refunded','not_billable')),
  evidence text,
  error_code text,
  invoice_reference text
);
create index api_usage_events_time on api_usage_events(started_at desc, id);
create index api_usage_events_org_time on api_usage_events(org_id, started_at desc);
create index api_usage_events_provider_request on api_usage_events(provider, provider_request_id) where provider_request_id is not null;
create index api_usage_events_unbilled on api_usage_events(org_id, billing_status) where credential_source = 'platform';
create table api_usage_limits (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references organizations(id),
  provider text not null default '*',
  feature text not null default '*',
  monthly_limit numeric(24,12) check (monthly_limit >= 0),
  warning_percent integer not null default 80 check (warning_percent between 1 and 100),
  paused boolean not null default false,
  require_tenant_key boolean not null default false,
  updated_at timestamptz not null default now()
);
create unique index api_usage_limits_scope on api_usage_limits(coalesce(org_id::text,''), provider, feature);
create table api_usage_audit (
  id bigserial primary key,
  occurred_at timestamptz not null default now(),
  org_id uuid references organizations(id),
  actor text not null,
  action text not null,
  details jsonb not null
);
create table api_usage_rates (
  provider text not null,
  service text not null,
  -- Dollar prices per million units. Provider invoices remain authoritative.
  rates jsonb not null,
  max_request_cost numeric(24,12) check(max_request_cost >= 0),
  evidence text not null,
  updated_at timestamptz not null default now(),
  primary key(provider, service)
);
-- No public Supabase API access. Server routes perform their own admin/tenant guards.
revoke all on api_usage_events, api_usage_preferences, api_usage_limits, api_usage_audit, api_usage_rates from public;
create table api_usage_invoice_batches (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  created_at timestamptz not null default now(),
  exact_amount numeric(24,12) not null,
  amount_cents bigint not null check(amount_cents > 0),
  stripe_invoice_id text unique,
  stripe_item_id text,
  status text not null default 'preparing' check(status in ('preparing','draft','open','paid','void','uncollectible'))
);
alter table api_usage_events add column batch_id uuid references api_usage_invoice_batches(id);
create unique index api_usage_batch_preparing on api_usage_invoice_batches(org_id) where status='preparing';
revoke all on api_usage_invoice_batches from public;
alter table api_usage_events enable row level security;
alter table api_usage_preferences enable row level security;
alter table api_usage_limits enable row level security;
alter table api_usage_audit enable row level security;
alter table api_usage_rates enable row level security;
alter table api_usage_invoice_batches enable row level security;
-- No client policies: costs and credentials are available only through guarded server routes.
create table api_usage_provider_reports (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null check(ends_at>starts_at),
  reported_cost numeric(24,12) not null check(reported_cost>=0),
  tracked_cost numeric(24,12) not null,
  unknown_calls integer not null,
  evidence text not null,
  created_at timestamptz not null default now()
);
revoke all on api_usage_provider_reports from public;
alter table api_usage_provider_reports enable row level security;
