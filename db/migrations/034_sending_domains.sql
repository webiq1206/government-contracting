-- Per-tenant outreach sending domains.
--
-- Outreach is sent from OUR infrastructure (Resend), not from the customer's
-- Gmail, so no customer ever registers an OAuth app or clears Google
-- verification. Each org proves ownership of a sending domain once via DNS,
-- and from then on their subcontractor email comes from their own address.
--
-- Until a domain is verified the platform falls back to a shared, platform
-- owned domain with the tenant's real address as Reply-To, so a brand new
-- customer can send on day one without touching DNS.

create table if not exists organization_sending_domains (
  org_id             uuid primary key references organizations(id) on delete cascade,
  -- The domain proved via DNS, e.g. "mail.customerco.com".
  domain             text not null,
  -- Local part and display name used to build the From header.
  from_local         text not null default 'bids',
  from_name          text,
  -- Where subcontractor replies should land. Always a real inbox the customer
  -- already reads; never depends on the sending domain being verified.
  reply_to           text,
  -- Resend's id for this domain, used for verify/status polling.
  provider_domain_id text,
  -- pending | verified | failed
  status             text not null default 'pending',
  -- DNS records the customer must add, as returned by the provider.
  dns_records        jsonb not null default '[]'::jsonb,
  last_error         text,
  last_checked_at    timestamptz,
  verified_at        timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists org_sending_domains_status_idx
  on organization_sending_domains (status);

-- One domain can only be claimed by one org, so a tenant cannot hijack another
-- tenant's verified sending identity by claiming the same name.
create unique index if not exists org_sending_domains_domain_uniq
  on organization_sending_domains (lower(domain));

-- The founding tenant already sends from info@brostco.com through a Resend
-- domain verified outside this table. Seed it as verified so behaviour is
-- byte-identical after this migration and the legacy org is simply the first
-- row rather than a special case in code. provider_domain_id stays null: it is
-- only needed to re-poll verification, which this domain does not need.
insert into organization_sending_domains
  (org_id, domain, from_local, from_name, reply_to, status, verified_at)
select o.id, 'brostco.com', 'info', 'BROSTCO', 'info@brostco.com', 'verified', now()
from organizations o
where o.id = '00000000-0000-4000-8000-000000000001'::uuid
on conflict (org_id) do nothing;
