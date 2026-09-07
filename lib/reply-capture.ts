/**
 * Shared inbound-reply capture pipeline, used by the Gmail reply poller
 * (lib/agents/maintenance.ts) and written to be reusable by an inbound-mail
 * webhook. Given an already-matched outbound communication, it resolves or
 * creates the subcontractor, records the inbound communication, then either
 * soft-closes on decline or marks responsive and auto-saves the quote under
 * the safety rules in lib/reply-matching.ts.
 *
 * Everything here takes the organization as an argument rather than resolving
 * it, and every lookup names it.
 *
 * The reason is the weak match. A reply that carries no tracking token and no
 * thread id is correlated by the sender's own email address, and an address is
 * not unique to one tenant: the same electrician is on several customers'
 * rosters and gets outreach from all of them. Unscoped, one customer's inbox
 * poll could match another customer's outbound email, record the reply against
 * their opportunity, mark it replied, attach the subcontractor, and on a strong
 * enough match save a quote and start their bid. The sender chooses which
 * organization gets hit by choosing when to reply, which is why the filter
 * cannot be left to the caller to remember.
 */
import { query, queryOne } from "./db";
import { actingOrgId, runWithOrg } from "./tenant-context";
import {
  extractReplyFromReply,
  type ExtractedReply,
} from "./ai/reply-extract";
import {
  senderMatchesSub,
  shouldAutoSaveQuote,
  shouldAutoDecline,
  normalizeEmail,
} from "./reply-matching";
import { closeOutDeclinedSub } from "./domain/decline-closeout";
import { decideReply, type ReplyDecision } from "./domain/reply-outcome";
import { looksLikeBounce } from "./domain/email-delivery";
import { enqueue } from "./queue";
import { logAgent } from "./logger";
import { proposeRow, type Refusal } from "./domain/quote-fields";
import { saveProposedRow } from "./pricing-rows";

export interface MatchedComm {
  id: string;
  subcontractor_id: string | null;
  opportunity_id: string;
  company_name: string | null;
  sub_email: string | null;
  opportunity_title: string | null;
  /**
   * Trade the outbound email was about. Carried through so a reply outcome
   * lands on the right trade line rather than every trade this sub was
   * approached for on the same solicitation.
   */
  trade: string | null;
}

export interface CaptureReplyInput {
  /** The organization that owns the conversation this reply belongs to. */
  orgId: string;
  comm: MatchedComm;
  /** Reply correlated reliably (Gmail thread id or Resend plus-address token). */
  strongMatch: boolean;
  /** A signed-in operator explicitly placed this message against this record. */
  attributionConfirmed?: boolean;
  fromEmail: string;
  replyText: string;
  threadId?: string | null;
  messageId?: string | null;
  /**
   * The raw subject and content type, when the caller has them.
   *
   * Passed so this function can decide for itself whether it is looking at a
   * delivery report rather than trusting that someone upstream already
   * checked. See the guard in captureReply.
   */
  subject?: string | null;
  contentType?: string | null;
  /**
   * The message envelope, stored verbatim on the recorded reply so the history
   * is the email rather than our summary of it.
   */
  fromAddress?: string | null;
  toAddresses?: string | null;
  ccAddresses?: string | null;
  /** The Date header as sent: when THEY wrote, not when we happened to poll. */
  sentAt?: string | null;
  attachmentNames?: string[];
  /** The reply's own RFC822 Message-ID, so a later message can cite it. */
  rfc822MessageId?: string | null;
  /** The message's RFC822 reference chain, oldest first. */
  references?: string[];
  /**
   * Attachments that looked like a quote but could not be read. Their contents
   * are unknown, not absent, so a reply carrying one is never acted on
   * automatically. Passed in because the caller reads the attachments.
   */
  unreadableAttachments?: string[];
  /** Injectable for tests; defaults to the Claude extractor. */
  extract?: typeof extractReplyFromReply;
  /** Injectable for tests; defaults to closeOutDeclinedSub. */
  closeOut?: typeof closeOutDeclinedSub;
}

export interface CaptureReplyResult {
  subId: string | null;
  companyName: string | null;
  extracted: ExtractedReply;
  /**
   * Why a price in this reply was not filed, when one was not.
   *
   * Null covers both "there was no price" and "the price was filed". The
   * caller distinguishes them with `quoteSaved`; this field exists so a
   * refusal is a value the poller can act on rather than a line in a log.
   */
  quoteRefusal?: Refusal | null;
  /**
   * Whether this reading was trusted enough to change anything, and why not.
   * Returned so the caller reports the same verdict that governed the writes,
   * rather than computing a second opinion after the fact.
   */
  decision: ReplyDecision;
  quoteSaved: boolean;
  quoteSkippedExisting: boolean;
  senderVerified: boolean;
  trade: string | null;
  /** True when this provider message id was already captured (webhook retry / re-poll); no side effects were repeated. */
  duplicate: boolean;
  /** True when decline / can't-fulfill was applied (callers must skip call-prep). */
  declined: boolean;
  thankYouSent: boolean;
  /**
   * True when this message was a delivery-status report, not a reply. Nothing
   * was written. The caller should record the bounce instead.
   */
  bounce?: boolean;
}

function emptyExtracted(): ExtractedReply {
  return {
    intent: "other",
    isQuote: false,
    quoteAmount: null,
    paymentTerms: null,
    notes: null,
    companyName: null,
    canPerform: null,
    capabilityNotes: null,
    tradesMentioned: [],
    scopeSummary: null,
    laborCost: null,
    materialCost: null,
    taxesAmount: null,
    freightAmount: null,
    mobilizationAmount: null,
    bondingAmount: null,
    exclusions: [],
    qualifications: [],
    leadTimeDays: null,
    availabilityNotes: null,
    quoteValidUntil: null,
    priceIsFirm: null,
    taxesIncluded: null,
    alternates: [],
    earliestStart: null,
    coversFullScope: null,
    uncoveredScope: null,
    referredTo: null,
    missingFields: [],
    conflicts: [],
    confidence: 0,
    method: "regex",
  };
}

/**
 * Correlation address for outbound sends: replies come back to
 * `local+t<trackingId>@domain` so the inbound webhook can match them exactly.
 */
export function replyCorrelationAddress(fromAddress: string, trackingId: string): string | null {
  const mailbox = fromAddress.match(/<([^>]+)>/)?.[1] ?? fromAddress;
  const at = mailbox.lastIndexOf("@");
  if (at <= 0) return null;
  const local = mailbox.slice(0, at).trim();
  const domain = mailbox.slice(at + 1).trim();
  if (!local || !domain) return null;
  return `${local}+t${trackingId}@${domain}`;
}

/** Extract the tracking token from any plus-addressed recipient. */
export function parseCorrelationToken(recipients: string[]): string | null {
  for (const r of recipients) {
    const mailbox = (r.match(/<([^>]+)>/)?.[1] ?? r).trim().toLowerCase();
    const m = mailbox.match(/^[^+@]+\+t([0-9a-f-]{8,})@/);
    if (m) return m[1];
  }
  return null;
}

/**
 * Find the outbound communication a reply belongs to (strong then weak match),
 * within one organization's own conversations.
 *
 * The mailbox being polled belongs to one customer, so the reply it produced
 * can only answer that customer's outreach. A match outside the org is not a
 * weaker match, it is the wrong conversation.
 */
export async function matchInboundReply(opts: {
  /** The organization whose mailbox this reply arrived in. */
  orgId: string;
  /** Plus-address tracking token extracted from the To/recipient list. Strong match. */
  trackingToken?: string | null;
  /** Gmail thread ID. Strong match (Gmail transport only). */
  threadId?: string | null;
  /**
   * The message's own reference chain: In-Reply-To first, then References.
   *
   * The strongest correlation there is, and the only one that belongs to the
   * message rather than to our copy of it. It names the exact email being
   * answered, and it keeps working across forwarding, aliases, and a
   * subcontractor who changes mail provider mid-solicitation.
   */
  referenceIds?: string[];
  fromEmail: string;
}): Promise<{ comm: MatchedComm | null; strongMatch: boolean }> {
  const select = `select c.id, c.subcontractor_id, c.opportunity_id,
            s.company_name, coalesce(c.recipient_email, s.email) as sub_email,
            o.title as opportunity_title,
            (c.meta->>'trade') as trade
       from communications c
       left join subcontractors s on s.id = c.subcontractor_id and s.org_id = $1
       join opportunities o on o.id = c.opportunity_id and o.org_id = $1
      where c.org_id = $1`;
  if (opts.trackingToken) {
    const comm = await queryOne<MatchedComm>(
      `${select}
        and c.tracking_id = $2 and c.direction='outbound'
        order by c.created_at desc limit 1`,
      [opts.orgId, opts.trackingToken]
    );
    if (comm) return { comm, strongMatch: true };
  }
  /*
   * The reference chain, before thread or sender.
   *
   * In-Reply-To names one specific email. Ordered newest-first among the ids
   * the message actually cites, so a long conversation attaches to its most
   * recent message rather than to whichever ancestor happens to sort first.
   */
  if (opts.referenceIds?.length) {
    const comm = await queryOne<MatchedComm>(
      `${select}
        and c.rfc822_message_id = any($2::text[]) and c.direction='outbound'
        order by c.created_at desc limit 1`,
      [opts.orgId, opts.referenceIds.filter(Boolean)]
    );
    if (comm) return { comm, strongMatch: true };
  }

  /*
   * `replied_at is null` used to sit on both of the matches below, and it is
   * why replies stopped registering.
   *
   * Read it literally: an outbound email may be matched to a reply only while
   * it has never been replied to. So the FIRST reply on a thread matched and
   * stamped replied_at, and every reply after it matched nothing and was
   * dropped -- `if (!comm) continue` in the poller, no row, no log, no trace.
   * That is the ordinary shape of a real negotiation: "can you send the
   * drawings?", then the drawings, then the actual price. The condition threw
   * away the message carrying the bid and kept the one asking for plans.
   *
   * It was there to stop the same reply being captured twice. It was never
   * needed for that: captureReply keys idempotency on the provider's own
   * message id, backed by a unique index, so a re-poll or a webhook retry is
   * already a no-op. Removing it costs nothing and restores the rest of every
   * conversation.
   */
  if (opts.threadId) {
    const comm = await queryOne<MatchedComm>(
      `${select}
        and c.gmail_thread_id = $2 and c.direction='outbound'
        order by c.created_at desc limit 1`,
      [opts.orgId, opts.threadId]
    );
    if (comm) return { comm, strongMatch: true };
  }
  /*
   * Sender only, and deliberately time-boxed.
   *
   * This is the weakest signal: an address identifies a firm, not a
   * conversation, so it cannot distinguish "answering the roofing package we
   * sent on Tuesday" from "asking about something else entirely". Dropping
   * replied_at above removed the accidental bound that used to keep it near
   * the present, so an explicit one takes its place: without it, an unrelated
   * note from a subcontractor we last emailed a year ago would attach itself
   * to that year-old solicitation. Ninety days is far longer than any live
   * bid cycle and far shorter than "forever".
   */
  const candidates = await query<MatchedComm>(
    `select id, subcontractor_id, opportunity_id, company_name, sub_email,
            opportunity_title, trade
       from (
         select c.id, c.subcontractor_id, c.opportunity_id,
                s.company_name, coalesce(c.recipient_email, s.email) as sub_email,
                o.title as opportunity_title, (c.meta->>'trade') as trade,
                c.created_at,
                row_number() over (
                  partition by c.opportunity_id, coalesce(c.meta->>'trade', ''),
                               coalesce(c.gmail_thread_id, '')
                  order by c.created_at desc
                ) as conversation_rank
           from communications c
           left join subcontractors s on s.id = c.subcontractor_id and s.org_id = $1
           join opportunities o on o.id = c.opportunity_id and o.org_id = $1
          where c.org_id = $1 and c.direction = 'outbound'
            and lower(coalesce(c.recipient_email, s.email)) = $2
            and c.created_at > now() - interval '90 days'
            and exists (
              select 1 from opportunity_subs os
               where os.opportunity_id = c.opportunity_id
                 and os.subcontractor_id = c.subcontractor_id
                 and os.removed_at is null
                 and coalesce(os.trade, '') = coalesce(c.meta->>'trade', '')
            )
       ) candidate
      where conversation_rank = 1
      order by created_at desc
      limit 2`,
    [opts.orgId, normalizeEmail(opts.fromEmail)]
  );
  // Sender alone identifies a firm, not a solicitation. It is usable only
  // when exactly one live conversation could possibly be the answer.
  return {
    comm: candidates.length === 1 ? candidates[0]! : null,
    strongMatch: false,
  };
}

export async function captureReply(input: CaptureReplyInput): Promise<CaptureReplyResult> {
  if (!input.comm) throw new Error("Choose the conversation this reply belongs to before capturing it.");
  const actorOrg = await actingOrgId();
  if (actorOrg && actorOrg !== input.orgId) {
    throw new Error("Reply capture was refused because the account does not own this conversation.");
  }
  const owner = await queryOne<{ id: string }>(
    `select o.id from opportunities o
      where o.id=$1 and o.org_id=$2
        and ($3::uuid is null or exists (
          select 1 from subcontractors s where s.id=$3 and s.org_id=o.org_id
        ))
        and (exists (
          select 1 from communications c
           where c.id::text=$4 and c.org_id=o.org_id and c.opportunity_id=o.id
             and c.subcontractor_id is not distinct from $3::uuid
             and c.direction='outbound'
        ) or ($5::boolean and exists (
          select 1 from unmatched_inbound u
           where ('unmatched:' || u.id::text)=$4 and u.org_id=o.org_id
             and u.state='needs_matching' and u.matched_by like 'matching:%'
        )))`,
    [input.comm.opportunity_id, input.orgId, input.comm.subcontractor_id,
      input.comm.id, input.attributionConfirmed === true]
  );
  if (!owner) {
    throw new Error("Reply capture was refused because the opportunity and contact do not belong to this account.");
  }
  // Extraction, closeout, queueing and logs share the already-proven owner.
  return runWithOrg(input.orgId, () => captureReplyInOrg(input));
}

async function captureReplyInOrg(input: CaptureReplyInput): Promise<CaptureReplyResult> {
  const { orgId, comm, strongMatch, fromEmail, replyText } = input;
  const extract = input.extract ?? extractReplyFromReply;
  const closeOut = input.closeOut ?? closeOutDeclinedSub;

  /**
   * A delivery report is not a reply, and this function must not be the place
   * that finds out too late.
   *
   * The poller already checks before calling here, and that check was the
   * ONLY thing standing between a bounce and an inbound row. One heuristic,
   * one call site, no second opinion: everything it did not recognise landed
   * on the strong-match branch above -- the highest-trust path, the one
   * permitted to save a quote and close a subcontractor out -- and was written
   * with a hardcoded direction of 'inbound'. Nothing downstream re-examined
   * it, because by then it was simply a reply.
   *
   * So the check is repeated where the writes actually happen. Both call
   * sites can now be wrong only by both being wrong, and a future caller
   * cannot forget it at all.
   */
  if (
    looksLikeBounce({
      from: fromEmail,
      subject: input.subject ?? null,
      contentType: input.contentType ?? null,
      body: replyText,
    })
  ) {
    return {
      subId: comm.subcontractor_id,
      companyName: comm.company_name,
      extracted: emptyExtracted(),
      decision: {
        outcome: "none",
        proposed: null,
        act: false,
        needsReview: true,
        reviewReason:
          "This looked like a delivery failure notice rather than a reply, so nothing was recorded or changed.",
      },
      quoteSaved: false,
      quoteSkippedExisting: false,
      senderVerified: false,
      trade: null,
      duplicate: false,
      declined: false,
      thankYouSent: false,
      bounce: true,
    };
  }

  // Idempotency: webhook providers retry deliveries and the Gmail poller
  // re-scans a sliding window. If this provider message id was already
  // captured, skip all side effects (the unique index from migration 022
  // also guards the insert against races).
  if (input.messageId) {
    const existing = await queryOne<{ id: string; subcontractor_id: string | null }>(
      `select id, subcontractor_id from communications
        where org_id = $2 and direction='inbound' and gmail_message_id = $1 limit 1`,
      [input.messageId, orgId]
    );
    if (existing) {
      return {
        subId: existing.subcontractor_id ?? comm.subcontractor_id,
        companyName: comm.company_name,
        extracted: emptyExtracted(),
        // A redelivery of something already handled. Nothing is read again and
        // nothing may act, and it is not a review case either: the first
        // delivery already decided that.
        decision: { outcome: "none", proposed: null, act: false, needsReview: false, reviewReason: null },
        quoteSaved: false,
        quoteSkippedExisting: false,
        senderVerified: false,
        trade: null,
        duplicate: true,
        declined: false,
        thankYouSent: false,
      };
    }
  }

  // Trade context (from the opportunity_subs link when we know the sub).
  // The trade this reply is about: the outbound email's own trade first (it
  // is stamped in the comm's meta at send time), then the pairing row, but
  // only when the pair has exactly ONE trade. An unordered `limit 1` over a
  // multi-trade pair picked an arbitrary trade and the outcome landed on it.
  let pairTrades = comm.subcontractor_id
    ? await query<{ trade: string | null }>(
        `select distinct trade from opportunity_subs
          where opportunity_id=$1 and subcontractor_id=$2 and removed_at is null`,
        [comm.opportunity_id, comm.subcontractor_id]
      )
    : [];
  const commTradeIsActive = Boolean(
    comm.trade && pairTrades.some((p) => (p.trade ?? "") === comm.trade)
  );
  let osRow: { trade: string | null } | null = commTradeIsActive
    ? { trade: comm.trade }
    : !comm.trade && pairTrades.length === 1
      ? pairTrades[0]
      : null;
  let linkedPair = comm.subcontractor_id != null && osRow != null;

  const extracted = await extract(replyText, {
    opportunityTitle: comm.opportunity_title,
    trade: osRow?.trade ?? null,
  });

  /**
   * Decide whether this reading may change anything, BEFORE anything is
   * changed.
   *
   * This gate already existed, but it ran in the poller after capture had
   * finished, which is after the two writes it is meant to govern. A reply the
   * model scored 0.2, or one quoting two different prices, or one whose only
   * price was in an attachment nobody could open, still had its quote saved to
   * the bid and the solicitation advanced, or the subcontractor closed out and
   * thanked by email. The poller then announced that nothing had been changed
   * automatically, which was untrue by the time it said it.
   *
   * Sender ownership and thread correlation are separate questions and still
   * apply on top of this: they establish who is speaking, this establishes
   * whether we understood them.
   */
  const readingDecision = decideReply(extracted, {
    unreadableAttachments: input.unreadableAttachments ?? [],
  });

  // When several active trade assignments exist and the outbound row did not
  // carry one, use the reply's own explicit trade only if it identifies one
  // pairing uniquely. Anything less stays unassigned for a person to resolve.
  if (!osRow && pairTrades.length > 1 && extracted.tradesMentioned.length > 0) {
    const mentioned = new Set(
      extracted.tradesMentioned.map((trade) => trade.trim().toLowerCase()).filter(Boolean)
    );
    const matches = pairTrades.filter((pair) =>
      pair.trade ? mentioned.has(pair.trade.trim().toLowerCase()) : false
    );
    if (matches.length === 1) {
      osRow = matches[0];
      linkedPair = comm.subcontractor_id != null;
    }
  }

  // Resolve the subcontractor. Sender ownership: the reply must come from the
  // mailbox of the sub the outreach was addressed to; when the comm had no
  // linked sub, resolving/creating from the sender's own address is
  // verification by definition.
  let subId = comm.subcontractor_id;
  let companyName = comm.company_name;
  let senderVerified =
    input.attributionConfirmed === true || senderMatchesSub(fromEmail, comm.sub_email);
  if (!subId) {
    // Scoped to this org: the same firm sits on several customers' rosters, so
    // an unscoped match hands back another customer's subcontractor and pairs
    // them with this opportunity.
    const bySender = await queryOne<{ id: string; company_name: string }>(
      `select id, company_name from subcontractors
        where org_id = $2 and lower(email) = $1 limit 1`,
      [normalizeEmail(fromEmail), orgId]
    );
    if (bySender) {
      subId = bySender.id;
      companyName = bySender.company_name;
      senderVerified = true;
    } else {
      const name =
        extracted.companyName?.trim() ||
        fromEmail.split("@")[1]?.split(".")[0] ||
        fromEmail;
      // subcontractors is a root table, so nothing derives its org. A sub
      // created here without one is invisible to the roster of the customer
      // whose reply created it.
      const inserted = await queryOne<{ id: string }>(
        `insert into subcontractors (org_id, company_name, email, email_verified, trade_categories, notes)
         values ($4, $1, $2, false, $3, 'Auto-created from an email reply to outreach; verify before relying on it.')
         returning id`,
        [name, normalizeEmail(fromEmail), osRow?.trade ? [osRow.trade] : [], orgId]
      );
      subId = inserted?.id ?? null;
      companyName = name;
      if (subId) {
        senderVerified = true; // sub is defined by this sender's address
      }
    }

    if (subId) {
      await query(`update communications set subcontractor_id=$2
                    where id::text=$1 and org_id=$3 and opportunity_id=$4`, [
        comm.id,
        subId,
        orgId,
        comm.opportunity_id,
      ]);
      // The message has just established the missing relationship. Use a
      // not-exists insert because the historical unique constraint treats a
      // null trade as distinct and `on conflict` alone can create duplicates.
      await query(
        `insert into opportunity_subs (opportunity_id, subcontractor_id, trade, outreach_state)
         select $1,$2,$3,'pending'
          where not exists (
            select 1 from opportunity_subs
             where opportunity_id=$1 and subcontractor_id=$2
               and removed_at is null
               and coalesce(trade, '') = coalesce($3::text, '')
          )`,
        [comm.opportunity_id, subId, osRow?.trade ?? comm.trade ?? null]
      );
      pairTrades = await query<{ trade: string | null }>(
        `select distinct trade from opportunity_subs
          where opportunity_id=$1 and subcontractor_id=$2 and removed_at is null`,
        [comm.opportunity_id, subId]
      );
      if (!osRow && pairTrades.length === 1) osRow = pairTrades[0];
      linkedPair = osRow != null;
    }
  }

  const holdForReview = (reason: string): ReplyDecision => ({
    outcome: "unclear",
    proposed:
      readingDecision.outcome === "unclear"
        ? readingDecision.proposed
        : readingDecision.outcome,
    act: false,
    needsReview: true,
    reviewReason: readingDecision.reviewReason
      ? `${readingDecision.reviewReason} ${reason}`
      : reason,
  });
  let decision = readingDecision;
  if (!linkedPair) {
    decision = holdForReview(
      "This subcontractor is no longer active on that opportunity, so the reply was saved but no workflow status was changed."
    );
  } else if (!strongMatch && input.attributionConfirmed !== true) {
    decision = holdForReview(
      "The message matched only by sender address, not by a conversation identifier. Confirm which solicitation it answers."
    );
  } else if (!senderVerified) {
    decision = holdForReview(
      "The sender address differs from the contact that received the request. Confirm who sent it before applying the answer."
    );
  }

  const meta = {
    intent: extracted.intent,
    method: extracted.method,
    canPerform: extracted.canPerform,
    capabilityNotes: extracted.capabilityNotes,
    tradesMentioned: extracted.tradesMentioned,
    isQuote: extracted.isQuote,
    quoteAmount: extracted.quoteAmount,
    /*
     * The envelope, kept alongside the reading of it.
     *
     * The row recorded who we thought wrote and what we thought they meant,
     * and dropped the message itself: no recipients, no sent time, no
     * filenames. So a disputed quote could not be traced back to the email it
     * came from, and a thread with a second contact copied in looked like a
     * private exchange. It costs nothing to keep, and it is the difference
     * between a record and an opinion.
     */
    envelope: {
      from: input.fromAddress ?? fromEmail,
      to: input.toAddresses ?? null,
      cc: input.ccAddresses ?? null,
      sentAt: input.sentAt ?? null,
      subject: input.subject ?? null,
      attachments: input.attachmentNames ?? [],
    },
  };

  // Record the inbound reply and mark the outbound as replied. The partial
  // unique index (migration 022) makes this race-safe under concurrent
  // webhook retries.
  const inbound = await queryOne<{ id: string }>(
    `insert into communications (org_id, subcontractor_id, opportunity_id, channel, direction, subject, body, gmail_thread_id, gmail_message_id, rfc822_message_id, recipient_email, replied_at, meta)
     values ($9,$1,$2,'email','inbound',$3,$4,$5,$6,$7,$8, now(), $10::jsonb)
     on conflict (org_id, gmail_message_id)
       where direction = 'inbound' and gmail_message_id is not null and org_id is not null
     do nothing
     returning id`,
    [
      subId,
      comm.opportunity_id,
      // The real subject, not a placeholder. "Re: outreach" was written on
      // every inbound row alike, so the conversation view could not tell one
      // solicitation's thread from another's at a glance.
      (input.subject ?? "").trim() || "Re: outreach",
      replyText.slice(0, 20_000),
      input.threadId ?? null,
      input.messageId ?? null,
      // Stored so OUR next message in this conversation can cite theirs, and
      // so a later reply naming it can be matched straight back here.
      input.rfc822MessageId ?? null,
      input.fromAddress ?? fromEmail,
      orgId,
      JSON.stringify(meta),
    ]
  );
  // The pre-read above makes ordinary retries cheap; RETURNING is what makes
  // concurrent webhook and poller deliveries safe. Only the transaction that
  // won the unique insert may update status, save a quote, or send a closeout.
  if (!inbound) {
    return {
      subId: comm.subcontractor_id,
      companyName: comm.company_name,
      extracted: emptyExtracted(),
      decision: {
        outcome: "none",
        proposed: null,
        act: false,
        needsReview: false,
        reviewReason: null,
      },
      quoteSaved: false,
      quoteSkippedExisting: false,
      senderVerified: false,
      trade: null,
      duplicate: true,
      declined: false,
      thankYouSent: false,
    };
  }
  await query(`update communications set replied_at = now()
                where id::text=$1 and org_id=$2 and opportunity_id=$3`,
    [comm.id, orgId, comm.opportunity_id]);

  // Closing a sub out ends their involvement in this solicitation and emails
  // them a thank-you, which cannot be recalled. It needs an understood reply,
  // not just a recognised sender.
  const autoDecline =
    decision.act &&
    strongMatch &&
    !!subId &&
    shouldAutoDecline({
      senderVerified,
      intent: extracted.intent,
    });

  if (autoDecline && subId) {
    const capabilityNotes = [
      extracted.capabilityNotes,
      extracted.notes,
      extracted.tradesMentioned.length
        ? `Trades mentioned: ${extracted.tradesMentioned.join(", ")}`
        : null,
    ]
      .filter(Boolean)
      .join(" ");

    const close = await closeOut({
      orgId,
      opportunityId: comm.opportunity_id,
      subcontractorId: subId,
      trade: osRow?.trade ?? null,
      source: "email_reply",
      capabilityNotes: capabilityNotes || null,
      sendThankYou: true,
      recipientEmail: fromEmail,
      threadId: input.rfc822MessageId ? input.threadId ?? null : null,
      inReplyTo: input.rfc822MessageId ?? null,
      references: input.references ?? [],
      originalSubject: input.subject ?? null,
    });

    return {
      subId,
      companyName,
      extracted,
      decision,
      quoteSaved: false,
      quoteSkippedExisting: false,
      senderVerified,
      trade: osRow?.trade ?? null,
      duplicate: false,
      declined: true,
      thankYouSent: close.thankYouSent,
    };
  }

  if (subId && decision.act && strongMatch && senderVerified) {
    await query(
      `update opportunity_subs set outreach_state='responsive', responded_at=now()
        where opportunity_id=$1 and subcontractor_id=$2 and removed_at is null
          and ($3::text is null or coalesce(trade, '') = coalesce($3, ''))`,
      [comm.opportunity_id, subId, osRow?.trade ?? null]
    );
  }

  // Auto-capture the quote only under the full safety rules: strong
  // correlation AND sender ownership AND AI-confirmed price AND no existing
  // quote for this (opportunity, sub, trade) — never overwrite automatically.
  // The unique index (migration 021) makes the insert race-safe.
  let quoteSaved = false;
  let quoteSkippedExisting = false;
  const autoSaveOk =
    decision.act &&
    shouldAutoSaveQuote({
      threadMatched: strongMatch,
      senderVerified,
      isQuote: extracted.isQuote,
      quoteAmount: extracted.quoteAmount,
    });
  /*
   * The proposal, and the reasons it can be refused.
   *
   * This used to insert straight into `quotes` with whatever trade happened to
   * be resolved, and `osRow` is null when a subcontractor is paired to several
   * trades and the reply names none of them. So a firm on electrical and low
   * voltage answering one email with one number had that number filed under no
   * trade at all, where coverage could not see it and the bid could not use
   * it. Worse, on a re-poll with a different correlation it could land under
   * the wrong one, and a plumbing price filed as electrical is more dangerous
   * than no price, because nothing on any screen says it is wrong.
   */
  const replyWrittenAt = input.sentAt ? new Date(input.sentAt) : new Date();
  const proposal = proposeRow(extracted, {
    trade: osRow?.trade ?? null,
    pairedTrades: pairTrades.map((p) => p.trade ?? "").filter(Boolean),
    // Their Date header, not our poll time: "good for 30 days" is counted
    // from when they wrote it.
    receivedAt: Number.isNaN(replyWrittenAt.getTime()) ? new Date() : replyWrittenAt,
  });

  if (autoSaveOk && subId && extracted.quoteAmount != null && proposal.ok) {
    const trade = proposal.row.trade;
    const notes = ["Auto-captured from email reply.", extracted.notes ?? ""]
      .filter(Boolean)
      .join(" ");
    const inserted = await queryOne<{ id: string }>(
      `insert into quotes (org_id, opportunity_id, subcontractor_id, trade, quote_amount, payment_terms, notes)
       values ($7,$1,$2,$3,$4,$5,$6)
       on conflict (opportunity_id, subcontractor_id, (coalesce(trade,''))) do nothing
       returning id`,
      [
        comm.opportunity_id,
        subId,
        trade,
        extracted.quoteAmount,
        extracted.paymentTerms,
        notes,
        orgId,
      ]
    );
    quoteSaved = inserted != null;
    quoteSkippedExisting = inserted == null;
    /*
     * When their price arrived, and whether it covered what was asked for.
     *
     * Stamped on the pairing rather than on the quote, because that is where
     * the date they were given lives, and lateness is the subtraction of the
     * two. Their Date header rather than our poll time: a reply written on
     * Friday and collected on Monday was not late.
     *
     * The scope judgement here is the extractor's, and it is a real
     * determination rather than a guess: `partial_scope` is a refusal the
     * pipeline raises by name when a reply prices only part of the work.
     * Absence of that refusal on a saved quote is the affirmative reading.
     */
    if (quoteSaved) {
      await query(
        `update opportunity_subs
            set quoted_at = coalesce(quoted_at, $4::timestamptz),
                quote_full_scope = coalesce(quote_full_scope, true)
          where opportunity_id = $1 and subcontractor_id = $2
            and coalesce(trade,'') = coalesce($3,'')`,
        [comm.opportunity_id, subId, trade, replyWrittenAt]
      );
    }
    if (quoteSaved) {
      /*
       * Everything the reply actually said, kept as fields rather than prose.
       *
       * The `notes` column above is where all of this used to go: what they
       * excluded, how firm the number is, how long it holds, how soon they can
       * start. An estimator reading a paragraph has to re-derive every one of
       * those, and the bid has no way to act on any of them.
       *
       * `onlyIfAbsent` because a person's row always wins. An automatic read
       * of an email must never overwrite a figure somebody typed.
       */
      await saveProposedRow({
        orgId,
        opportunityId: comm.opportunity_id,
        subcontractorId: subId,
        sourceQuoteId: inserted!.id,
        proposal: proposal.row,
        onlyIfAbsent: true,
      }).catch(() => undefined);
      // Keep detail / Coverage / Next Step in sync with manual quote entry.
      await query(
        `update opportunities
           set stage='quote_entry', human_action_required=false, updated_at=now()
         where id=$1 and stage in ('outreach','call_queue')`,
        [comm.opportunity_id]
      );
      await enqueue("bid-builder", { opportunityId: comm.opportunity_id }).catch(
        () => undefined
      );
    }
  }

  /*
   * A refusal is a fact, and it goes where somebody will see it.
   *
   * The dangerous case is `ambiguous_trade`: a real price, correctly read,
   * that cannot be filed because the subcontractor is on several trades and
   * the reply named none. Nothing is written and that is right, but silence
   * would mean the operator finds out at bid time that a trade they thought
   * was quoted is empty.
   */
  /*
   * A reply that prices only part of the trade is a fact about the firm, and
   * one of the six things the reliability score is made of. Recorded even
   * though no quote was saved: the refusal is the finding.
   */
  if (subId && !proposal.ok && proposal.refusal === "partial_scope") {
    await query(
      `update opportunity_subs
          set quote_full_scope = false
        where opportunity_id = $1 and subcontractor_id = $2`,
      [comm.opportunity_id, subId]
    );
  }

  if (autoSaveOk && !proposal.ok && !quoteSaved) {
    await logAgent({
      agent: "reply-capture",
      action: "quote-not-filed",
      opportunityId: comm.opportunity_id,
      level: "warn",
      message: `${companyName ?? fromEmail} sent a price that was not filed: ${proposal.message}`,
      reasoning:
        proposal.refusal === "ambiguous_trade"
          ? "Filing it under a guessed trade is worse than not filing it, because a wrong trade is invisible and a missing one is not."
          : "Recorded rather than acted on, so the price is not lost and the bid is not built on a reading nobody checked.",
    }).catch(() => undefined);
  }

  return {
    subId,
    companyName,
    extracted,
    decision,
    quoteSaved,
    quoteSkippedExisting,
    senderVerified,
    trade: osRow?.trade ?? null,
    quoteRefusal: proposal.ok ? null : proposal.refusal,
    duplicate: false,
    declined: false,
    thankYouSent: false,
  };
}
