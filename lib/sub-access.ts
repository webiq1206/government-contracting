/**
 * Load a subcontractor for an operator request, scoped to their organization.
 *
 * Mirrors what subDetail() in lib/data.ts does: when a tenant resolves, the
 * lookup is scoped to it, and when one does not (single-tenant installs and
 * legacy rows) it falls back to an unscoped read. Kept in one place because
 * the compliance routes write sensitive records, and "which org is this sub
 * in" is not a question worth answering slightly differently in each of them.
 */
import { queryOne } from "./db";
import type { PortalSubject } from "./sub-compliance-store";

export async function loadSubForOperator(subId: string): Promise<PortalSubject | null> {
  let orgId: string | null = null;
  try {
    const { tryResolveTenantOrgId } = await import("./tenant");
    orgId = await tryResolveTenantOrgId();
  } catch {
    orgId = null;
  }

  return orgId
    ? queryOne<PortalSubject>(
        `select id, company_name, owner_name, email, org_id
           from subcontractors where id = $1 and org_id = $2`,
        [subId, orgId]
      ).catch(() => null)
    : queryOne<PortalSubject>(
        `select id, company_name, owner_name, email, org_id
           from subcontractors where id = $1`,
        [subId]
      ).catch(() => null);
}
