alter table api_usage_events add column last_reconciled_at timestamptz;
create table api_usage_billing_settings (
 org_id uuid primary key references organizations(id) on delete cascade,
 automatic boolean not null default false,
 enabled_at timestamptz,
 updated_at timestamptz not null default now()
);
create table api_usage_billing_periods (
 org_id uuid not null references organizations(id) on delete cascade,
 subscription_id text not null,
 starts_at timestamptz not null,
 ends_at timestamptz not null check(ends_at>starts_at),
 primary key(org_id,starts_at)
);
alter table api_usage_invoice_batches add column period_start timestamptz, add column period_end timestamptz;
create table api_usage_adjustments (
 id uuid primary key,
 batch_id uuid not null references api_usage_invoice_batches(id),
 org_id uuid not null references organizations(id),
 amount_cents bigint not null check(amount_cents>0),
 kind text not null check(kind in ('credit','refund')),
 reason text not null,
 actor text not null,
 status text not null default 'preparing' check(status in ('preparing','complete','review')),
 stripe_credit_note_id text unique,
 settlement_status text not null default 'pending',
 last_checked_at timestamptz,
 created_at timestamptz not null default now()
);
create table api_usage_sync_runs (
 id uuid primary key default gen_random_uuid(),
 provider text not null,
 status text not null,
 detail text not null,
 created_at timestamptz not null default now()
);
create table api_usage_job_leases (name text primary key, expires_at timestamptz not null);
create unique index api_usage_report_period on api_usage_provider_reports(provider,starts_at,ends_at) where evidence like 'Automatic:%';
do $$ declare t text; begin
 foreach t in array array['api_usage_billing_settings','api_usage_billing_periods','api_usage_adjustments','api_usage_sync_runs','api_usage_job_leases'] loop
 execute format('alter table %I enable row level security',t);
 execute format('revoke all on %I from public',t);
 end loop;
end $$;

create trigger activity_capture after insert or update or delete on api_usage_adjustments for each row execute function capture_activity();
