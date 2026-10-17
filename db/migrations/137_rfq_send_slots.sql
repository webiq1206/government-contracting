-- One claimed quote-request slot per in-flight send.
--
-- The daily cap used to count mail already recorded, then send. Parallel
-- outreach jobs all read the same count and all sent. A row in rfq_daily_slots
-- is locked for the account's UTC day, and the claim is inserted in that same
-- transaction, before the mailbox is called. Nothing here is removed.

create table rfq_daily_slots (
  org_id uuid not null references organizations(id) on delete cascade,
  utc_day date not null,
  primary key (org_id, utc_day)
);
alter table rfq_daily_slots enable row level security;
create policy brostco_tenant_access on rfq_daily_slots as permissive for all
  using (org_id = nullif(current_setting('brostco.org_id', true), '')::uuid)
  with check (org_id = nullif(current_setting('brostco.org_id', true), '')::uuid);
create policy brostco_tenant_boundary on rfq_daily_slots as restrictive for all
  using (org_id = nullif(current_setting('brostco.org_id', true), '')::uuid)
  with check (org_id = nullif(current_setting('brostco.org_id', true), '')::uuid);
revoke all on rfq_daily_slots from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then revoke all on rfq_daily_slots from anon; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then revoke all on rfq_daily_slots from authenticated; end if;
end $$;
create trigger rfq_daily_slots_tenant_owner before update of org_id on rfq_daily_slots
  for each row execute function prevent_tenant_reassignment();

create table rfq_send_claims (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  utc_day date not null,
  opportunity_id uuid not null,
  subcontractor_id uuid not null,
  trade text not null default '',
  state text not null check (state in ('reserved', 'sent', 'released')),
  created_at timestamptz not null default now()
);
create index rfq_send_claims_reserved_idx
  on rfq_send_claims (org_id, utc_day)
  where state = 'reserved';
alter table rfq_send_claims enable row level security;
create policy brostco_tenant_access on rfq_send_claims as permissive for all
  using (org_id = nullif(current_setting('brostco.org_id', true), '')::uuid)
  with check (org_id = nullif(current_setting('brostco.org_id', true), '')::uuid);
create policy brostco_tenant_boundary on rfq_send_claims as restrictive for all
  using (org_id = nullif(current_setting('brostco.org_id', true), '')::uuid)
  with check (org_id = nullif(current_setting('brostco.org_id', true), '')::uuid);
revoke all on rfq_send_claims from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then revoke all on rfq_send_claims from anon; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then revoke all on rfq_send_claims from authenticated; end if;
end $$;
create trigger rfq_send_claims_tenant_owner before update of org_id on rfq_send_claims
  for each row execute function prevent_tenant_reassignment();
