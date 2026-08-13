/**
 * Cross-tenant billing read for platform administrators.
 *
 * Everything here deliberately reads from our own tables rather than calling
 * Stripe per row: this is a list view, and one Stripe call per organization
 * would make it slow and rate-limited. The webhook keeps these columns
 * current, so anything stale here is a webhook problem worth seeing.
 */
import { query } from "../db";

export interface AdminBillingRow {
  org_id: string;
  org_name: string;
  owner_email: string | null;
  plan_key: string;
  billing_interval: string | null;
  subscription_status: string;
  amount_cents: number | null;
  price_locked: boolean;
  cancel_at_period_end: boolean;
  trial_ends_at: string | null;
  current_period_end: string | null;
  discount_code: string | null;
  discount_percent_off: string | null;
  discount_amount_off_cents: number | null;
  discount_ends_at: string | null;
  last_payment_status: string | null;
  last_payment_at: string | null;
  last_payment_error: string | null;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  created_at: string;
}

export interface AdminBillingSummary {
  total: number;
  trialing: number;
  active: number;
  pastDue: number;
  canceled: number;
  /** Monthly recurring revenue in cents, annual plans normalised to a month. */
  mrrCents: number;
}

export async function adminBillingRows(): Promise<AdminBillingRow[]> {
  return query<AdminBillingRow>(
    `select o.id as org_id,
            o.name as org_name,
            (select u.email
               from organization_members m
               join users u on u.id = m.user_id
              where m.org_id = o.id
              order by case when m.role = 'owner' then 0 else 1 end, m.created_at asc
              limit 1) as owner_email,
            o.plan_key,
            o.billing_interval,
            o.subscription_status,
            coalesce(o.stripe_amount_cents, o.plan_amount_cents) as amount_cents,
            o.price_locked,
            o.cancel_at_period_end,
            o.trial_ends_at,
            o.current_period_end,
            o.discount_code,
            o.discount_percent_off::text as discount_percent_off,
            o.discount_amount_off_cents,
            o.discount_ends_at,
            o.last_payment_status,
            o.last_payment_at,
            o.last_payment_error,
            o.stripe_customer_id,
            o.stripe_subscription_id,
            o.created_at
       from organizations o
      order by
        -- Problems first: a past-due account is the reason to open this page.
        case o.subscription_status
          when 'past_due' then 0 when 'unpaid' then 0 when 'incomplete' then 1
          when 'trialing' then 2 when 'active' then 3 else 4 end,
        o.created_at desc`
  ).catch(() => []);
}

export function summarise(rows: AdminBillingRow[]): AdminBillingSummary {
  let mrrCents = 0;
  let trialing = 0;
  let active = 0;
  let pastDue = 0;
  let canceled = 0;

  for (const r of rows) {
    switch (r.subscription_status) {
      case "trialing":
        trialing++;
        break;
      case "active":
        active++;
        break;
      case "past_due":
      case "unpaid":
        pastDue++;
        break;
      case "canceled":
        canceled++;
        break;
    }
    // Only revenue actually being collected counts. A trial is not revenue,
    // and counting it would overstate MRR by the entire trial cohort.
    if (r.subscription_status === "active" && r.amount_cents) {
      mrrCents +=
        r.billing_interval === "year" ? Math.round(r.amount_cents / 12) : r.amount_cents;
    }
  }

  return { total: rows.length, trialing, active, pastDue, canceled, mrrCents };
}
