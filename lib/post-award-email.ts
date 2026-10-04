import { queryOne } from "./db";
import { expectedPursuitVersion } from "./pursuit-job-context";

/** Only paperwork for a verified contact explicitly named on an active award. */
export async function postAwardComplianceAllowed(input: {
  contractId: string; orgId?: string; opportunityId?: string;
  subcontractorId?: string; to: string;
}): Promise<boolean> {
  if (!input.orgId || !input.opportunityId || !input.subcontractorId) return false;
  try {
    const row = await queryOne<{ pursuit_version: number }>(
      `select o.pursuit_version from contracts c
       join opportunities o on o.id=c.opportunity_id
       join subcontractors s on s.id in (c.primary_sub_id,c.backup_sub_id)
       where c.id=$1 and c.status='active' and o.id=$2 and o.org_id=$3
         and s.id=$4 and s.org_id=$3 and s.email_verified=true
         and lower(trim(s.email))=lower(trim($5::text))
         and o.stage='won' and o.status='open' and o.pursuit_state='active'`,
      [input.contractId,input.opportunityId,input.orgId,input.subcontractorId,input.to]);
    const version = Number(row?.pursuit_version);
    const expected = expectedPursuitVersion(input.opportunityId);
    return !!row && Number.isInteger(version) && version >= 1 &&
      (expected == null || expected === version);
  } catch {
    return false;
  }
}
