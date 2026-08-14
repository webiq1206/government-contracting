---
name: Negotiated terms (invitations, discounts, free accounts)
description: How a hand-granted price is modelled across Stripe and our own columns, and the orderings that keep money and access consistent.
---

## Free months are a percentage discount, not their own thing

A run of free months is a 100%-off coupon repeating for N months. One code path
makes both.

**Why:** two mechanisms would mean two sets of renewal edge cases and two ways
to double-discount the same customer.

**How to apply:** anything that reads or writes a concession treats
`free_months` as `percent: 100` with a duration. Only the customer-facing
wording distinguishes them, because "100% off for 3 months" makes a reader do
arithmetic.

## A free account is our own flag, never a coupon

`billing_exempt` is a column we own. A never-ending 100% coupon would need
Stripe reachable, need a subscription to attach to, and be overwritable by a
webhook.

**How to apply:** when granting free, cancel at Stripe FIRST, then set the
exemption. The failure between the two steps must be "not charged, briefly
locked out" (one click fixes it), never "free account still being charged"
(nobody notices until they complain).

## A discount promised before there is anything to attach it to

Stripe cannot hold a discount for an account with no subscription. That promise
lives in our own `pending_*` columns, is handed to Stripe at checkout, and is
cleared once the webhook reports the real discount.

**Why:** the `discount_*` columns are a mirror of Stripe. Mixing a promise into
the mirror makes "what are they actually charged" unanswerable.

**How to apply:** pending columns must stay OUT of the webhook's writable
column set, or a Stripe payload can reach them.

## A granted discount is a coupon, never a promotion code

A promotion code is the string a customer types into the box at checkout,
which makes it a bearer token. A coupon can only be attached server-side, by
us, to a subscription or checkout session for an account we have already
identified.

**Why:** a privately negotiated code was shown in the admin UI and ordinary
checkout sessions expose Stripe's code box. Anyone who came by the string
could spend it on their own account, and with a single redemption allowed they
would also consume the discount the intended customer was promised. Nobody
finds out until an invoice. Restricting the promotion code to a customer does
not help for an invitation, because the invitee has no Stripe customer until
they accept.

**How to apply:** keep a short human reference (BROST-XXXX) for matching audit
entries to grants, but it must buy nothing. Never call
`stripe.promotionCodes.create` for a negotiated concession.

## Checkout picks one discount mode

Stripe rejects a session carrying both `discounts: [...]` and
`allow_promotion_codes`. A pending promotion code means passing the discount
and turning the code box off.

## An invited account is bound to the terms it was invited on

While such an account has no subscription, checkout must take plan and interval
from the accepted invitation, not from the query string, and must skip the
public promo-window eligibility check.

**Why:** the query string is otherwise a way to move a privately negotiated
discount onto a plan it was not priced against, and a public window closing
would silently downgrade a private arrangement.

**How to apply:** the binding lapses once a subscription exists, so ordinary
plan changes still work.

## Redemption creates an account, so it needs a claim

Unlike a password reset (idempotent write to an existing row), redeeming an
invitation is not repeatable. Claim the invitation with a conditional update
(`where accepted_at is null ... returning`) BEFORE creating anything, and
release the claim if creation then fails.

Validate cheap input (password length) before the claim, or a typo costs
somebody their only link. After the account exists the claim can no longer be
released: the address is taken and a retry would fail on uniqueness.

Every other state transition on the invitation (revoke, resend) must carry the
same `accepted_at is null` predicate. Reading the row and then updating
unconditionally lets an admin revoke an invitation that was accepted a moment
earlier, and switch off a promotion code belonging to a real customer.

## Terms and the record that they were applied go in one transaction

Applying the concession to the new organization and stamping the invitation as
applied must be atomic.

**Why:** the stamp is what the checkout binding reads. Terms without a stamp
means an organization holding a private promotion code that the binding cannot
see, so the code gets applied to whatever plan the query string asked for,
which is the exact mismatch the binding exists to prevent.
