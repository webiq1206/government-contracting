-- Subcontractor compliance documents: W-9s and certificates of insurance.
--
-- Distinct from the influencer program, where Stripe Connect collects tax
-- information for us. Subcontractors are not paid through Stripe, so the W-9
-- has to be collected and stored here, and a 1099-NEC issued for anyone paid
-- $600 or more in a calendar year.
--
-- The part that carries real risk is expiry. A certificate of insurance that
-- lapsed mid-project can void coverage and, on federal work, put the prime in
-- breach. So every document carries an explicit expiry and the platform is
-- expected to act on it rather than merely store it.

create table if not exists subcontractor_documents (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid references organizations(id) on delete cascade,
  subcontractor_id  uuid not null references subcontractors(id) on delete cascade,
  -- w9 | coi_general_liability | coi_workers_comp | coi_auto | license | other
  doc_type          text not null,
  -- Stored file, referenced the same way as every other document we hold.
  storage_path      text,
  original_filename text,
  mime_type         text,

  -- Insurance specifics. Null on a W-9.
  carrier           text,
  policy_number     text,
  coverage_cents    bigint,
  -- Null means the document does not expire (a signed W-9 does not, though it
  -- must be refreshed when the sub's details change).
  effective_at      timestamptz,
  expires_at        timestamptz,

  /**
   * E-signature evidence for documents signed in the platform.
   *
   * A typed signature with an audit trail satisfies the E-SIGN Act, which is
   * what a W-9 needs. Capturing intent, identity, time, and source address is
   * what makes it hold up later; storing only the image would not.
   */
  signed_name       text,
  signed_at         timestamptz,
  signed_ip         text,
  signed_user_agent text,
  -- Hash of the exact rendered document the signer agreed to, so a later
  -- dispute can prove what was on screen at the time.
  signed_doc_hash   text,

  -- pending | active | expiring | expired | rejected
  status            text not null default 'pending',
  -- Set when a human checks the document rather than trusting the upload.
  verified_by       uuid references users(id),
  verified_at       timestamptz,
  rejection_reason  text,
  notes             text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists sub_documents_sub_idx
  on subcontractor_documents (subcontractor_id, doc_type);
create index if not exists sub_documents_org_idx on subcontractor_documents (org_id);
-- Drives the expiry sweep and the "expiring soon" surface.
create index if not exists sub_documents_expiry_idx
  on subcontractor_documents (expires_at)
  where expires_at is not null and status <> 'rejected';

-- One current document per type per subcontractor. Superseded versions are
-- kept for the audit trail by marking them rejected or letting them expire,
-- never by deleting: proving what was on file on a given date is the point.
create unique index if not exists sub_documents_current_uniq
  on subcontractor_documents (subcontractor_id, doc_type)
  where status in ('pending', 'active', 'expiring');

-- Annual 1099 tracking. Payments are recorded per calendar year so the $600
-- reporting threshold can be evaluated without scanning every bid.
create table if not exists subcontractor_payments (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid references organizations(id) on delete cascade,
  subcontractor_id  uuid not null references subcontractors(id) on delete cascade,
  opportunity_id    uuid references opportunities(id) on delete set null,
  amount_cents      bigint not null,
  paid_at           timestamptz not null,
  tax_year          integer not null,
  memo              text,
  created_at        timestamptz not null default now()
);

create index if not exists sub_payments_year_idx
  on subcontractor_payments (subcontractor_id, tax_year);
create index if not exists sub_payments_org_year_idx
  on subcontractor_payments (org_id, tax_year);
