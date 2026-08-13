# Billing runbook

Everything needed to take Brost Co from no billing to taking real money, and to
verify it afterwards. Follow it in order; each step assumes the one before.

The application never hardcodes a price. Plans, amounts, intervals, and trial
length live in `lib/billing/catalog.ts`, and Stripe holds the price objects
those map to. Changing a price means editing the catalog and creating a new
Stripe price, never editing an amount in application code.

---

## What you are setting up

| Plan     | Monthly | Annual (5 months free) | Notes |
|----------|---------|------------------------|-------|
| Standard | $2,997  | $20,979                | List rate |
| Founding | $497    | $3,479                 | Promo window only, rate locked for life of subscription |

Every new subscription gets a **7-day free trial** with a card collected up
front, so Stripe charges automatically when the trial ends unless the customer
cancels first.

---

## Step 1: create the Brost Co Stripe account

Brost Co bills under its own account, not webiq.co. That keeps brostco.com on
customer statements, keeps payouts and revenue separate, and means Customer
Portal settings are not shared with another product.

1. Sign in to Stripe, open the account switcher (top left), and choose
   **New account**.
2. Name it **Brost Co** and set the public business name to what customers
   should see on their card statement.
3. Complete activation: business details, tax ID, and a bank account. Live keys
   do not work until this is finished.

## Step 2: create the products and prices

Run the setup script once per mode. The key you pass decides the mode, so there
is no flag to get wrong.

Test mode first:

```bash
STRIPE_SECRET_KEY=sk_test_... npm run stripe:setup
```

Then live:

```bash
STRIPE_SECRET_KEY=sk_live_... npm run stripe:setup
```

The script is idempotent: it finds prices by lookup key, so re-running never
creates duplicates. It prints the environment lines to paste in step 4.

Do not create these products by hand in the dashboard. The script sets a
`lookup_key` and `plan_key` metadata that the verify step depends on; prices
created through the UI lack them and will be treated as missing.

## Step 3: create the webhook endpoint

Nothing activates without this. The endpoint refuses every event when the
signing secret is absent, so a paid signup would sit unactivated forever.

1. Stripe dashboard, **Developers → Webhooks → Add endpoint**.
2. URL: `https://brostco.com/api/billing/webhook`
3. Subscribe to exactly these events:
   - `checkout.session.completed`
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `customer.subscription.trial_will_end`
   - `invoice.paid`
   - `invoice.payment_failed`
   - `invoice.payment_action_required`
4. Reveal the signing secret (`whsec_...`) and keep it for step 4.
5. Repeat in test mode, pointing at wherever you run test builds. Test and live
   have separate endpoints and separate signing secrets.

## Step 4: set the environment variables

In Replit, **Tools → Secrets**. Production takes the **live** values.

| Name | Value | Secret? |
|---|---|---|
| `STRIPE_SECRET_KEY` | `sk_live_...` | Yes |
| `STRIPE_WEBHOOK_SECRET` | `whsec_...` from step 3 | Yes |
| `STRIPE_PRICE_STANDARD_MONTHLY` | printed by the script | No |
| `STRIPE_PRICE_STANDARD_ANNUAL` | printed by the script | No |
| `STRIPE_PRICE_FOUNDING_MONTHLY` | printed by the script | No |
| `STRIPE_PRICE_FOUNDING_ANNUAL` | printed by the script | No |
| `PLATFORM_ADMIN_EMAILS` | your email, comma-separated for more | No |

`STRIPE_SECRET_KEY` is the **secret** key, not the publishable key. The
publishable key (`pk_...`) is for client-side code and cannot create checkout
sessions or read subscriptions; this application never uses one.

Redeploy after setting them.

## Step 5: configure the Customer Portal

The portal is how customers update cards, read invoices, change plan, and
cancel. `billingPortal.sessions.create` fails until it is configured once.

Stripe dashboard, **Settings → Billing → Customer portal**. Enable:

- Invoice history
- Update payment methods
- Update billing information
- Cancel subscriptions (at end of period, so they keep what they paid for)
- Switch plans, listing the four prices from step 2

## Step 6: verify

```bash
npm run stripe:verify
```

Run it against production. It confirms every configured price ID exists, is
active, is in the right mode, and charges the expected amount. The failure it
exists to catch is a **test-mode price ID in a live environment**, which
otherwise surfaces as a broken checkout for a real customer.

Then open `/admin/billing` in the app. It shows a banner when billing is
misconfigured and a second one when the deployment is on test keys, so a
production instance quietly running test credentials is visible rather than
silent.

---

## End-to-end tests

Run these in **test mode** with Stripe's test cards. They cover every path the
application has.

| Scenario | How | Expect |
|---|---|---|
| Signup and trial | Sign up, pay with `4242 4242 4242 4242` | Org active, status `trialing`, trial-started email, trial end 7 days out |
| Trial converts | Stripe **test clock**, advance past the trial end | Status `active`, payment-received email, renewal date set |
| Discount | Apply a promotion code at checkout | Discount shown on the billing page and in `/admin/billing` |
| Expired discount | Apply an expired or invalid code | Stripe rejects it at checkout; no discount recorded |
| Failed payment | Card `4000 0000 0000 0341` | Status `past_due`, payment-failed email naming the retry date |
| Plan change up | POST `/api/billing/change-plan` with a dearer plan | Difference invoiced immediately |
| Plan change down | Same with a cheaper plan | Credit against the next invoice, no refund |
| Founding after expiry | Set the promo window closed, try `plan=founding` | Falls back to standard at checkout; the change-plan route returns 403 |
| Cancellation | Cancel in the portal | `cancel_at_period_end`, access until period end, cancellation email |
| Reactivation | Resume in the portal before period end | Back to `active`, reactivation email |
| Webhook replay | Resend an event from the dashboard | Second delivery answers `duplicate: true` and changes nothing |

Only after these pass in test should production carry live keys.

---

## Things worth knowing

**A grandfathered rate is protected in two places.** The webhook never
reprices a locked subscriber on a renewal, and the change-plan route refuses a
change that would forfeit the rate rather than applying it silently. Changing a
founding subscriber to standard is deliberate work, not a customer self-serve
action.

**Discount rules live in Stripe, not here.** Promotion codes are enabled at
checkout and Stripe enforces validity, eligibility, and expiry. There is no
discount logic in application code to drift out of date.

**Recorded amounts come from Stripe.** A discounted or grandfathered subscriber
pays less than list, so the application stores what Stripe charged rather than
what the catalog says. The two disagreeing is the point.

**If `/admin/billing` disagrees with Stripe,** webhook delivery is failing.
Check the endpoint's recent deliveries in the dashboard before assuming the
data is wrong.
