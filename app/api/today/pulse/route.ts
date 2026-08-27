import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api-auth";
import { queryOne } from "@/lib/db";
import { WORKABLE_CALL_CARD_SQL } from "@/lib/data";
import { tryResolveTenantOrgId } from "@/lib/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * A cheap fingerprint of everything the Today page surfaces. The page polls
 * this every minute; when the fingerprint changes (an agent finished, a sub
 * replied, a sweep flagged something), the client offers a one-click refresh
 * instead of letting the operator act on a stale list.
 *
 * Scoped to the caller's organization, like the page it fingerprints. Unscoped
 * it counted every tenant's records, which broke it twice over: it leaked the
 * shape of other customers' pipelines, and it changed whenever anyone else's
 * account moved, so one busy tenant kept every other tenant's Today page
 * offering a refresh for work that was not theirs.
 */
export async function GET() {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;

  const orgId = await tryResolveTenantOrgId();
  if (!orgId) return NextResponse.json({ fingerprint: "{}" });

  const row = await queryOne<Record<string, unknown>>(
    `select
       (select count(*) from opportunities
         where org_id = $1 and status='open' and human_action_required=true)::int as needs_you,
       (select count(*) from opportunities
         where org_id = $1 and status='open')::int as open_count,
       (select coalesce(max(extract(epoch from updated_at))::bigint, 0)
          from opportunities where org_id = $1) as opp_stamp,
       -- Counted exactly as the Call Queue and the sidebar badge count it, so
       -- the page never refreshes for a call it will not then show.
       (select count(*) from call_cards cc
          join opportunities o on o.id = cc.opportunity_id
          join subcontractors s on s.id = cc.subcontractor_id
         where o.org_id = $1 and ${WORKABLE_CALL_CARD_SQL})::int as calls,
       (select count(*) from compliance_items
         where org_id = $1
           and coalesce(status_override, status) in ('conflicting','expired','blocked','needs_review','expiring_soon'))::int as compliance,
       (select count(*) from scoring_weights
         where org_id = $1 and approved_at is null and proposed_by='learning-loop')::int as weights,
       (select count(*) from backlink_outreach
         where org_id = $1 and approval_status='pending')::int as backlinks`,
    [orgId]
  );
  return NextResponse.json({ fingerprint: JSON.stringify(row ?? {}) });
}
