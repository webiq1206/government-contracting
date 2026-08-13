/**
 * The tenant boundary for API route handlers.
 *
 * Before this existed, most routes did `requireUser()` and then looked records
 * up by bare id: `select ... from opportunities where id = $1`. Authentication
 * without scoping. Any signed-in user from any organization could read or act
 * on any other organization's records if they knew (or enumerated) a UUID.
 * With self-serve signup, "any signed-in user" means anyone with an email
 * address, so this was the single largest pre-launch risk in the platform.
 *
 * Usage in a route:
 *
 *   const ctx = await requireOrgContext();
 *   if (ctx instanceof NextResponse) return ctx;
 *   const opp = await findOrgRecord("opportunities", params.id, ctx.orgId);
 *   if (!opp) return notFoundResponse();
 *
 * Three rules, all deliberate:
 *
 *   - A record in another org returns the same 404 as a record that does not
 *     exist. A 403 would confirm to a prober that the UUID is real.
 *   - The subscription gate lives here too, so API access follows billing the
 *     same way the dashboard shell does. Before this, an expired customer
 *     lost the UI but kept the API.
 *   - Table names come from a whitelist, never from input, so the dynamic SQL
 *     here cannot become an injection point.
 */
import { NextResponse } from "next/server";
import { queryOne } from "./db";
import { requireUser } from "./api-auth";
import {
  accessLevel,
  accessBlockedReason,
  entitlementOf,
  type AccessLevel,
} from "./billing/entitlements";
import { resolveTenantOrgId } from "./tenant";
import type { SessionUser } from "./auth";

export interface OrgContext {
  user: SessionUser;
  orgId: string;
  /** "full" or "trial". Never "none": that is refused before this is built. */
  access: AccessLevel;
}

/**
 * Signed in, subscribed, and resolved to exactly one organization.
 *
 * `requireBilling: false` is for the routes an expired customer must still
 * reach to become a customer again (billing itself, integrations reconnect).
 * Everything else should leave it on.
 */
export async function requireOrgContext(
  opts: { requireBilling?: boolean } = {}
): Promise<OrgContext | NextResponse> {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;

  // Date-aware, exemption-aware and suspension-aware: one answer, from
  // entitlements.ts, for every gate in the application.
  const level = accessLevel(entitlementOf(auth));
  const requireBilling = opts.requireBilling !== false;
  if (requireBilling && level === "none") {
    return NextResponse.json(
      {
        error: accessBlockedReason(entitlementOf(auth)),
        upgradeUrl: "/settings/billing",
      },
      { status: 402 }
    );
  }

  let orgId: string;
  try {
    // Legacy fallback stays on: the founding single-tenant install predates
    // organization_members rows, and locking it out of its own API the day
    // multi-tenancy shipped would be a self-inflicted outage.
    orgId = await resolveTenantOrgId({ allowLegacyFallback: true });
  } catch {
    return NextResponse.json({ error: "No organization on this account." }, { status: 403 });
  }

  return { user: auth, orgId, access: level === "none" ? "trial" : level };
}

/**
 * Tables a route may look up through this guard. A whitelist rather than a
 * convention, because the table name is interpolated into SQL.
 */
const ORG_TABLES = new Set([
  "opportunities",
  "subcontractors",
  "quotes",
  "bids",
  "call_cards",
  "contracts",
  "documents",
  "compliance_items",
  "content_library",
  "custom_kpis",
  "templates",
  "communications",
  "backlink_outreach",
  "subcontractor_documents",
]);

/**
 * Fetch one record if and only if it belongs to the caller's org.
 *
 * Null means "not yours or not there", indistinguishably, which is the point.
 * After migration 042 every row in these tables carries org_id, so there is
 * no null-org escape hatch here on purpose: a row the triggers could not
 * attribute should be invisible rather than shared.
 */
export async function findOrgRecord<T extends Record<string, unknown>>(
  table: string,
  id: string,
  orgId: string,
  columns = "*"
): Promise<T | null> {
  if (!ORG_TABLES.has(table)) {
    throw new Error(`Table "${table}" is not registered for org-scoped lookup.`);
  }
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  return queryOne<T>(
    `select ${columns} from ${table} where id = $1 and org_id = $2`,
    [id, orgId]
  );
}

/** The uniform "not yours or not there" reply. */
export function notFoundResponse(): NextResponse {
  return NextResponse.json({ error: "Not found" }, { status: 404 });
}
