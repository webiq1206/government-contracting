import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api-auth";
import { query, queryOne } from "@/lib/db";
import { logAgent } from "@/lib/logger";
import { sendApprovedOutreach } from "@/lib/backlink-send";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The human approval gate for backlink outreach. A person approves or rejects a
 * drafted message. Approving marks it ready to send; it does NOT auto-send here,
 * because sending cold outreach requires a verified recipient address and an
 * explicit send step (Gmail), which is intentionally kept separate so nothing
 * ever goes out unattended. Editing the copy before approval is supported.
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;
  const body = (await req.json().catch(() => ({}))) as {
    action?: "approve" | "reject";
    subject?: string;
    body?: string;
  };
  if (body.action !== "approve" && body.action !== "reject") {
    return NextResponse.json({ error: "action must be approve|reject" }, { status: 400 });
  }

  const outreach = await queryOne<{ id: string; prospect_id: string }>(
    `select id, prospect_id from backlink_outreach where id = $1`,
    [params.id]
  );
  if (!outreach) return NextResponse.json({ error: "Draft not found." }, { status: 404 });

  const domainRow = await queryOne<{ domain: string }>(
    `select domain from backlink_prospects where id = $1`,
    [outreach.prospect_id]
  );

  if (body.action === "approve") {
    // Allow a last-minute edit of the copy on approval.
    await query(
      `update backlink_outreach
          set approval_status = 'approved',
              subject = coalesce($2, subject),
              body = coalesce($3, body),
              updated_at = now()
        where id = $1`,
      [params.id, body.subject ?? null, body.body ?? null]
    );
    await query(`update backlink_prospects set status = 'in_outreach', updated_at = now() where id = $1`, [
      outreach.prospect_id,
    ]);
    await logAgent({
      agent: "operator",
      action: "outreach-approved",
      level: "success",
      message: `Approved backlink outreach to ${domainRow?.domain ?? outreach.prospect_id}.`,
    });
    // If we already have a contact email and Gmail is connected, send it now.
    // Otherwise it stays approved and is sent automatically once a contact is
    // discovered (sendPendingApproved runs on a schedule).
    const send = await sendApprovedOutreach(params.id);
    return NextResponse.json({ ok: true, action: "approve", send });
  } else {
    await query(
      `update backlink_outreach set approval_status = 'rejected', updated_at = now() where id = $1`,
      [params.id]
    );
    await query(`update backlink_prospects set status = 'rejected', updated_at = now() where id = $1`, [
      outreach.prospect_id,
    ]);
    await logAgent({
      agent: "operator",
      action: "outreach-rejected",
      message: `Rejected backlink outreach to ${domainRow?.domain ?? outreach.prospect_id}.`,
    });
  }

  return NextResponse.json({ ok: true, action: body.action });
}
