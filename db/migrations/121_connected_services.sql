-- Connected apps: calendars, file storage, team channels and webhooks that a
-- customer links to their account. Distinct from integration_settings (API
-- keys the platform calls on the customer's behalf) and integration_tokens
-- (the one mailbox per organization). A connection is company-wide
-- (user_id null) or personal; tokens are encrypted with the same key as
-- every other stored credential.
create table connected_services (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  user_id uuid references users(id) on delete cascade,
  provider text not null,
  status text not null default 'connected'
    check (status in ('connected','needs_attention','paused','disconnected')),
  account_label text,
  external_id text,
  scopes text[] not null default '{}',
  token_enc text,
  settings jsonb not null default '{}'::jsonb,
  last_error text,
  last_synced_at timestamptz,
  paused_at timestamptz,
  disconnected_at timestamptz,
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index connected_services_company_uniq
  on connected_services (org_id, provider) where user_id is null and status <> 'disconnected';
create unique index connected_services_personal_uniq
  on connected_services (org_id, provider, user_id) where user_id is not null and status <> 'disconnected';
create index connected_services_org_idx on connected_services (org_id, provider, status);
alter table connected_services enable row level security;
revoke all on connected_services from public;

-- What has already been pushed where, so a deadline is one calendar event
-- and a reply is one channel message, however often the sync runs.
create table connected_service_items (
  id bigserial primary key,
  service_id uuid not null references connected_services(id) on delete cascade,
  org_id uuid not null references organizations(id) on delete cascade,
  kind text not null,
  local_key text not null,
  remote_id text,
  fingerprint text,
  status text not null default 'synced' check (status in ('synced','failed','removed')),
  last_error text,
  synced_at timestamptz not null default now(),
  unique (service_id, kind, local_key)
);
create index connected_service_items_org_idx on connected_service_items (org_id, kind);
alter table connected_service_items enable row level security;
revoke all on connected_service_items from public;

-- Outbound webhooks (Zapier, Make, anything that takes a signed POST).
create table outbound_webhooks (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  label text not null,
  url text not null,
  secret_enc text not null,
  events text[] not null default '{}',
  active boolean not null default true,
  created_by uuid references users(id) on delete set null,
  last_status text,
  last_delivered_at timestamptz,
  failure_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index outbound_webhooks_org_idx on outbound_webhooks (org_id, active);
alter table outbound_webhooks enable row level security;
revoke all on outbound_webhooks from public;

create table webhook_deliveries (
  id uuid primary key default gen_random_uuid(),
  webhook_id uuid not null references outbound_webhooks(id) on delete cascade,
  org_id uuid not null references organizations(id) on delete cascade,
  event text not null,
  event_key text not null,
  payload jsonb not null,
  status text not null default 'pending' check (status in ('pending','delivered','failed','abandoned')),
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  response_status integer,
  last_error text,
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  unique (webhook_id, event_key)
);
create index webhook_deliveries_due_idx on webhook_deliveries (status, next_attempt_at);
alter table webhook_deliveries enable row level security;
revoke all on webhook_deliveries from public;

-- Where each organization's notification fan-out has read up to.
create table connected_service_cursors (
  org_id uuid not null references organizations(id) on delete cascade,
  purpose text not null,
  after_id bigint not null default 0,
  updated_at timestamptz not null default now(),
  primary key (org_id, purpose)
);
alter table connected_service_cursors enable row level security;
revoke all on connected_service_cursors from public;
