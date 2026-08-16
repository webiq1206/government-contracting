/**
 * Organization (tenant) helpers: membership, subscription gates, creation.
 */
import type { PoolClient } from "pg";
import { query, queryOne } from "./db";
import { LEGACY_ORG_ID } from "./tenant-context";
import type { PlanKey } from "./billing/prices";
import { TRIAL_STATUS, trialEndsAt } from "./billing/entitlements";
import { defaultCompanyProfile } from "./domain/default-profile";
import { renderProfileText } from "./ai/companyProfile";

export interface Organization {
  id: string;
  name: string;
  slug: string | null;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  stripe_price_id: string | null;
  plan_key: PlanKey;
  plan_amount_cents: number | null;
  subscription_status: string;
  price_locked: boolean;
  cancel_at_period_end: boolean;
  current_period_end: string | null;
  trial_ends_at: string | null;
  billing_interval: string | null;
  /** What Stripe actually charges, which may be below list. */
  stripe_amount_cents: number | null;
  discount_code: string | null;
  discount_percent_off: number | null;
  discount_amount_off_cents: number | null;
  discount_ends_at: string | null;
  last_payment_status: string | null;
  last_payment_at: string | null;
  last_payment_error: string | null;
  /** Comped: full access whatever the subscription says. */
  billing_exempt: boolean;
  billing_exempt_reason: string | null;
  billing_exempt_granted_by: string | null;
  billing_exempt_granted_at: string | null;
  /**
   * A discount granted to an account that has nothing to attach it to yet.
   *
   * Deliberately separate from the `discount_*` columns above: those mirror
   * what Stripe is doing, these record what we promised. Handed to Stripe at
   * checkout and cleared once it starts reporting the discount for real.
   */
  pending_concession_code: string | null;
  pending_coupon_id: string | null;
  pending_concession_label: string | null;
  pending_concession_reason: string | null;
  pending_concession_by: string | null;
  pending_concession_at: string | null;
  /** Administrative suspension. Outranks billing_exempt. */
  suspended_at: string | null;
  suspended_reason: string | null;
  suspended_by: string | null;
  created_at: string;
}

/**
 * `subscriptionAllowsAccess(status)` used to live here, taking a bare status
 * string. It has been removed rather than extended.
 *
 * Two access helpers meant every gate silently chose one, and they disagreed:
 * the status-only one could not see a trial's end date, and once comping
 * existed it could not have seen the exemption either. That is how the
 * platform owner ended up locked out of his own product on some screens and
 * not others. There is now exactly one answer, `accessLevel()` in
 * billing/entitlements.ts, and `entitlementOf(sessionUser)` to feed it.
 */

export async function getOrganization(orgId: string): Promise<Organization | null> {
  return queryOne<Organization>(`select * from organizations where id = $1`, [orgId]);
}

export async function getOrgForUser(userId: string): Promise<Organization | null> {
  if (userId === "env-operator") {
    return getOrganization(LEGACY_ORG_ID);
  }
  return queryOne<Organization>(
    `select o.*
       from organizations o
       join organization_members m on m.org_id = o.id
      where m.user_id = $1
      order by m.created_at asc
      limit 1`,
    [userId]
  );
}

/**
 * Every organization the background agents should keep working for.
 *
 * This deliberately mirrors accessLevel() rather than filtering on
 * subscription_status alone. A status-only filter is what locked our own
 * comped organization out of scheduled opportunity monitoring while the UI
 * quite happily let us in: access said yes, the worker said no, and the two
 * were only discoverable as "why is nothing being ingested". A cardless trial
 * is judged by its date here for the same reason the gates judge it by date.
 */
export async function listActiveOrganizations(): Promise<Organization[]> {
  return query<Organization>(
    `select * from organizations
      where suspended_at is null
        and (
          billing_exempt
          -- past_due matches accessLevel(): the customer keeps working while
          -- Stripe retries their card; dunning exhausting moves the status to
          -- unpaid/canceled and the org drops out of this list then.
          or subscription_status in ('active','trialing','past_due')
          or (subscription_status = 'trial' and trial_ends_at > now())
        )
      order by created_at asc`
  );
}

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 48) || "workspace"
  );
}

export async function createOrganizationForUser(
  input: {
    userId: string;
    name: string;
    email: string;
  },
  client?: PoolClient
): Promise<Organization> {
  // When a transaction client is supplied every write joins the caller's
  // transaction, so signup is all-or-nothing: a failure in any insert rolls
  // back the lot instead of stranding a user row that blocks the email
  // forever while owning nothing.
  const q = client
    ? <T extends object>(text: string, params?: unknown[]) =>
        client.query(text, params as never[]).then((r) => r.rows as T[])
    : (query as <T extends object>(text: string, params?: unknown[]) => Promise<T[]>);
  const q1 = async <T extends object>(text: string, params?: unknown[]) =>
    (await q<T>(text, params))[0] ?? null;
  const base = slugify(input.name);
  let slug = base;
  for (let i = 0; i < 8; i++) {
    const clash = await q1<{ id: string }>(
      `select id from organizations where slug = $1`,
      [slug]
    );
    if (!clash) break;
    slug = `${base}-${Math.random().toString(36).slice(2, 6)}`;
  }

  const org = await q1<Organization>(
    // Starts on the cardless trial. The trial clock begins at signup rather
    // than at first use, so "7 days" means the same thing to us and to them.
    `insert into organizations (name, slug, plan_key, subscription_status, trial_ends_at)
     values ($1, $2, 'none', $3, $4)
     returning *`,
    [input.name.trim() || "My company", slug, TRIAL_STATUS, trialEndsAt().toISOString()]
  );
  if (!org) throw new Error("Failed to create organization.");

  await q(
    `insert into organization_members (org_id, user_id, role) values ($1, $2, 'owner')`,
    [org.id, input.userId]
  );

  // A COMPLETE active profile, not a shell. The rest of the platform assumes
  // every section exists: the profile page reads decision_thresholds, scoring
  // maps over hard_exclusions and the rubric, quote entry reads pricing_rules.
  // The old eight-field shell crashed the Company Profile page on a new
  // account and would have taken scoring with it.
  const profileJson = defaultCompanyProfile({
    legalName: input.name,
    email: input.email,
  });
  await q(
    `insert into company_profile (org_id, version, is_active, profile_json, profile_text, updated_by)
     values ($1, 1, true, $2::jsonb, $3, $4)`,
    [org.id, JSON.stringify(profileJson), renderProfileText(profileJson), input.userId]
  );

  return org;
}

/**
 * Columns this function is permitted to write.
 *
 * The update is built by interpolating keys into SQL, so the set of writable
 * columns is pinned here rather than trusted from the caller's object. Today
 * every caller passes a typed literal; this makes that safe by construction
 * instead of by convention.
 */
const BILLING_COLUMNS = new Set([
  "stripe_customer_id",
  "stripe_subscription_id",
  "stripe_price_id",
  "plan_key",
  "plan_amount_cents",
  "stripe_amount_cents",
  "billing_interval",
  "subscription_status",
  "price_locked",
  "cancel_at_period_end",
  "current_period_end",
  "trial_ends_at",
  "discount_code",
  "discount_percent_off",
  "discount_amount_off_cents",
  "discount_ends_at",
  "last_payment_status",
  "last_payment_at",
  "last_payment_error",
]);

export async function updateOrganizationBilling(
  orgId: string,
  patch: Partial<{
    stripe_customer_id: string | null;
    stripe_subscription_id: string | null;
    stripe_price_id: string | null;
    plan_key: PlanKey;
    plan_amount_cents: number | null;
    /** What Stripe actually charges, which may be below list. */
    stripe_amount_cents: number | null;
    billing_interval: string | null;
    subscription_status: string;
    price_locked: boolean;
    cancel_at_period_end: boolean;
    current_period_end: string | null;
    trial_ends_at: string | null;
    discount_code: string | null;
    discount_percent_off: number | null;
    discount_amount_off_cents: number | null;
    discount_ends_at: string | null;
    last_payment_status: string | null;
    last_payment_at: string | null;
    last_payment_error: string | null;
  }>
): Promise<void> {
  const fields: string[] = [];
  const vals: unknown[] = [];
  let i = 1;
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    if (!BILLING_COLUMNS.has(k)) continue;
    fields.push(`${k} = $${i++}`);
    vals.push(v);
  }
  if (fields.length === 0) return;
  fields.push(`updated_at = now()`);
  vals.push(orgId);
  await query(
    `update organizations set ${fields.join(", ")} where id = $${i}`,
    vals
  );
}

/**
 * Forget a discount we promised but had nowhere to put.
 *
 * Called once the account has a subscription, because from that point Stripe
 * holds the discount and the `discount_*` mirror describes it. Leaving the
 * promise behind would mean a future checkout silently applying the same
 * coupon a second time.
 *
 * A separate statement rather than part of `updateOrganizationBilling`: these
 * columns are deliberately outside the webhook's writable set, and widening
 * that set to include them would let Stripe payloads reach them.
 */
export async function clearPendingConcession(orgId: string): Promise<void> {
  await query(
    `update organizations
        set pending_concession_code = null,
            pending_coupon_id = null,
            pending_concession_label = null,
            pending_concession_reason = null,
            pending_concession_by = null,
            pending_concession_at = null,
            updated_at = now()
      where id = $1
        and pending_coupon_id is not null`,
    [orgId]
  );
}

/** Assert a row's org_id matches the caller's org (IDOR guard). */
export function assertSameOrg(
  rowOrgId: string | null | undefined,
  callerOrgId: string
): boolean {
  return Boolean(rowOrgId && rowOrgId === callerOrgId);
}
