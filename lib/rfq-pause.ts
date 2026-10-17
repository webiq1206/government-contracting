/**
 * Stop quote requests that have not left yet.
 *
 * Called when an account turns outbound quote requests off. Mail that was
 * already accepted stays where it is. A request still waiting is flagged
 * for a person and is not sent on the next job.
 */
import { query } from "./db";

export async function pauseOutboundRfqs(orgId: string): Promise<{ opportunities: number }> {
  const rows = await query<{ id: string }>(
    `update opportunities o
        set human_action_required = true,
            updated_at = now()
      where o.org_id = $1
        and o.status = 'open'
        and exists (
          select 1 from opportunity_subs os
           where os.opportunity_id = o.id
             and os.removed_at is null
             and os.outreach_state in ('pending', 'draft', 'no_email', 'email_unverified', 'send_failed')
        )
      returning o.id`,
    [orgId]
  );
  return { opportunities: rows.length };
}
