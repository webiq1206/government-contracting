-- Negotiated discounts stop using Stripe promotion codes.
--
-- A promotion code is a thing a person types into a box. That is exactly wrong
-- for a discount negotiated with one named customer: the code was displayed in
-- the admin UI to be read aloud, and ordinary checkout sessions show Stripe's
-- code box, so anybody who came by the code could spend it on their own
-- account. Because each code allowed a single redemption, a stranger doing so
-- would also consume the discount the invited customer was promised, and the
-- first anyone would know is the invoice.
--
-- Coupons are not redeemable by customers. They can only be attached
-- server-side, by us, to a subscription or a checkout session we are already
-- building for a known account. Same discount, no code to leak, so the
-- promotion code layer goes away.
--
-- The short BROST-XXXX string stays, but only as our own reference for reading
-- back an audit entry. It buys nobody anything.

alter table account_invitations
  drop column if exists stripe_promo_code_id;

comment on column account_invitations.concession_code is
  'Our own short reference for this grant, e.g. BROST-K4M9. Not redeemable: it is a label for humans reading audit entries, not a Stripe promotion code.';
comment on column account_invitations.stripe_coupon_id is
  'The Stripe coupon behind the discount. Attached server-side at checkout; never handed to the customer.';

do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_name = 'organizations' and column_name = 'pending_promo_code'
  ) then
    alter table organizations rename column pending_promo_code to pending_concession_code;
  end if;
  if exists (
    select 1 from information_schema.columns
     where table_name = 'organizations' and column_name = 'pending_promo_code_id'
  ) then
    alter table organizations rename column pending_promo_code_id to pending_coupon_id;
  end if;
end $$;

comment on column organizations.pending_coupon_id is
  'Stripe coupon to attach at checkout for an account with no subscription yet. Deliberately outside the webhook writable set: it is our promise, not Stripe state. Cleared once Stripe reports the discount through discount_*.';
comment on column organizations.pending_concession_code is
  'Our own short reference for the promised discount. Not redeemable by anyone.';
