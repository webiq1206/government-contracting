/**
 * The Needs matching inbox.
 *
 * A subcontractor's reply to a bid invitation is a customer message. When the
 * poller cannot place it, the instruction is that it must not disappear into
 * an agent log, and the reason is worth stating plainly: an agent log is a
 * stream somebody reads when the automation is misbehaving, not a queue of
 * work. The line scrolls away, it carries no body, and the only instruction it
 * can give is "go and look in the mailbox".
 *
 * This is where those messages go instead: readable, placeable, and still
 * there tomorrow.
 */
import { query, queryOne } from "./db";
import { randomUUID } from "node:crypto";
import { captureReply, type MatchedComm } from "./reply-capture";
import {
  applyOutcomeToSolicitation,
  blockingGaps,
  recordReplyEvent,
} from "./domain/reply-outcome";

/** Enough to recognise a message and decide where it belongs. */
// The column keeps its historical name, but manual matching now feeds this
// text through the same extractor as an automatically placed reply. Keep the
// full bounded message, not a preview that can cut off the price or exclusions.
const SNIPPET_CHARS = 20_000;

export interface UnmatchedMessage {
  id: string;
  fromEmail: string;
  fromName: string | null;
  subject: string | null;
  snippet: string | null;
  receivedAt: Date;
  gmailThreadId: string | null;
  subcontractorId: string | null;
  subcontractorName: string | null;
  state: "needs_matching" | "matched" | "dismissed";
}

export interface RecordUnmatchedInput {
  orgId: string;
  fromEmail: string;
  fromName?: string | null;
  subject?: string | null;
  body?: string | null;
  gmailThreadId?: string | null;
  messageId?: string | null;
  rfc822MessageId?: string | null;
  references?: string[];
  toAddresses?: string | null;
  ccAddresses?: string | null;
  attachmentNames?: string[];
  unreadableAttachments?: string[];
  receivedAt?: Date | null;
  subcontractorId?: string | null;
}

/**
 * File a message nobody could place.
 *
 * Returns the row id, or null when this message is already in the inbox. The
 * unique index does the deduplication rather than a read-then-write, because a
 * poll that restarts mid-batch is exactly the case a read-then-write loses.
 *
 * A message with no Message-ID cannot be deduplicated, so it is inserted every
 * time. That is the honest trade: a duplicate an operator can dismiss is
 * better than a reply that was dropped because it lacked a header.
 */
export async function recordUnmatched(input: RecordUnmatchedInput): Promise<string | null> {
  const row = await queryOne<{ id: string }>(
    `insert into unmatched_inbound
       (org_id, from_email, from_name, subject, snippet, gmail_thread_id, message_id,
        rfc822_message_id, rfc822_references, to_addresses, cc_addresses,
        attachment_names, unreadable_attachments, received_at, subcontractor_id)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12::jsonb,$13::jsonb,
             coalesce($14, now()),$15)
     on conflict (org_id, message_id) where message_id is not null do nothing
     returning id`,
    [
      input.orgId,
      input.fromEmail.toLowerCase(),
      input.fromName ?? null,
      input.subject ?? null,
      (input.body ?? "").slice(0, SNIPPET_CHARS) || null,
      input.gmailThreadId ?? null,
      input.messageId ?? null,
      input.rfc822MessageId ?? null,
      JSON.stringify(input.references ?? []),
      input.toAddresses ?? null,
      input.ccAddresses ?? null,
      JSON.stringify(input.attachmentNames ?? []),
      JSON.stringify(input.unreadableAttachments ?? []),
      input.receivedAt ?? null,
      input.subcontractorId ?? null,
    ]
  );
  return row?.id ?? null;
}

/**
 * What is still waiting, oldest first.
 *
 * Oldest rather than newest, which is the opposite of a mailbox and the right
 * order for a queue: the message that has been sitting longest is the one most
 * likely to have already cost something.
 */
export async function needsMatching(orgId: string, limit = 100): Promise<UnmatchedMessage[]> {
  const rows = await query<Record<string, unknown>>(
    `select u.id, u.from_email, u.from_name, u.subject, u.snippet, u.received_at,
            u.gmail_thread_id, u.subcontractor_id, u.state, s.company_name
       from unmatched_inbound u
       left join subcontractors s on s.id = u.subcontractor_id
      where u.org_id = $1 and u.state = 'needs_matching'
      order by u.received_at
      limit $2`,
    [orgId, limit]
  );
  return rows.map((r) => ({
    id: String(r.id),
    fromEmail: String(r.from_email),
    fromName: (r.from_name as string) ?? null,
    subject: (r.subject as string) ?? null,
    snippet: (r.snippet as string) ?? null,
    receivedAt: r.received_at as Date,
    gmailThreadId: (r.gmail_thread_id as string) ?? null,
    subcontractorId: (r.subcontractor_id as string) ?? null,
    subcontractorName: (r.company_name as string) ?? null,
    state: "needs_matching",
  }));
}

/** How many are waiting. Used for the badge, so it is a count and not a list. */
export async function needsMatchingCount(orgId: string): Promise<number> {
  const row = await queryOne<{ n: number }>(
    `select count(*)::int as n from unmatched_inbound
      where org_id = $1 and state = 'needs_matching'`,
    [orgId]
  );
  return row?.n ?? 0;
}

/**
 * Place a message against an opportunity, recording it as a real reply.
 *
 * The communication row is what makes this a reply rather than a note: it is
 * the same table every matched reply lands in, so the conversation, the
 * coverage and the timeline all see it without knowing it arrived by hand.
 */
export async function matchMessage(
  id: string,
  orgId: string,
  opportunityId: string,
  actor: string,
  subcontractorId?: string | null
): Promise<{ communicationId: string } | null> {
  const msg = await queryOne<{
    id: string;
    from_email: string;
    subject: string | null;
    snippet: string | null;
    gmail_thread_id: string | null;
    received_at: Date;
    subcontractor_id: string | null;
    message_id: string | null;
    rfc822_message_id: string | null;
    rfc822_references: unknown;
    to_addresses: string | null;
    cc_addresses: string | null;
    from_name: string | null;
    attachment_names: unknown;
    unreadable_attachments: unknown;
  }>(
    `select id, from_email, subject, snippet, gmail_thread_id, received_at,
            subcontractor_id, message_id, rfc822_message_id,
            rfc822_references, to_addresses, cc_addresses, from_name,
            attachment_names, unreadable_attachments
       from unmatched_inbound
      where id = $1 and org_id = $2 and state = 'needs_matching'`,
    [id, orgId]
  );
  if (!msg) return null;

  // Both scoped: an opportunity id and a subcontractor id both arrive in a
  // request body, and neither is proof of anything on its own.
  const opp = await queryOne<{ id: string; title: string | null }>(
    `select id, title from opportunities where id = $1 and org_id = $2`,
    [opportunityId, orgId]
  );
  if (!opp) return null;

  const subId = subcontractorId ?? msg.subcontractor_id;
  if (subId) {
    const sub = await queryOne<{ id: string }>(
      `select id from subcontractors where id = $1 and org_id = $2`,
      [subId, orgId]
    );
    if (!sub) return null;
  }

  // Claim without removing the item from the visible queue. A second tab gets
  // no claim, and an interrupted worker becomes eligible again after fifteen
  // minutes. The random token, rather than the actor address, lets the failure
  // cleanup release only its own attempt.
  const claimToken = `matching:${randomUUID()}`;
  const claimed = await query<{ id: string }>(
    `update unmatched_inbound
        set matched_by = $3, matched_at = now()
      where id = $1 and org_id = $2 and state = 'needs_matching'
        and (matched_at is null or matched_at <= now() - interval '15 minutes')
      returning id`,
    [id, orgId, claimToken]
  );
  if (claimed.length === 0) return null;

  /*
   * A person supplied the missing correlation signal. From here on this is
   * the same capture path as an automatically matched reply: extract it,
   * record the real inbound communication, update the exact pairing only when
   * the reading is safe, save a usable quote, and trigger the same downstream
   * work. A hand-matched message must not become a second-class note that the
   * pricing and coverage workflows never see.
   */
  try {
  const outbound = subId
    ? await queryOne<MatchedComm>(
        `select c.id, c.subcontractor_id, c.opportunity_id,
                s.company_name, coalesce(c.recipient_email, s.email) as sub_email,
                o.title as opportunity_title, c.meta->>'trade' as trade
           from communications c
           join opportunities o on o.id = c.opportunity_id and o.org_id = $3
           left join subcontractors s on s.id = c.subcontractor_id and s.org_id = $3
          where c.org_id = $3 and c.opportunity_id = $1
            and c.subcontractor_id = $2 and c.direction = 'outbound'
          order by c.created_at desc
          limit 1`,
        [opportunityId, subId, orgId]
      )
    : null;
  const matched: MatchedComm = outbound ?? {
    // There may be no outbound row when somebody forwarded the request or
    // wrote from a new address. captureReply only uses this id to stamp the
    // answered outbound; a non-row is therefore the honest representation.
    id: `unmatched:${id}`,
    subcontractor_id: subId ?? null,
    opportunity_id: opportunityId,
    company_name: null,
    sub_email: msg.from_email,
    opportunity_title: opp.title,
    trade: null,
  };

  const captured = await captureReply({
    orgId,
    comm: matched,
    strongMatch: true,
    attributionConfirmed: true,
    fromEmail: msg.from_email,
    fromAddress: msg.from_name ?? msg.from_email,
    toAddresses: msg.to_addresses,
    ccAddresses: msg.cc_addresses,
    replyText: msg.snippet ?? "",
    subject: msg.subject,
    threadId: msg.gmail_thread_id,
    messageId: msg.message_id,
    rfc822MessageId: msg.rfc822_message_id,
    references: Array.isArray(msg.rfc822_references)
      ? msg.rfc822_references.filter((value): value is string => typeof value === "string")
      : [],
    attachmentNames: Array.isArray(msg.attachment_names)
      ? msg.attachment_names.filter((value): value is string => typeof value === "string")
      : [],
    unreadableAttachments: Array.isArray(msg.unreadable_attachments)
      ? msg.unreadable_attachments.filter((value): value is string => typeof value === "string")
      : [],
    sentAt: msg.received_at.toISOString(),
  });
  if (captured.bounce) {
    await query(
      `update unmatched_inbound set matched_by = null, matched_at = null
        where id = $1 and org_id = $2 and state = 'needs_matching' and matched_by = $3`,
      [id, orgId, claimToken]
    );
    return null;
  }

  if (captured.subId && !captured.duplicate) {
    const gaps = blockingGaps(captured.extracted, captured.decision.outcome);
    await recordReplyEvent({
      orgId,
      subcontractorId: captured.subId,
      opportunityId,
      trade: captured.trade,
      extracted: captured.extracted,
      originalMessage: msg.snippet ?? "",
      gmailMessageId: msg.message_id,
      gmailThreadId: msg.gmail_thread_id,
      needsReview: captured.decision.needsReview || gaps.length > 0,
      reviewReason:
        captured.decision.reviewReason ??
        (gaps.length ? `Still needed before this can move forward: ${gaps.join(", ")}.` : null),
    });

    // captureReply handles closeout and quote persistence. This applies the
    // remaining taxonomy, exactly as the mailbox poller does, but never calls
    // a refused price "quoted".
    if (
      captured.decision.act &&
      !captured.declined &&
      !(captured.decision.outcome === "quoted" && captured.quoteRefusal)
    ) {
      const applied = await applyOutcomeToSolicitation({
        opportunityId,
        subcontractorId: captured.subId,
        trade: captured.trade,
        outcome: captured.decision.outcome,
      });
      if (!applied.applied && applied.refused === "ambiguous_trade") {
        await query(
          `update subcontractor_reply_events
              set needs_review = true,
                  review_reason = $3
            where org_id = $1 and gmail_message_id is not distinct from $2
              and reviewed_at is null`,
          [
            orgId,
            msg.message_id,
            `They are on this bid for ${applied.candidateTrades.join(", ")} and the reply did not say which. Nothing was changed.`,
          ]
        );
      }
    }
  }

  const comm = msg.message_id
    ? await queryOne<{ id: string }>(
        `select id from communications
          where org_id = $1 and direction = 'inbound' and gmail_message_id = $2
          limit 1`,
        [orgId, msg.message_id]
      )
    : await queryOne<{ id: string }>(
        `select id from communications
          where org_id = $1 and direction = 'inbound'
            and opportunity_id = $2 and recipient_email = $3
            and created_at >= $4::timestamptz
          order by created_at desc limit 1`,
        [orgId, opportunityId, msg.from_email, msg.received_at]
      );
  if (!comm) {
    throw new Error("The reply was captured but its communication record could not be reloaded.");
  }

  const finished = await query<{ id: string }>(
    `update unmatched_inbound set state='matched', matched_communication_id=$3,
            matched_opportunity_id=$4, matched_by=$5, matched_at=now()
      where id=$1 and org_id=$2 and state='needs_matching' and matched_by=$6
      returning id`,
    [id, orgId, comm.id, opportunityId, actor, claimToken]
  );
  if (finished.length === 0) {
    throw new Error("This reply match was changed by another request before it could finish.");
  }
  return { communicationId: comm.id };
  } catch (err) {
    await query(
      `update unmatched_inbound set matched_by = null, matched_at = null
        where id = $1 and org_id = $2 and state = 'needs_matching' and matched_by = $3`,
      [id, orgId, claimToken]
    ).catch(() => undefined);
    throw err;
  }
}

/**
 * Say this message is not ours, and why.
 *
 * The reason is required, and the constraint underneath enforces it. "Not
 * ours" with no reason is indistinguishable from a message somebody could not
 * be bothered to read, and the whole value of this inbox is that the
 * difference is visible.
 */
export async function dismissMessage(
  id: string,
  orgId: string,
  reason: string,
  actor: string
): Promise<boolean> {
  const trimmed = reason.trim();
  if (!trimmed) return false;
  const rows = await query<{ id: string }>(
    `update unmatched_inbound set state='dismissed', dismissed_reason=$3,
            dismissed_by=$4, dismissed_at=now()
      where id=$1 and org_id=$2 and state='needs_matching'
        and (matched_at is null or matched_at <= now() - interval '15 minutes')
      returning id`,
    [id, orgId, trimmed, actor]
  );
  return rows.length > 0;
}
