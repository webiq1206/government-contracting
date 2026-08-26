-- When Stripe will try the card again, and where to go and pay it.
--
-- The webhook already receives both. `invoice.payment_failed` carries
-- `next_payment_attempt` and `hosted_invoice_url`, and the handler put them
-- into an email and then dropped them on the floor. So a customer got a
-- message saying their payment had failed, opened the Billing page it pointed
-- at, and found the word "Past due" with no reason, no date, and nothing to
-- press. The one page that exists to answer "what now" could not.
--
-- Both are nullable and stay null until a payment actually fails. Stripe does
-- not always supply a next attempt (a final attempt, or a subscription set to
-- cancel on failure), and a null has to keep meaning "we do not know when"
-- rather than being filled in with a guess: telling somebody their card will
-- be retried on a date nobody promised is worse than saying nothing.
alter table organizations
  add column if not exists next_payment_attempt_at timestamptz,
  -- Stripe's own hosted invoice page. It is the only place a customer can pay
  -- a failed invoice directly, and it is per-invoice rather than per-customer,
  -- so it cannot be reconstructed from the customer id later.
  add column if not exists last_invoice_url text;
