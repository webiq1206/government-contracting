/**
 * Load a subcontractor for an operator request, scoped to their organization.
 *
 * The caller passes the organization established by requireOrgContext. There
 * is deliberately no legacy unscoped fallback: an unavailable tenant context
 * must stop a sensitive document or credential action, never broaden it.
 */
import { queryOne } from "./db";
import type { PortalSubject } from "./sub-compliance-store";

export async function loadSubForOperator(
  subId: string,
  orgId: string
): Promise<PortalSubject | null> {
  return queryOne<PortalSubject>(
    `select id, company_name, owner_name, email, org_id
       from subcontractors where id = $1 and org_id = $2`,
    [subId, orgId]
  );
}
