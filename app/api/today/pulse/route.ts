import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api-auth";
import { queryOne } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * A cheap fingerprint of everything the Today page surfaces. The page polls
 * this every minute; when the fingerprint changes (an agent finished, a sub
 * replied, a sweep flagged something), the client offers a one-click refresh
 * instead of letting the operator act on a stale list.
 */
export async function GET() {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;

  const row = await queryOne<Record<string, unknown>>(
    `select
       (select count(*) from opportunities
         where status='open' and human_action_required=true)::int as needs_you,
       (select count(*) from opportunities where status='open')::int as open_count,
       (select coalesce(max(extract(epoch from updated_at))::bigint, 0)
          from opportunities) as opp_stamp,
       (select count(*) from call_cards
         where status='pending'
           and (snoozed_until is null or snoozed_until <= now()))::int as calls,
       (select count(*) from compliance_items
         where coalesce(status_override, status) in ('warning','critical','blocked'))::int as compliance,
       (select count(*) from scoring_weights
         where approved_at is null and proposed_by='learning-loop')::int as weights,
       (select count(*) from backlink_outreach where approval_status='pending')::int as backlinks`
  );
  return NextResponse.json({ fingerprint: JSON.stringify(row ?? {}) });
}
