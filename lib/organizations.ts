/**
 * Organization (tenant) helpers: membership, subscription gates, creation.
 */
import { query, queryOne } from "./db";
import { LEGACY_ORG_ID } from "./tenant-context";
import type { PlanKey } from "./billing/prices";

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
  created_at: string;
}

const ACTIVE = new Set(["active", "trialing"]);

export function subscriptionAllowsAccess(status: string | null | undefined): boolean {
  return ACTIVE.has(status ?? "");
}

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

export async function listActiveOrganizations(): Promise<Organization[]> {
  return query<Organization>(
    `select * from organizations
      where subscription_status in ('active','trialing')
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

export async function createOrganizationForUser(input: {
  userId: string;
  name: string;
  email: string;
}): Promise<Organization> {
  const base = slugify(input.name);
  let slug = base;
  for (let i = 0; i < 8; i++) {
    const clash = await queryOne<{ id: string }>(
      `select id from organizations where slug = $1`,
      [slug]
    );
    if (!clash) break;
    slug = `${base}-${Math.random().toString(36).slice(2, 6)}`;
  }

  const org = await queryOne<Organization>(
    `insert into organizations (name, slug, plan_key, subscription_status)
     values ($1, $2, 'none', 'none')
     returning *`,
    [input.name.trim() || "My company", slug]
  );
  if (!org) throw new Error("Failed to create organization.");

  await query(
    `insert into organization_members (org_id, user_id, role) values ($1, $2, 'owner')`,
    [org.id, input.userId]
  );

  // Empty active company profile shell so Finish Setting Up can populate it.
  await query(
    `insert into company_profile (org_id, version, is_active, profile_json, profile_text, updated_by)
     values ($1, 1, true, $2::jsonb, '', $3)`,
    [
      org.id,
      JSON.stringify({
        legal_name: input.name.trim(),
        dba_name: "",
        uei: "",
        cage_code: "",
        naics_codes: [],
        service_areas: [],
        certifications: [],
        email: input.email,
      }),
      input.userId,
    ]
  );

  return org;
}

export async function updateOrganizationBilling(
  orgId: string,
  patch: Partial<{
    stripe_customer_id: string | null;
    stripe_subscription_id: string | null;
    stripe_price_id: string | null;
    plan_key: PlanKey;
    plan_amount_cents: number | null;
    subscription_status: string;
    price_locked: boolean;
    cancel_at_period_end: boolean;
    current_period_end: string | null;
  }>
): Promise<void> {
  const fields: string[] = [];
  const vals: unknown[] = [];
  let i = 1;
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
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

/** Assert a row's org_id matches the caller's org (IDOR guard). */
export function assertSameOrg(
  rowOrgId: string | null | undefined,
  callerOrgId: string
): boolean {
  return Boolean(rowOrgId && rowOrgId === callerOrgId);
}
