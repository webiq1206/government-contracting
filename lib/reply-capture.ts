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
import { enqueue } from "./queue";

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
  fromEmail: string;
  replyText: string;
  threadId?: string | null;
  messageId?: string | null;
  /** Injectable for tests; defaults to the Claude extractor. */
  extract?: typeof extractReplyFromReply;
  /** Injectable for tests; defaults to closeOutDeclinedSub. */
  closeOut?: typeof closeOutDeclinedSub;
}

export interface CaptureReplyResult {
  subId: string | null;
  companyName: string | null;
  extracted: ExtractedReply;
  quoteSaved: boolean;
  quoteSkippedExisting: boolean;
  senderVerified: boolean;
  trade: string | null;
  /** True when this provider message id was already captured (webhook retry / re-poll); no side effects were repeated. */
  duplicate: boolean;
  /** True when decline / can't-fulfill was applied (callers must skip call-prep). */
  declined: boolean;
  thankYouSent: boolean;
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
    exclusions: [],
    qualifications: [],
    leadTimeDays: null,
    availabilityNotes: null,
    quoteValidUntil: null,
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
  fromEmail: string;
}): Promise<{ comm: MatchedComm | null; strongMatch: boolean }> {
  const select = `select c.id, c.subcontractor_id, c.opportunity_id,
            s.company_name, s.email as sub_email, o.title as opportunity_title,
            (c.meta->>'trade') as trade
       from communications c
       left join subcontractors s on s.id = c.subcontractor_id
       join opportunities o on o.id = c.opportunity_id
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
  if (opts.threadId) {
    const comm = await queryOne<MatchedComm>(
      `${select}
        and c.gmail_thread_id = $2 and c.direction='outbound' and c.replied_at is null
        order by c.created_at desc limit 1`,
      [opts.orgId, opts.threadId]
    );
    if (comm) return { comm, strongMatch: true };
  }
  const comm = await queryOne<MatchedComm>(
    `${select}
      and lower(s.email) = $2 and c.direction='outbound' and c.replied_at is null
      order by c.created_at desc limit 1`,
    [opts.orgId, normalizeEmail(opts.fromEmail)]
  );
  return { comm, strongMatch: false };
}

export async function captureReply(input: CaptureReplyInput): Promise<CaptureReplyResult> {
  const { orgId, comm, strongMatch, fromEmail, replyText } = input;
  const extract = input.extract ?? extractReplyFromReply;
  const closeOut = input.closeOut ?? closeOutDeclinedSub;

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
  const osRow = comm.subcontractor_id
    ? await queryOne<{ trade: string | null }>(
        `select trade from opportunity_subs where opportunity_id=$1 and subcontractor_id=$2 limit 1`,
        [comm.opportunity_id, comm.subcontractor_id]
      )
    : null;

  const extracted = await extract(replyText, {
    opportunityTitle: comm.opportunity_title,
    trade: osRow?.trade ?? null,
  });

  // Resolve the subcontractor. Sender ownership: the reply must come from the
  // mailbox of the sub the outreach was addressed to; when the comm had no
  // linked sub, resolving/creating from the sender's own address is
  // verification by definition.
  let subId = comm.subcontractor_id;
  let companyName = comm.company_name;
  let senderVerified = senderMatchesSub(fromEmail, comm.sub_email);
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
        await query(`update communications set subcontractor_id=$2 where id=$1`, [
          comm.id,
          subId,
        ]);
        await query(
          `insert into opportunity_subs (opportunity_id, subcontractor_id, trade, outreach_state)
           values ($1,$2,$3,'responsive')
           on conflict do nothing`,
          [comm.opportunity_id, subId, osRow?.trade ?? null]
        );
      }
    }
  }

  const meta = {
    intent: extracted.intent,
    method: extracted.method,
    canPerform: extracted.canPerform,
    capabilityNotes: extracted.capabilityNotes,
    tradesMentioned: extracted.tradesMentioned,
    isQuote: extracted.isQuote,
    quoteAmount: extracted.quoteAmount,
  };

  // Record the inbound reply and mark the outbound as replied. The partial
  // unique index (migration 022) makes this race-safe under concurrent
  // webhook retries.
  await query(
    `insert into communications (org_id, subcontractor_id, opportunity_id, channel, direction, subject, body, gmail_thread_id, gmail_message_id, replied_at, meta)
     values ($8,$1,$2,'email','inbound',$3,$4,$5,$6, now(), $7::jsonb)
     on conflict do nothing`,
    [
      subId,
      comm.opportunity_id,
      "Re: outreach",
      replyText.slice(0, 20_000),
      input.threadId ?? null,
      input.messageId ?? null,
      JSON.stringify(meta),
      orgId,
    ]
  );
  await query(`update communications set replied_at = now() where id = $1`, [comm.id]);

  const autoDecline =
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
      opportunityId: comm.opportunity_id,
      subcontractorId: subId,
      trade: osRow?.trade ?? null,
      source: "email_reply",
      capabilityNotes: capabilityNotes || null,
      sendThankYou: true,
    });

    return {
      subId,
      companyName,
      extracted,
      quoteSaved: false,
      quoteSkippedExisting: false,
      senderVerified,
      trade: osRow?.trade ?? null,
      duplicate: false,
      declined: true,
      thankYouSent: close.thankYouSent,
    };
  }

  if (subId) {
    await query(
      `update opportunity_subs set outreach_state='responsive', responded_at=now()
        where opportunity_id=$1 and subcontractor_id=$2`,
      [comm.opportunity_id, subId]
    );
  }

  // Auto-capture the quote only under the full safety rules: strong
  // correlation AND sender ownership AND AI-confirmed price AND no existing
  // quote for this (opportunity, sub, trade) — never overwrite automatically.
  // The unique index (migration 021) makes the insert race-safe.
  let quoteSaved = false;
  let quoteSkippedExisting = false;
  const autoSaveOk = shouldAutoSaveQuote({
    threadMatched: strongMatch,
    senderVerified,
    isQuote: extracted.isQuote,
    quoteAmount: extracted.quoteAmount,
  });
  if (autoSaveOk && subId && extracted.quoteAmount != null) {
    const trade = osRow?.trade ?? null;
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
    if (quoteSaved) {
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

  return {
    subId,
    companyName,
    extracted,
    quoteSaved,
    quoteSkippedExisting,
    senderVerified,
    trade: osRow?.trade ?? null,
    duplicate: false,
    declined: false,
    thankYouSent: false,
  };
}
