import { NextResponse } from "next/server";
import { requireCapability } from "@/lib/api-auth";
import { resolveTenantOrgId } from "@/lib/tenant";
import { query, queryOne } from "@/lib/db";
import { sendOutreachEmail } from "@/lib/integrations/email-transport";
import { gmail } from "@/lib/integrations/gmail";
import { logAgent } from "@/lib/logger";
import { discardDraftsForThread } from "@/lib/domain/reply-draft";

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

/** Extract one deliverable mailbox from a stored RFC address value. */
function mailboxAddress(value: string | null | undefined): string | null {
  const raw = (value ?? "").trim();
  if (!raw) return null;
  const mailbox = (raw.match(/<([^>]+)>/)?.[1] ?? raw).trim();
  return /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(mailbox) ? mailbox : null;
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
  const auth = await requireCapability("outreach");
  if (auth instanceof NextResponse) return auth;
  const orgId = await resolveTenantOrgId();

  const body = (await req.json().catch(() => ({}))) as {
    subcontractorId?: string;
    opportunityId?: string | null;
    threadId?: string | null;
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
      where id = $1 and org_id = $2`,
    [body.subcontractorId, orgId]
  );
  if (!sub) return NextResponse.json({ error: "Not found." }, { status: 404 });

  /*
   * Rebuild the reply target from the tenant-owned conversation. The browser
   * only identifies the conversation; it is not trusted to choose a recipient,
   * opportunity, trade, Gmail thread, or Message-ID header. Apart from keeping
   * those fields in sync, this prevents a stale tab from replying to a changed
   * contact address instead of the person who actually wrote the message.
   */
  const messages = await query<{
    id: string;
    direction: string;
    subject: string | null;
    recipient_email: string | null;
    gmail_thread_id: string | null;
    rfc822_message_id: string | null;
    opportunity_id: string | null;
    meta: { trade?: string } | null;
  }>(
    `select c.id, c.direction, c.subject, c.recipient_email,
            c.gmail_thread_id, c.rfc822_message_id, c.opportunity_id, c.meta
       from communications c
      where c.org_id = $1 and c.subcontractor_id = $2 and c.channel = 'email'
        and (
          ($3::text is not null and c.gmail_thread_id = $3)
          or
          ($3::text is null and c.gmail_thread_id is null
             and c.opportunity_id is not distinct from $4::uuid)
        )
        and ($4::uuid is null or c.opportunity_id = $4::uuid)
      order by c.created_at asc`,
    [orgId, sub.id, body.threadId ?? null, body.opportunityId ?? null]
  );
  if (messages.length === 0) {
    return NextResponse.json(
      { error: "That conversation could not be found on this account. Nothing was sent." },
      { status: 404 }
    );
  }

  const latest = messages[messages.length - 1]!;
  const opportunityIds = [
    ...new Set(messages.map((m) => m.opportunity_id).filter((id): id is string => !!id)),
  ];
  if (opportunityIds.length > 1) {
    return NextResponse.json(
      {
        error:
          "That email thread is linked to more than one opportunity. Open the opportunity-specific conversation before sending; nothing was sent.",
      },
      { status: 409 }
    );
  }
  const opportunityId = opportunityIds[0] ?? null;
  const threadTrades = [
    ...new Set(
      messages
        .filter((m) => m.opportunity_id === opportunityId)
        .map((m) => m.meta?.trade?.trim())
        .filter((trade): trade is string => !!trade)
    ),
  ];
  if (threadTrades.length > 1) {
    return NextResponse.json(
      {
        error:
          "That email thread covers more than one trade. Open the trade-specific conversation before sending; nothing was sent.",
      },
      { status: 409 }
    );
  }
  let trade: string | null = threadTrades[0] ?? null;

  if (opportunityId) {
    const activePairs = await query<{ trade: string | null }>(
      `select os.trade
         from opportunity_subs os
         join opportunities o on o.id = os.opportunity_id
        where os.opportunity_id = $1 and os.subcontractor_id = $2
          and o.org_id = $3 and os.removed_at is null`,
      [opportunityId, sub.id, orgId]
    );
    if (trade) {
      if (!activePairs.some((p) => (p.trade ?? "") === trade)) {
        return NextResponse.json(
          { error: "This subcontractor is no longer active for that trade. Nothing was sent." },
          { status: 409 }
        );
      }
    } else if (activePairs.length === 1) {
      trade = activePairs[0]!.trade?.trim() || null;
    } else if (activePairs.length === 0) {
      return NextResponse.json(
        { error: "This subcontractor is no longer active on that opportunity. Nothing was sent." },
        { status: 409 }
      );
    } else {
      return NextResponse.json(
        {
          error:
            "This conversation covers more than one trade, so the reply target is ambiguous. Open the trade-specific conversation before sending.",
        },
        { status: 409 }
      );
    }
  }

  // Inbound recipient_email stores the sender's original From address. Prefer
  // it over the mutable subcontractor record, then fall back to the last
  // outbound recipient for conversations that have not received a reply yet.
  const recipient = mailboxAddress(
    [...messages]
      .reverse()
      .find((m) => m.direction === "inbound" && m.recipient_email?.trim())
      ?.recipient_email?.trim() ||
    [...messages].reverse().find((m) => m.recipient_email?.trim())?.recipient_email?.trim() ||
    sub.email
  );
  if (!recipient) {
    return NextResponse.json(
      { error: "This conversation has no recipient address on file. Nothing was sent." },
      { status: 400 }
    );
  }

  const threadId = latest.gmail_thread_id ?? null;
  let references = [...new Set(messages.map((m) => m.rfc822_message_id).filter(Boolean))] as string[];
  let inReplyTo = [...messages]
    .reverse()
    .find((m) => m.rfc822_message_id)?.rfc822_message_id ?? null;
  if (threadId && !inReplyTo) {
    const recovered = await gmail.threadMessageId(threadId, orgId, {
      preferLatestSent: false,
    });
    inReplyTo = recovered.rfc822MessageId;
    references = [...new Set([...references, ...recovered.references])];
  }
  if (threadId && !inReplyTo) {
    return NextResponse.json(
      {
        error:
          "The email thread is missing its Internet Message-ID, so a safe threaded reply could not be built. Reconnect Gmail or reply in Gmail; nothing was sent.",
      },
      { status: 409 }
    );
  }

  const storedSubject = messages.find((m) => m.subject?.trim())?.subject?.trim() ?? null;
  const subject = storedSubject
    ? `Re: ${storedSubject.replace(/^re:\s*/i, "")}`
    : (body.subject ?? "").trim() || (threadId ? "Re: your quote" : "Following up");

  const res = await sendOutreachEmail({
    to: recipient,
    subject,
    html: toHtml(message),
    text: message,
    threadId: threadId ?? undefined,
    inReplyTo: inReplyTo ?? undefined,
    references,
    orgId,
    opportunityId: opportunityId ?? undefined,
    subcontractorId: sub.id,
    trade,
  });

  if (res.disabled || res.blocked || res.error) {
    return NextResponse.json(
      { error: res.error ?? "Could not send that right now." },
      { status: res.disabled ? 503 : 502 }
    );
  }

  await query(
    `insert into communications
       (org_id, subcontractor_id, opportunity_id, channel, direction, subject, body,
        gmail_message_id, gmail_thread_id, rfc822_message_id, provider,
        recipient_email, meta)
     values ($1,$2,$3,'email','outbound',$4,$5,$6,$7,$8,$9,$10,$11::jsonb)`,
    [
      orgId,
      sub.id,
      opportunityId,
      subject,
      message,
      res.messageId ?? null,
      res.threadId ?? threadId,
      res.rfc822MessageId ?? null,
      res.provider,
      recipient,
      JSON.stringify({
        kind: "manual",
        ...(trade ? { trade } : {}),
        ...(inReplyTo ? { in_reply_to: inReplyTo } : {}),
        ...(references.length ? { references } : {}),
      }),
    ]
  );

  // The reply has gone out, so any draft for this thread is not a draft any
  // more. Discarded here, in the request that sent it, rather than by the
  // browser afterwards: a tidy-up the client forgets leaves sent text sitting
  // in the box on the next page load, one click from going out twice.
  await discardDraftsForThread({
    subcontractorId: sub.id,
    threadId: res.threadId ?? threadId,
    opportunityId,
    orgId,
  }).catch(async (err) => {
    // The mail is already gone, so failing the request now would tell the
    // operator their reply did not send when it did. Say so in the log
    // instead. A leftover row is untidy, not dangerous: drafts are only ever
    // read for a message that is still the last word in its thread, and this
    // one no longer is.
    await logAgent({
      agent: "outreach",
      action: "manual-reply",
      status: "error",
      subcontractorId: sub.id,
      opportunityId,
      level: "error",
      message: `Reply sent, but clearing the saved draft failed: ${(err as Error).message}`,
    }).catch(() => {});
  });

  await logAgent({
    agent: "outreach",
    action: "manual-reply",
    opportunityId: opportunityId ?? undefined,
    subcontractorId: sub.id,
    level: "info",
    message: `You emailed ${sub.company_name ?? sub.email} from the conversation view.`,
  });

  return NextResponse.json({
    ok: true,
    threadId: res.threadId ?? threadId,
    rfc822MessageId: res.rfc822MessageId ?? null,
  });
}
