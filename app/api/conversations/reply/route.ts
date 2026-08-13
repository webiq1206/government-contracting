import { NextResponse } from "next/server";
import { requireSubscriber } from "@/lib/api-auth";
import { resolveTenantOrgId } from "@/lib/tenant";
import { query, queryOne } from "@/lib/db";
import { sendOutreachEmail } from "@/lib/integrations/email-transport";
import { logAgent } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Plain text typed by an operator, rendered as HTML without letting markup through. */
function toHtml(text: string): string {
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return `<div style="font-family:Inter,Helvetica,Arial,sans-serif;color:#242424;font-size:14px;line-height:1.6">${escaped.replace(
    /\n/g,
    "<br />"
  )}</div>`;
}

/**
 * Send a message to a subcontractor from inside the platform.
 *
 * Replies inside the existing Gmail thread when one is supplied, so the sub
 * sees the conversation they already have with us rather than a new email out
 * of nowhere. The recipient is read from the subcontractor record, never taken
 * from the request, so this endpoint cannot be used to mail an arbitrary
 * address through a customer's mailbox.
 */
export async function POST(req: Request) {
  const auth = await requireSubscriber();
  if (auth instanceof NextResponse) return auth;
  const orgId = await resolveTenantOrgId();

  const body = (await req.json().catch(() => ({}))) as {
    subcontractorId?: string;
    opportunityId?: string | null;
    threadId?: string | null;
    inReplyTo?: string | null;
    subject?: string;
    message?: string;
  };

  const message = (body.message ?? "").trim();
  if (!body.subcontractorId || !message) {
    return NextResponse.json({ error: "Write a message first." }, { status: 400 });
  }
  if (message.length > 20000) {
    return NextResponse.json({ error: "That message is too long to send." }, { status: 400 });
  }

  // Tenant-scoped lookup: another org's subcontractor must be invisible here.
  const sub = await queryOne<{ id: string; company_name: string | null; email: string | null }>(
    `select id, company_name, email from subcontractors
      where id = $1 and (org_id = $2 or org_id is null)`,
    [body.subcontractorId, orgId]
  );
  if (!sub) return NextResponse.json({ error: "Not found." }, { status: 404 });
  if (!sub.email) {
    return NextResponse.json(
      { error: "This subcontractor has no email address on file." },
      { status: 400 }
    );
  }

  // Only accept an opportunity this sub is actually paired with, so a reply
  // cannot be filed against an unrelated solicitation.
  let opportunityId: string | null = null;
  if (body.opportunityId) {
    const pair = await queryOne<{ opportunity_id: string }>(
      `select os.opportunity_id from opportunity_subs os
         join opportunities o on o.id = os.opportunity_id
        where os.opportunity_id = $1 and os.subcontractor_id = $2 and o.org_id = $3`,
      [body.opportunityId, sub.id, orgId]
    );
    opportunityId = pair?.opportunity_id ?? null;
  }

  const subject =
    (body.subject ?? "").trim() ||
    (body.threadId ? "Re: your quote" : "Following up");

  const res = await sendOutreachEmail({
    to: sub.email,
    subject,
    html: toHtml(message),
    text: message,
    threadId: body.threadId ?? undefined,
    inReplyTo: body.inReplyTo ?? undefined,
    orgId,
  });

  if (res.disabled || res.blocked || res.error) {
    return NextResponse.json(
      { error: res.error ?? "Could not send that right now." },
      { status: res.disabled ? 503 : 502 }
    );
  }

  await query(
    `insert into communications
       (subcontractor_id, opportunity_id, channel, direction, subject, body,
        gmail_message_id, gmail_thread_id, provider, recipient_email, meta)
     values ($1,$2,'email','outbound',$3,$4,$5,$6,'gmail',$7,$8::jsonb)`,
    [
      sub.id,
      opportunityId,
      subject,
      message,
      res.messageId,
      res.threadId,
      sub.email,
      JSON.stringify({ kind: "manual" }),
    ]
  );

  await logAgent({
    agent: "outreach",
    action: "manual-reply",
    opportunityId: opportunityId ?? undefined,
    subcontractorId: sub.id,
    level: "info",
    message: `You emailed ${sub.company_name ?? sub.email} from the conversation view.`,
  });

  return NextResponse.json({ ok: true, threadId: res.threadId });
}
