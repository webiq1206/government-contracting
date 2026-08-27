-- What was charged, on what card, and what happened to it.
--
-- The Billing page could state a plan, a price and a renewal date, and could
-- not answer either of the two questions people actually open it with: what
-- have I been charged, and which card is this coming off. The only invoice
-- the platform held was last_invoice_url, written when a payment failed and
-- deliberately cleared when one succeeded, so a customer asking for a receipt
-- had to be sent to Stripe's portal to find one, and an account with no
-- portal session had nowhere to look at all.
--
-- Both are recorded from webhooks the platform already receives, so the page
-- renders from its own records rather than making a Stripe call on every
-- view. An account Stripe has never told us about shows nothing, which is
-- correct: it is not zero invoices, it is no record.

create table if not exists billing_invoices (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references organizations(id) on delete cascade,
  -- Stripe's id, unique, because the same invoice arrives on more than one
  -- event type and Stripe delivers each of them at least once. Every write is
  -- an upsert on this column.
  stripe_invoice_id  text not null unique,
  -- The customer-facing number (INV-0001), which is what somebody quotes when
  -- they email about a charge. Null on an invoice Stripe never finalised.
  number             text,
  status             text not null,
  amount_due_cents   integer,
  amount_paid_cents  integer,
  currency           text,
  period_start       timestamptz,
  period_end         timestamptz,
  hosted_invoice_url text,
  invoice_pdf_url    text,
  issued_at          timestamptz,
  paid_at            timestamptz,
  -- Why a charge was refused, in Stripe's words. Kept per invoice as well as
  -- on the organization, because the organization holds only the latest and
  -- the question is often about a specific month.
  failure_reason     text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists billing_invoices_org_idx
  on billing_invoices (org_id, issued_at desc nulls last);

/*
 * The card, as Stripe last described it.
 *
 * Four separate columns rather than one string, because "expires 04/2026" has
 * to be comparable against today to warn anybody before a renewal fails on a
 * card that lapsed, and a formatted label cannot be compared to anything.
 */
alter table organizations
  add column if not exists card_brand text,
  add column if not exists card_last4 text,
  add column if not exists card_exp_month integer,
  add column if not exists card_exp_year integer,
  add column if not exists card_recorded_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'organizations_card_last4_ck') then
    alter table organizations add constraint organizations_card_last4_ck
      check (card_last4 is null or card_last4 ~ '^[0-9]{4}$');
  end if;
end $$;
