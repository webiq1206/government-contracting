import { NextResponse } from "next/server";
import { requireSubscriber, requireCapability } from "@/lib/api-auth";
import { resolveTenantOrgId } from "@/lib/tenant";
import { query, queryOne } from "@/lib/db";
import { applyOutcomeToSolicitation, type ReplyOutcome } from "@/lib/domain/reply-outcome";
import { logAgent } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED: ReplyOutcome[] = [
  "quoted",
  "interested",
  "declined",
  "unavailable",
  "not_a_fit",
  "needs_info",
  "none",
];

/**
 * Resolve a flagged reply.
 *
 * The person read the message the platform was unsure about and is telling it
 * what the subcontractor actually meant. Their decision is applied to that one
 * solicitation, exactly as an automatic decision would have been, and the row
 * leaves the queue.
 */
export async function POST(
  req: Request,
  { params }: { params: { id: string } }
) {
  const auth = await requireCapability("outreach");
  if (auth instanceof NextResponse) return auth;
  const orgId = await resolveTenantOrgId();

  const body = (await req.json().catch(() => ({}))) as { outcome?: string };
  const outcome = body.outcome as ReplyOutcome | undefined;
  if (!outcome || !ALLOWED.includes(outcome)) {
    return NextResponse.json({ error: "Pick what they meant." }, { status: 400 });
  }

  // Scoped read: a reply belonging to another tenant must be invisible here,
  // not merely un-updatable.
  const row = await queryOne<{
    id: string;
    subcontractor_id: string;
    opportunity_id: string | null;
    trade: string | null;
  }>(
    `select e.id, e.subcontractor_id, e.opportunity_id, e.trade
       from subcontractor_reply_events e
       left join opportunities o on o.id = e.opportunity_id
      where e.id = $1
        and (e.org_id = $2 or (e.org_id is null and o.org_id = $2))`,
    [params.id, orgId]
  );
  if (!row) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  if (row.opportunity_id && outcome !== "none") {
    await applyOutcomeToSolicitation({
      opportunityId: row.opportunity_id,
      subcontractorId: row.subcontractor_id,
      trade: row.trade,
      outcome,
    });
  }

  await query(
    `update subcontractor_reply_events
        set reviewed_at = now(), needs_review = false, intent = $2
      where id = $1`,
    [row.id, outcome]
  );

  await logAgent({
    agent: "reply-poll",
    action: "reply-reviewed",
    opportunityId: row.opportunity_id ?? undefined,
    subcontractorId: row.subcontractor_id,
    level: "info",
    message: `You reviewed a flagged reply and recorded it as "${outcome.replace(/_/g, " ")}" for this solicitation.`,
  });

  return NextResponse.json({ ok: true });
}
