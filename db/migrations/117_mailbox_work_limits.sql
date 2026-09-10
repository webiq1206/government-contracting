create table gmail_quota_windows (
  mailbox_key text primary key,
  window_start timestamptz not null,
  units integer not null check (units between 0 and 2500)
);
alter table gmail_quota_windows enable row level security;
revoke all on gmail_quota_windows from public;

create table mailbox_scan_cursors (
  org_id uuid not null references organizations(id) on delete cascade,
  purpose text not null,
  after_sec bigint not null,
  scan_started_sec bigint not null,
  page_token text,
  updated_at timestamptz not null default now(),
  primary key (org_id, purpose)
);
alter table mailbox_scan_cursors enable row level security;
revoke all on mailbox_scan_cursors from public;
