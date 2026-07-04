import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api-auth";
import { query, queryOne } from "@/lib/db";
import { enqueue } from "@/lib/queue";
import { logAgent } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Capture a completed call: notes/responses, optional project-history collection,
 * and an optional written quote (which pre-fills quote entry and triggers Bid Builder).
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;
  const body = await req.json().catch(() => ({}));

  const card = await queryOne<{ opportunity_id: string; subcontractor_id: string }>(
    `select opportunity_id, subcontractor_id from call_cards where id=$1`,
    [params.id]
  );
  if (!card) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await query(
    `update call_cards set status='called', called_at=now(), response_json=$2 where id=$1`,
    [params.id, JSON.stringify(body.responses ?? {})]
  );

  // Persist collected project history onto the subcontractor.
  if (Array.isArray(body.project_history) && body.project_history.length) {
    await query(`update subcontractors set project_history=$2 where id=$1`, [
      card.subcontractor_id,
      JSON.stringify(body.project_history),
    ]);
  }

  // Log the call as a communication.
  await query(
    `insert into communications (subcontractor_id, opportunity_id, channel, direction, body)
     values ($1,$2,'call','inbound',$3)`,
    [card.subcontractor_id, card.opportunity_id, body.notes ?? "Call completed."]
  );

  // Optional written quote from the call.
  let quoted = false;
  const amount = Number(body.quote?.quote_amount);
  if (Number.isFinite(amount) && amount > 0) {
    await query(
      `insert into quotes (opportunity_id, subcontractor_id, trade, quote_amount, payment_terms, notes)
       values ($1,$2,$3,$4,$5,$6)`,
      [
        card.opportunity_id,
        card.subcontractor_id,
        body.quote?.trade ?? null,
        amount,
        body.quote?.payment_terms ?? null,
        body.quote?.notes ?? null,
      ]
    );
    await query(`update opportunities set stage='quote_entry' where id=$1`, [card.opportunity_id]);
    await enqueue("bid-builder", { opportunityId: card.opportunity_id });
    quoted = true;
  }

  await logAgent({
    agent: "operator",
    action: "call-complete",
    opportunityId: card.opportunity_id,
    subcontractorId: card.subcontractor_id,
    level: "info",
    message: `Operator ${auth.email} completed call.${quoted ? " Quote entered, triggered Bid Builder." : ""}`,
  });

  return NextResponse.json({ ok: true, quoted });
}
