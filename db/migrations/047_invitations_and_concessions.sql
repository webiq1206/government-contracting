-- Inviting somebody on terms of our choosing, and changing the terms of an
-- account that already exists.
--
-- These are one feature wearing two hats. The terms are identical in both
-- cases (a plan, and one of: normal price, a percentage off, a run of free
-- months, or free outright); the only difference is whether the account
-- exists yet. So the concession is modelled once and referenced twice.
--
-- WHAT LIVES WHERE, AND WHY
--
-- Stripe owns discounts. It knows what a coupon is worth, when it stops, and
-- how it interacts with an invoice; we would be reimplementing all of that
-- badly. The `discount_*` columns on organizations are already written by the
-- webhook from whatever Stripe reports, and that stays true: they are a
-- mirror, and nothing here writes them.
--
-- What Stripe cannot hold for us is a discount promised to somebody who has
-- not checked out yet. There is no subscription to attach it to, and the
-- promotion code exists but nothing connects it to the account. That gap is
-- what the `pending_*` columns below are for: our note to ourselves that this
-- account has a deal waiting, to be handed to Stripe at checkout and then
-- forgotten once Stripe reports it back through the usual mirror.
--
-- A free account is deliberately NOT a discount. billing_exempt is our own
-- flag, works when Stripe is unreachable, and cannot be overwritten by a
-- webhook. A 100% coupon would be none of those things.

-- ---------------------------------------------------------------------------
-- Invitations
-- ---------------------------------------------------------------------------

create table if not exists account_invitations (
  id                  uuid primary key default gen_random_uuid(),
  email               text not null,
  -- Who sent it. The email is kept alongside the id because the record should
  -- still say who did this after that admin's account is gone, which is
  -- exactly when the question gets asked.
  invited_by_email    text not null,
  invited_by_user_id  uuid references users(id) on delete set null,

  -- The terms.
  plan_key            text not null,
  billing_interval    text not null,
  concession_kind     text not null,
  concession_percent  int,
  concession_months   int,
  -- The short code read aloud on the phone, and the two Stripe objects behind
  -- it. Null for an invitation on normal terms and for a free account, neither
  -- of which involves Stripe at all.
  concession_code     text,
  stripe_coupon_id    text,
  stripe_promo_code_id text,

  -- Same rule as password reset: only ever the hash. A leaked backup of this
  -- table must not be a set of working invitation links.
  token_hash          text not null,
  expires_at          timestamptz not null,

  note                text,
  accepted_at         timestamptz,
  accepted_user_id    uuid references users(id) on delete set null,
  accepted_org_id     uuid,
  revoked_at          timestamptz,
  revoked_by          text,
  -- Bumped on every re-send, so an old link stops working the moment a new one
  -- is issued rather than both being live at once.
  sent_count          int not null default 1,
  last_sent_at        timestamptz not null default now(),
  created_at          timestamptz not null default now(),

  constraint account_invitations_kind_ck check (
    concession_kind in ('none', 'percent', 'free_months', 'free_account')
  ),
  -- The shape of the concession has to match its kind, or a percentage
  -- invitation with a null percentage becomes a coupon for nothing at
  -- redemption time, long after anyone could connect it to the mistake.
  constraint account_invitations_shape_ck check (
    case concession_kind
      -- A percentage may run forever (no month count) or for a fixed run.
      when 'percent'     then concession_percent between 1 and 100
                              and (concession_months is null or concession_months between 1 and 36)
      when 'free_months' then concession_months between 1 and 36 and concession_percent is null
      else concession_percent is null and concession_months is null
    end
  )
);

create unique index if not exists account_invitations_token_uidx
  on account_invitations (token_hash);

-- One live invitation per address. Without this, re-sending twice in quick
-- succession or two admins inviting the same person leaves several working
-- links to accounts that would then collide on the email uniqueness rule at
-- redemption, with the second person getting a database error for somebody
-- else's mistake. Spent invitations are excluded so the same address can be
-- invited again later.
create unique index if not exists account_invitations_pending_email_uidx
  on account_invitations (lower(email))
  where accepted_at is null and revoked_at is null;

create index if not exists account_invitations_created_idx
  on account_invitations (created_at desc);

comment on column account_invitations.accepted_at is
  'Claimed atomically at redemption. Set before the account is created so two simultaneous requests cannot both use the link; cleared again if account creation then fails.';

-- ---------------------------------------------------------------------------
-- A concession promised to an account that has not paid yet
-- ---------------------------------------------------------------------------
--
-- Kept apart from the discount_* mirror on purpose. Those columns say what
-- Stripe is doing; these say what we promised. The moment Stripe starts doing
-- it, the promise is redundant and is cleared.

alter table organizations
  add column if not exists pending_promo_code        text,
  add column if not exists pending_promo_code_id     text,
  add column if not exists pending_concession_label  text,
  add column if not exists pending_concession_reason text,
  add column if not exists pending_concession_by     text,
  add column if not exists pending_concession_at     timestamptz;

comment on column organizations.pending_promo_code_id is
  'Stripe promotion code to apply at checkout for an account with no subscription yet. Deliberately outside the webhook writable set: it is our promise, not Stripe state. Cleared once Stripe reports the discount through discount_*.';
comment on column organizations.pending_concession_label is
  'The promise in plain language, shown to the customer on their billing page before they ever see a Stripe invoice.';
