-- Influencer affiliate program: influencers, codes, attribution, and the
-- commission ledger.
--
-- The design choice everything else follows from: attribution and commission
-- terms are captured ONCE, at the moment a customer subscribes, and are never
-- recomputed. An influencer's default rate can change next week, a code can
-- expire, a plan price can rise, and none of that may alter what was already
-- promised on an existing referral. Anything derived at read time would
-- silently rewrite history.

create table if not exists influencers (
  id                    uuid primary key default gen_random_uuid(),
  name                  text not null,
  email                 text not null,
  -- Stripe Connect Express account. Stripe handles identity verification, tax
  -- forms (W-9 / W-8), and 1099 filing, so none of that lives here.
  stripe_account_id     text unique,
  -- Mirrors of Connect state, refreshed from account.updated webhooks. Kept
  -- locally so the admin view and the payout run can check eligibility without
  -- an API call per influencer.
  connect_details_submitted boolean not null default false,
  connect_payouts_enabled   boolean not null default false,
  -- Stripe's word on whether tax info is collected and acceptable.
  tax_status            text,
  -- Default commission, overridable per code. Percent of GROSS subscription
  -- revenue: the full invoice amount before Stripe fees and before any
  -- customer discount.
  commission_percent    numeric(5,2) not null default 20.00,
  -- Months an influencer earns on a referral. Null means for the life of the
  -- subscription.
  commission_months     integer,
  -- Minimum net owed before a payout is attempted, in cents. Below this the
  -- balance rolls to next month rather than generating a trivial transfer.
  payout_threshold_cents integer not null default 5000,
  -- active | paused | terminated. Paused stops new attribution but keeps
  -- paying existing referrals; terminated stops both.
  status                text not null default 'active',
  notes                 text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create unique index if not exists influencers_email_uniq on influencers (lower(email));
create index if not exists influencers_status_idx on influencers (status);

create table if not exists influencer_codes (
  id                    uuid primary key default gen_random_uuid(),
  influencer_id         uuid not null references influencers(id) on delete cascade,
  -- What the customer types, and what appears in the referral link.
  code                  text not null,
  -- Stripe owns discount validity. We mirror the ids so a redemption on a
  -- Stripe-hosted checkout can be traced back to an influencer.
  stripe_coupon_id      text,
  stripe_promotion_code_id text,
  discount_percent      numeric(5,2) not null,
  -- month | year | both. Which billing intervals the discount is offered on.
  applies_to            text not null default 'both',
  -- How long the CUSTOMER keeps the discount, in months. Null means forever.
  discount_months       integer,
  -- Per-code overrides of the influencer defaults; null falls back to those.
  commission_percent    numeric(5,2),
  commission_months     integer,
  starts_at             timestamptz,
  ends_at               timestamptz,
  max_redemptions       integer,
  redemption_count      integer not null default 0,
  active                boolean not null default true,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create unique index if not exists influencer_codes_code_uniq on influencer_codes (upper(code));
create index if not exists influencer_codes_influencer_idx on influencer_codes (influencer_id);
create index if not exists influencer_codes_promo_idx on influencer_codes (stripe_promotion_code_id);

-- Which influencer a customer belongs to. Permanent.
create table if not exists referral_attributions (
  id                    uuid primary key default gen_random_uuid(),
  -- One influencer per organization, forever. The unique constraint is the
  -- point: a customer cannot be re-attributed by using a second code later,
  -- which is the most common way affiliate programs get gamed.
  org_id                uuid not null unique references organizations(id) on delete cascade,
  influencer_id         uuid not null references influencers(id),
  code_id               uuid not null references influencer_codes(id),
  stripe_customer_id    text,
  stripe_subscription_id text,
  attributed_at         timestamptz not null default now(),
  /**
   * Terms frozen at attribution. Copied rather than joined so that changing an
   * influencer's rate, or expiring a code, never alters commission already
   * promised on an existing referral.
   */
  commission_percent    numeric(5,2) not null,
  commission_months     integer,
  -- Computed at attribution from commission_months; null means no end.
  commission_ends_at    timestamptz,
  created_at            timestamptz not null default now()
);

create index if not exists referral_attributions_influencer_idx
  on referral_attributions (influencer_id);
create index if not exists referral_attributions_customer_idx
  on referral_attributions (stripe_customer_id);

-- Append-only commission ledger. A clawback is a negative row, never an edit
-- or a delete, so the payout statement can always explain itself.
create table if not exists commission_events (
  id                    uuid primary key default gen_random_uuid(),
  influencer_id         uuid not null references influencers(id),
  attribution_id        uuid not null references referral_attributions(id) on delete cascade,
  org_id                uuid references organizations(id) on delete set null,
  -- earned | clawback | adjustment
  kind                  text not null,
  stripe_invoice_id     text,
  stripe_charge_id      text,
  stripe_refund_id      text,
  -- Gross subscription revenue this was computed from, before Stripe fees and
  -- before any customer discount.
  gross_amount_cents    integer not null,
  commission_percent    numeric(5,2) not null,
  -- Negative for a clawback.
  amount_cents          integer not null,
  occurred_at           timestamptz not null default now(),
  -- Set when rolled into a payout; null means still pending.
  payout_id             uuid,
  -- Plain-English line for the influencer's statement.
  description           text not null,
  created_at            timestamptz not null default now()
);

create index if not exists commission_events_influencer_idx
  on commission_events (influencer_id, occurred_at desc);
create index if not exists commission_events_pending_idx
  on commission_events (influencer_id) where payout_id is null;

-- One earned row per invoice, and one clawback per refund. Webhooks retry, so
-- without these a redelivery would pay an influencer twice for one payment.
create unique index if not exists commission_events_invoice_uniq
  on commission_events (stripe_invoice_id, kind)
  where stripe_invoice_id is not null;
create unique index if not exists commission_events_refund_uniq
  on commission_events (stripe_refund_id)
  where stripe_refund_id is not null;

create table if not exists influencer_payouts (
  id                    uuid primary key default gen_random_uuid(),
  influencer_id         uuid not null references influencers(id),
  period_start          timestamptz not null,
  period_end            timestamptz not null,
  earned_cents          integer not null default 0,
  -- Stored positive; subtracted to reach net, so the statement can show it as
  -- its own line rather than a mystery shortfall.
  clawback_cents        integer not null default 0,
  net_cents             integer not null default 0,
  -- pending | approved | paid | failed | skipped_threshold
  status                text not null default 'pending',
  stripe_transfer_id    text unique,
  approved_by           uuid references users(id),
  approved_at           timestamptz,
  paid_at               timestamptz,
  failure_reason        text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index if not exists influencer_payouts_influencer_idx
  on influencer_payouts (influencer_id, period_end desc);
create index if not exists influencer_payouts_status_idx on influencer_payouts (status);

-- One payout per influencer per period, so a re-run of the monthly job cannot
-- create a second transfer for money already sent.
create unique index if not exists influencer_payouts_period_uniq
  on influencer_payouts (influencer_id, period_start, period_end);

alter table commission_events
  add constraint commission_events_payout_fk
  foreign key (payout_id) references influencer_payouts(id) on delete set null;
