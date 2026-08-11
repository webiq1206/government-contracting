/**
 * Shared inbound-reply capture pipeline, used by both the Gmail reply poller
 * (lib/agents/maintenance.ts) and the Resend inbound webhook
 * (app/api/webhooks/resend-inbound). Given an already-matched outbound
 * communication, it resolves/creates the subcontractor, records the inbound
 * communication, marks responsiveness, and auto-saves the quote only under
 * the safety rules in lib/reply-matching.ts.
 */
import { query, queryOne } from "./db";
import { extractQuoteFromReply, type ExtractedQuote } from "./ai/quote-extract";
import { senderMatchesSub, shouldAutoSaveQuote, normalizeEmail } from "./reply-matching";

export interface MatchedComm {
  id: string;
  subcontractor_id: string | null;
  opportunity_id: string;
  company_name: string | null;
  sub_email: string | null;
  opportunity_title: string | null;
}

export interface CaptureReplyInput {
  comm: MatchedComm;
  /** Reply correlated reliably (Gmail thread id or Resend plus-address token). */
  strongMatch: boolean;
  fromEmail: string;
  replyText: string;
  threadId?: string | null;
  messageId?: string | null;
  /** Injectable for tests; defaults to the Claude extractor. */
  extract?: typeof extractQuoteFromReply;
}

export interface CaptureReplyResult {
  subId: string | null;
  companyName: string | null;
  extracted: ExtractedQuote;
  quoteSaved: boolean;
  quoteSkippedExisting: boolean;
  senderVerified: boolean;
  trade: string | null;
  /** True when this provider message id was already captured (webhook retry / re-poll); no side effects were repeated. */
  duplicate: boolean;
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

/** Find the outbound communication a reply belongs to (strong then weak match). */
export async function matchInboundReply(opts: {
  /** Plus-address tracking token extracted from the To/recipient list. Strong match. */
  trackingToken?: string | null;
  /** Gmail thread ID. Strong match (Gmail transport only). */
  threadId?: string | null;
  fromEmail: string;
}): Promise<{ comm: MatchedComm | null; strongMatch: boolean }> {
  const select = `select c.id, c.subcontractor_id, c.opportunity_id,
            s.company_name, s.email as sub_email, o.title as opportunity_title
       from communications c
       left join subcontractors s on s.id = c.subcontractor_id
       join opportunities o on o.id = c.opportunity_id`;
  if (opts.trackingToken) {
    const comm = await queryOne<MatchedComm>(
      `${select}
        where c.tracking_id = $1 and c.direction='outbound'
        order by c.created_at desc limit 1`,
      [opts.trackingToken]
    );
    if (comm) return { comm, strongMatch: true };
  }
  if (opts.threadId) {
    const comm = await queryOne<MatchedComm>(
      `${select}
        where c.gmail_thread_id = $1 and c.direction='outbound' and c.replied_at is null
        order by c.created_at desc limit 1`,
      [opts.threadId]
    );
    if (comm) return { comm, strongMatch: true };
  }
  const comm = await queryOne<MatchedComm>(
    `${select}
      where lower(s.email) = $1 and c.direction='outbound' and c.replied_at is null
      order by c.created_at desc limit 1`,
    [normalizeEmail(opts.fromEmail)]
  );
  return { comm, strongMatch: false };
}

export async function captureReply(input: CaptureReplyInput): Promise<CaptureReplyResult> {
  const { comm, strongMatch, fromEmail, replyText } = input;
  const extract = input.extract ?? extractQuoteFromReply;

  // Idempotency: webhook providers retry deliveries and the Gmail poller
  // re-scans a sliding window. If this provider message id was already
  // captured, skip all side effects (the unique index from migration 022
  // also guards the insert against races).
  if (input.messageId) {
    const existing = await queryOne<{ id: string; subcontractor_id: string | null }>(
      `select id, subcontractor_id from communications
        where direction='inbound' and gmail_message_id = $1 limit 1`,
      [input.messageId]
    );
    if (existing) {
      return {
        subId: existing.subcontractor_id ?? comm.subcontractor_id,
        companyName: comm.company_name,
        extracted: {
          isQuote: false,
          quoteAmount: null,
          paymentTerms: null,
          notes: null,
          companyName: null,
          method: "regex",
        } as ExtractedQuote,
        quoteSaved: false,
        quoteSkippedExisting: false,
        senderVerified: false,
        trade: null,
        duplicate: true,
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
    const bySender = await queryOne<{ id: string; company_name: string }>(
      `select id, company_name from subcontractors where lower(email) = $1 limit 1`,
      [normalizeEmail(fromEmail)]
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
      const inserted = await queryOne<{ id: string }>(
        `insert into subcontractors (company_name, email, email_verified, trade_categories, notes)
         values ($1, $2, false, $3, 'Auto-created from an email reply to outreach; verify before relying on it.')
         returning id`,
        [name, normalizeEmail(fromEmail), osRow?.trade ? [osRow.trade] : []]
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

  // Record the inbound reply and mark the outbound as replied. The partial
  // unique index (migration 022) makes this race-safe under concurrent
  // webhook retries.
  await query(
    `insert into communications (subcontractor_id, opportunity_id, channel, direction, subject, body, gmail_thread_id, gmail_message_id, replied_at)
     values ($1,$2,'email','inbound',$3,$4,$5,$6, now())
     on conflict do nothing`,
    [
      subId,
      comm.opportunity_id,
      "Re: outreach",
      replyText.slice(0, 20_000),
      input.threadId ?? null,
      input.messageId ?? null,
    ]
  );
  await query(`update communications set replied_at = now() where id = $1`, [comm.id]);
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
      `insert into quotes (opportunity_id, subcontractor_id, trade, quote_amount, payment_terms, notes)
       values ($1,$2,$3,$4,$5,$6)
       on conflict (opportunity_id, subcontractor_id, (coalesce(trade,''))) do nothing
       returning id`,
      [comm.opportunity_id, subId, trade, extracted.quoteAmount, extracted.paymentTerms, notes]
    );
    quoteSaved = inserted != null;
    quoteSkippedExisting = inserted == null;
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
  };
}
