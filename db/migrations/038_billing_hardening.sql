-- Stripe webhook idempotency, event ordering, and richer billing state.
--
-- Stripe retries a webhook until it gets a 2xx, and delivery order is not
-- guaranteed. Without a record of what has been processed, a retry of
-- checkout.session.completed re-runs the activation, and a late-arriving older
-- subscription.updated can overwrite newer state with stale values.

create table if not exists stripe_events (
  -- Stripe's own event id. Primary key, so a retry conflicts instead of
  -- processing twice.
  id            text primary key,
  type          text not null,
  -- Stripe's created timestamp, used to reject an event older than the state
  -- we already applied for the same subscription.
  created_at    timestamptz not null,
  org_id        uuid references organizations(id) on delete set null,
  processed_at  timestamptz not null default now(),
  -- Kept so a failed handler can be diagnosed without replaying from Stripe.
  error         text
);

create index if not exists stripe_events_org_idx on stripe_events (org_id, created_at desc);
create index if not exists stripe_events_type_idx on stripe_events (type);

alter table organizations
  -- month | year. Needed to show a renewal date and price correctly, and to
  -- keep an annual subscriber from being quoted a monthly figure.
  add column if not exists billing_interval text,
  -- The amount Stripe actually charges, in cents. Distinct from the catalog
  -- amount: a grandfathered or discounted subscriber pays less than list.
  add column if not exists stripe_amount_cents integer,
  -- Discount currently applied, straight from Stripe, so the admin view never
  -- has to infer why someone is paying less than list.
  add column if not exists discount_code text,
  add column if not exists discount_percent_off numeric(5,2),
  add column if not exists discount_amount_off_cents integer,
  add column if not exists discount_ends_at timestamptz,
  -- Payment health, so a past-due account can be chased before it cancels.
  add column if not exists last_payment_status text,
  add column if not exists last_payment_at timestamptz,
  add column if not exists last_payment_error text,
  -- The newest Stripe event applied to this org, so a stale retry is ignored.
  add column if not exists billing_event_at timestamptz;

-- Every organization must map to at most one Stripe customer, and one Stripe
-- customer must never be shared by two organizations. Both directions matter:
-- a shared customer would let one tenant's card pay another tenant's bill.
create unique index if not exists organizations_stripe_customer_uniq
  on organizations (stripe_customer_id)
  where stripe_customer_id is not null;

create unique index if not exists organizations_stripe_subscription_uniq
  on organizations (stripe_subscription_id)
  where stripe_subscription_id is not null;
