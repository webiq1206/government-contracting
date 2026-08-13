import { NextResponse } from "next/server";
import { requireOrgContext } from "@/lib/org-guard";
import { query, queryOne } from "@/lib/db";
import { logAgent } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Operator judgment on an out-of-range quote:
 *   accept  → clear the OOR flag (keep amount)
 *   dismiss → leave flag but snooze from Today via note (optional future)
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const ctx = await requireOrgContext();
  if (ctx instanceof NextResponse) return ctx;
  const { user: auth, orgId } = ctx;

  const body = (await req.json().catch(() => ({}))) as { action?: string };
  const action = body.action === "accept" ? "accept" : null;
  if (!action) {
    return NextResponse.json({ error: "Body must be { action: 'accept' }." }, { status: 400 });
  }

  const quote = await queryOne<{
    id: string;
    opportunity_id: string;
    trade: string | null;
    quote_amount: number | null;
  }>(`select id, opportunity_id, trade, quote_amount from quotes where id=$1 and org_id=$2`, [params.id, orgId]);
  if (!quote) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await query(`update quotes set is_out_of_range = false where id=$1`, [params.id]);

  await logAgent({
    agent: "operator",
    action: "quote-oor-accepted",
    level: "info",
    opportunityId: quote.opportunity_id,
    message: `Operator ${auth.email} accepted out-of-range ${quote.trade ?? "quote"} ($${quote.quote_amount ?? "?"}) as usable.`,
  });

  return NextResponse.json({ ok: true, opportunityId: quote.opportunity_id });
}
