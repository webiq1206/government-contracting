-- Independent account controls cannot overwrite platform-enforced limits.
create table api_account_budgets (
  org_id uuid primary key references organizations(id),
  daily_limit numeric(24,12) check(daily_limit >= 0),
  monthly_limit numeric(24,12) check(monthly_limit >= 0),
  daily_requests integer check(daily_requests >= 0),
  paused boolean not null default false,
  allow_complex boolean not null default true,
  updated_at timestamptz not null default now()
);
revoke all on api_account_budgets from public;
alter table api_account_budgets enable row level security;

alter table api_usage_limits add column daily_requests integer check(daily_requests >= 0);
