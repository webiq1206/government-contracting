-- What a firm can actually take on, and how to deal with them.
--
-- The record held identity and contact details and almost nothing about
-- capability, so the questions that decide whether a firm goes on a bid --
-- can they cover this county, can they carry a job this size, are they bonded
-- to this amount, do they hold the certification this solicitation sets aside
-- for -- lived in somebody's head or in a free-text note. Sub Finder could not
-- target on any of it and the roster could not filter on any of it.
--
-- Everything here is nullable and nothing defaults to a number. A firm whose
-- crew size nobody has asked about has no crew size; writing 0 would put them
-- last in every capacity sort and read as a firm with nobody on the books.

alter table subcontractors
  -- Where they will actually travel. The state list is the coarse answer and
  -- the radius the fine one; a firm may have either, both or neither.
  add column if not exists service_area_states   text[],
  add column if not exists service_radius_miles  integer,
  add column if not exists service_area_note     text,

  -- How much they can carry.
  add column if not exists crew_size             integer,
  add column if not exists concurrent_jobs       integer,
  add column if not exists min_project_cents     bigint,
  add column if not exists max_project_cents     bigint,

  -- Bonding, which is a gate on federal work rather than a nice-to-have.
  add column if not exists bonded                boolean,
  add column if not exists bond_single_cents     bigint,
  add column if not exists bond_aggregate_cents  bigint,
  add column if not exists bond_surety           text,

  -- Set-aside certifications. An array because firms hold several, and the
  -- values are checked against a written list in the application rather than
  -- here, so adding one does not need a migration.
  add column if not exists certifications        text[],

  -- How to deal with them.
  add column if not exists payment_terms         text,
  add column if not exists quote_validity_days   integer,
  add column if not exists preferred_contact     text,
  add column if not exists time_zone             text,

  -- Where this record came from and how much of it to believe. A row a
  -- sourcing agent built from a map listing is not the same kind of fact as
  -- one an estimator typed after a phone call, and the roster showed them
  -- identically.
  add column if not exists source                text,
  add column if not exists source_confidence     text,
  add column if not exists capability_updated_at timestamptz,
  add column if not exists capability_updated_by uuid references users(id) on delete set null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'subcontractors_capacity_ck') then
    alter table subcontractors add constraint subcontractors_capacity_ck check (
      (crew_size is null or crew_size > 0)
      and (concurrent_jobs is null or concurrent_jobs > 0)
      and (service_radius_miles is null or service_radius_miles > 0)
      and (quote_validity_days is null or quote_validity_days > 0)
      -- Zero is a real minimum ("no floor"), so only negatives are refused.
      and (min_project_cents is null or min_project_cents >= 0)
      and (max_project_cents is null or max_project_cents >= 0)
      and (min_project_cents is null or max_project_cents is null
           or max_project_cents >= min_project_cents)
      and (bond_single_cents is null or bond_single_cents >= 0)
      and (bond_aggregate_cents is null or bond_aggregate_cents >= 0)
      and (bond_single_cents is null or bond_aggregate_cents is null
           or bond_aggregate_cents >= bond_single_cents)
    );
  end if;

  if not exists (select 1 from pg_constraint where conname = 'subcontractors_preferred_contact_ck') then
    alter table subcontractors add constraint subcontractors_preferred_contact_ck
      check (preferred_contact is null or preferred_contact in ('email','phone','text'));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'subcontractors_source_confidence_ck') then
    alter table subcontractors add constraint subcontractors_source_confidence_ck
      check (source_confidence is null or source_confidence in ('confirmed','reported','inferred'));
  end if;

  -- Bonded with no amount is a claim, not a figure, and both are allowed. But
  -- an amount with `bonded` false contradicts itself.
  if not exists (select 1 from pg_constraint where conname = 'subcontractors_bond_ck') then
    alter table subcontractors add constraint subcontractors_bond_ck check (
      bonded is not false
      or (bond_single_cents is null and bond_aggregate_cents is null)
    );
  end if;
end $$;

-- The people at the firm, rather than one owner_name and one address.
--
-- A subcontractor is reached through a person: an estimator who prices, a
-- foreman who runs the crew, an office manager who sends the certificates.
-- Sending every message to whichever address the sourcing agent found first
-- is how a quote request lands with somebody who does not price work.
create table if not exists subcontractor_contacts (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references organizations(id) on delete cascade,
  subcontractor_id  uuid not null references subcontractors(id) on delete cascade,
  name              text not null,
  role              text not null,
  email             text,
  phone             text,
  -- Verified separately from the firm's own address: a person's address can
  -- be good while the info@ box bounces, and the reverse.
  email_verified    boolean not null default false,
  is_primary        boolean not null default false,
  note              text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint subcontractor_contacts_role_ck
    check (role in ('estimator','owner','foreman','office','accounts','other')),
  constraint subcontractor_contacts_name_ck check (length(btrim(name)) > 0),
  -- A person with neither an address nor a number is a name in a box.
  constraint subcontractor_contacts_reachable_ck
    check (coalesce(btrim(email), '') <> '' or coalesce(btrim(phone), '') <> '')
);

create index if not exists subcontractor_contacts_sub_idx
  on subcontractor_contacts (subcontractor_id);

-- One primary per firm, enforced rather than agreed.
create unique index if not exists subcontractor_contacts_one_primary_idx
  on subcontractor_contacts (subcontractor_id)
  where is_primary = true;

-- Licences per trade, because one flat licence number cannot say that a firm
-- is licensed for mechanical work and not for electrical.
create table if not exists subcontractor_licenses (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references organizations(id) on delete cascade,
  subcontractor_id  uuid not null references subcontractors(id) on delete cascade,
  trade             text not null,
  jurisdiction      text,
  number            text,
  -- Null means nobody has checked, which is not the same as not active.
  status            text,
  expires_at        date,
  verified_at       timestamptz,
  source            text,
  created_at        timestamptz not null default now(),
  constraint subcontractor_licenses_trade_ck check (length(btrim(trade)) > 0),
  constraint subcontractor_licenses_status_ck
    check (status is null or status in ('active','expired','suspended','not_found'))
);

create index if not exists subcontractor_licenses_sub_idx
  on subcontractor_licenses (subcontractor_id);

create unique index if not exists subcontractor_licenses_unique_idx
  on subcontractor_licenses (subcontractor_id, lower(trade), coalesce(lower(jurisdiction), ''));
