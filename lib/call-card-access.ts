import type { PoolClient } from 'pg';
import { OWNED_CALL_CARD_SQL } from './sub-action-eligibility';

/** Lock the card and both owned records before any workspace mutation.
 * Historical null/cross-tenant links are unavailable; this never repairs them.
 */
export async function lockOwnedCallCard(client: Pick<PoolClient,'query'>, id:string, orgId:string) {
  const result=await client.query<{opportunity_id:string;subcontractor_id:string;status:string}>(
    `select cc.opportunity_id, cc.subcontractor_id, cc.status from call_cards cc
       join opportunities o on o.id=cc.opportunity_id
       join subcontractors s on s.id=cc.subcontractor_id
      where cc.id=$1 and cc.org_id=$2 and ${OWNED_CALL_CARD_SQL}
      for update of cc,o,s`,[id,orgId]);
  return result.rows[0] ?? null;
}
