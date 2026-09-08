/**
 * Soft-close a sub on a solicitation after they decline or cannot fulfill.
 * Sets outreach_state=declined, skips pending call cards, records capability
 * notes, and optionally sends a short thank-you email (no follow-up).
 */
import type { PoolClient, QueryResultRow } from "pg";
import { query, queryOne } from "../db";
import { logAgent } from "../logger";
import { scrubGovtContacts } from "../integrations/scrub-contacts";
import {
  sendOutreachEmail,
  type OutreachSendResult,
} from "../integrations/email-transport";

export type DeclineCloseoutSource = "email_reply" | "call_workspace";

/**
 * Pairings that are finished. Call Prep must not reopen them, and leftover
 * pending cards must not stay in the Call Queue.
 */
export const CLOSED_OUTREACH_STATES = [
  "declined",
  "not_a_fit",
  "unavailable",
] as const;
export type ClosedOutreachState = (typeof CLOSED_OUTREACH_STATES)[number];

export function isClosedOutreach(
  state: string | null | undefined,
): state is ClosedOutreachState {
  return (
    state != null &&
    (CLOSED_OUTREACH_STATES as readonly string[]).includes(state)
  );
}

export interface DeclineThankYouInput {
  firstName?: string | null;
  companyName?: string | null;
  opportunityTitle?: string | null;
  trade?: string | null;
  /** Who signs, from THIS organization's profile. Never a platform default. */
  senderName?: string | null;
  senderCompany?: string | null;
}

export interface DeclineThankYouEmail {
  subject: string;
  text: string;
  html: string;
}

/** Short first-person thank-you; no em dashes. */
export function buildDeclineThankYouEmail(
  input: DeclineThankYouInput,
): DeclineThankYouEmail {
  const greeting = (() => {
    const raw = (input.firstName ?? "").trim();
    if (!raw) return "there";
    return raw.split(/\s+/)[0] || "there";
  })();
  // Title and trade are solicitation-derived and go straight into copy a
  // subcontractor reads, so government contacts are removed here rather than
  // after assembly (scrubbing the finished email would censor our own details).
  // Scrubbing is a no-op on clean values.
  const title =
    scrubGovtContacts((input.opportunityTitle ?? "").trim()).sanitised.trim() ||
    "the opportunity";
  const tradeClean = scrubGovtContacts(
    (input.trade ?? "").trim(),
  ).sanitised.trim();
  const tradeBit = tradeClean ? ` (${tradeClean})` : "";

  const subject = `Thank you, ${title}`;
  // Sign as the organization that actually sent the outreach. The platform's
  // own name in another customer's email is worse than no signature at all,
  // so an empty profile just ends at "Best regards".
  const signature = [
    (input.senderName ?? "").trim(),
    (input.senderCompany ?? "").trim(),
  ].filter(Boolean);
  const text = [
    `Hi ${greeting},`,
    "",
    `Thank you for getting back to us about ${title}${tradeBit}. We appreciate you taking the time to respond.`,
    "",
    "We will close out this request on our side and keep your note on file for future fits.",
    "",
    "Best regards,",
    ...signature,
  ].join("\n");

  const html = text
    .split("\n")
    .map((line) =>
      line ? `<p style="margin:0 0 12px">${escapeHtml(line)}</p>` : "<br/>",
    )
    .join("");

  return { subject, text, html };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export interface CloseOutDeclinedSubInput {
  orgId?: string | null;
  opportunityId: string;
  subcontractorId: string;
  trade?: string | null;
  source: DeclineCloseoutSource;
  capabilityNotes?: string | null;
  sendThankYou: boolean;
  recipientEmail?: string | null;
  threadId?: string | null;
  inReplyTo?: string | null;
  references?: string[];
  originalSubject?: string | null;
  /** Injectable for tests; defaults to sendOutreachEmail. */
  sendEmail?: (params: {
    to: string;
    subject: string;
    html: string;
    text?: string;
    orgId?: string;
    opportunityId?: string;
    subcontractorId?: string;
    trade?: string | null;
    threadId?: string;
    inReplyTo?: string;
    references?: string[];
  }) => Promise<OutreachSendResult>;
}

export interface CloseOutDeclinedSubResult {
  thankYouSent: boolean;
  alreadyThanked: boolean;
}

export interface CloseOutDeclinedSubExecution {
  /** Use the caller's transaction for every closeout read and write. */
  client?: PoolClient;
  /**
   * Required with a client because an activity write cannot be committed
   * ahead of the transaction it describes. The caller logs after commit.
   */
  deferActivityLog?: boolean;
}

async function closeoutQuery<T extends QueryResultRow>(
  client: PoolClient | undefined,
  text: string,
  params: unknown[],
): Promise<T[]> {
  if (client) return (await client.query<T>(text, params)).rows;
  return query<T>(text, params);
}

async function closeoutQueryOne<T extends QueryResultRow>(
  client: PoolClient | undefined,
  text: string,
  params: unknown[],
): Promise<T | null> {
  if (client) return (await client.query<T>(text, params)).rows[0] ?? null;
  return queryOne<T>(text, params);
}

export async function closeOutDeclinedSub(
  input: CloseOutDeclinedSubInput,
  execution: CloseOutDeclinedSubExecution = {},
): Promise<CloseOutDeclinedSubResult> {
  const {
    opportunityId,
    subcontractorId,
    source,
    capabilityNotes,
    sendThankYou,
  } = input;
  const sendEmail = input.sendEmail ?? sendOutreachEmail;
  if (execution.client && sendThankYou) {
    throw new Error(
      "Email cannot be sent inside a decline closeout transaction.",
    );
  }
  if (execution.client && !execution.deferActivityLog) {
    throw new Error(
      "A transactional decline closeout must defer its activity log until commit.",
    );
  }

  const owner = await closeoutQueryOne<{ org_id: string }>(
    execution.client,
    `select o.org_id
       from opportunities o
       join subcontractors s on s.id = $2 and s.org_id = o.org_id
      where o.id = $1`,
    [opportunityId, subcontractorId],
  );
  if (!owner || (input.orgId && input.orgId !== owner.org_id)) {
    throw new Error(
      "The opportunity and subcontractor do not belong to the same account.",
    );
  }
  const orgId = owner.org_id;

  const activePairs = await closeoutQuery<{ trade: string | null }>(
    execution.client,
    `select distinct os.trade
       from opportunity_subs os
       join opportunities o on o.id = os.opportunity_id and o.org_id = $3
      where os.opportunity_id = $1 and os.subcontractor_id = $2
        and os.removed_at is null`,
    [opportunityId, subcontractorId, orgId],
  );
  const requestedTrade = input.trade?.trim() || null;
  const matchingPairs = requestedTrade
    ? activePairs.filter((pair) => (pair.trade ?? "").trim() === requestedTrade)
    : activePairs;
  if (matchingPairs.length === 0) {
    throw new Error(
      "This subcontractor is no longer active on that opportunity and trade.",
    );
  }
  if (!requestedTrade && matchingPairs.length !== 1) {
    throw new Error(
      "This subcontractor is active for several trades. Choose the trade before closing them out.",
    );
  }
  const trade = requestedTrade ?? matchingPairs[0]!.trade ?? null;

  await closeoutQuery(
    execution.client,
    `update opportunity_subs
        set outreach_state='declined', responded_at=now()
      where opportunity_id=$1 and subcontractor_id=$2
        and removed_at is null
        and coalesce(trade, '') = coalesce($3::text, '')`,
    [opportunityId, subcontractorId, trade],
  );

  const skipReason =
    source === "email_reply" ? "email_declined" : "call_declined";
  await closeoutQuery(
    execution.client,
    `update call_cards
        set status='skipped',
            response_json = coalesce(response_json, '{}'::jsonb)
              || jsonb_build_object('skip_reason', $3::text)
      where opportunity_id=$1 and subcontractor_id=$2
        and org_id=$4 and status='pending'`,
    [opportunityId, subcontractorId, skipReason, orgId],
  );

  if (capabilityNotes && capabilityNotes.trim()) {
    const stamp = new Date().toISOString().slice(0, 10);
    const line = `[${stamp}] Reply capability (${source}): ${capabilityNotes.trim()}`;
    await closeoutQuery(
      execution.client,
      `update subcontractors
          set notes = case
            when notes is null or notes = '' then $2
            else notes || E'\n\n' || $2
          end
        where id=$1 and org_id=$3`,
      [subcontractorId, line, orgId],
    );
  }

  let thankYouSent = false;
  let alreadyThanked = false;
  let thankYouFailure: string | null = null;

  if (sendThankYou) {
    const prior = await queryOne<{ id: string }>(
      `select id from communications
        where org_id=$3 and opportunity_id=$1 and subcontractor_id=$2
          and direction='outbound'
          and meta->>'kind' = 'decline_thank_you'
        limit 1`,
      [opportunityId, subcontractorId, orgId],
    );
    if (prior) {
      alreadyThanked = true;
    } else {
      const sub = await queryOne<{
        email: string | null;
        owner_name: string | null;
        company_name: string | null;
      }>(
        `select email, owner_name, company_name from subcontractors
          where id=$1 and org_id=$2`,
        [subcontractorId, orgId],
      );
      const opp = await queryOne<{ title: string | null }>(
        `select title from opportunities where id=$1 and org_id=$2`,
        [opportunityId, orgId],
      );
      const to = (input.recipientEmail ?? sub?.email ?? "").trim();
      if (to) {
        const firstName = (() => {
          const raw = (sub?.owner_name ?? "").trim();
          if (!raw) return "there";
          return raw.split(/\s+/)[0] || "there";
        })();
        // The sender identity comes from the tenant's own profile, resolved
        // inside the org context this closeout runs in.
        const { getProfileJson } = await import("../ai/companyProfile");
        const { outreachDisplayName } =
          await import("./solicitation-completeness");
        const profile = await getProfileJson().catch(() => null);
        const mail = buildDeclineThankYouEmail({
          firstName,
          companyName: sub?.company_name,
          opportunityTitle: opp?.title,
          trade,
          senderName: profile ? outreachDisplayName(profile) : null,
          senderCompany: profile?.legal_name ?? null,
        });
        const subject = input.originalSubject?.trim()
          ? `Re: ${input.originalSubject.trim().replace(/^re:\s*/i, "")}`
          : mail.subject;
        const res = await sendEmail({
          to,
          subject,
          html: mail.html,
          text: mail.text,
          orgId,
          opportunityId,
          subcontractorId,
          trade,
          threadId: input.threadId ?? undefined,
          inReplyTo: input.inReplyTo ?? undefined,
          references: input.references ?? [],
        });
        if (!res.error && !res.disabled && !res.blocked) {
          thankYouSent = true;
          await query(
            `insert into communications
               (org_id, subcontractor_id, opportunity_id, channel, direction, subject, body,
                gmail_message_id, gmail_thread_id, rfc822_message_id, provider,
                recipient_email, delivery_state, meta)
             values ($1,$2,$3,'email','outbound',$4,$5,$6,$7,$8,$9,$10,'sent',$11::jsonb)`,
            [
              orgId,
              subcontractorId,
              opportunityId,
              subject,
              mail.text,
              res.messageId ?? null,
              res.threadId ?? input.threadId ?? null,
              res.rfc822MessageId ?? null,
              res.provider,
              to,
              JSON.stringify({
                kind: "decline_thank_you",
                source,
                ...(trade ? { trade } : {}),
                ...(input.inReplyTo ? { in_reply_to: input.inReplyTo } : {}),
              }),
            ],
          );
        } else {
          thankYouFailure = res.error ?? "email delivery is unavailable";
        }
      } else {
        thankYouFailure = "the subcontractor has no email address";
      }
    }
  }

  if (!execution.deferActivityLog) {
    await logAgent({
      agent: source === "email_reply" ? "reply-poll" : "operator",
      action: "reply-declined",
      opportunityId,
      subcontractorId,
      level: thankYouFailure ? "error" : "success",
      ...(thankYouFailure ? { status: "error" as const } : {}),
      message: thankYouSent
        ? `Sub declined / cannot fulfill. Closed out on this solicitation and sent a thank-you email.`
        : alreadyThanked
          ? `Sub declined / cannot fulfill. Closed out on this solicitation (thank-you already sent).`
          : `Sub declined / cannot fulfill. Closed out on this solicitation.${
              sendThankYou
                ? ` Thank-you email was not sent (${thankYouFailure ?? "delivery failed"}); open the conversation to send it after the email issue is corrected.`
                : ""
            }`,
      reasoning: capabilityNotes?.trim() || undefined,
    });
  }

  return { thankYouSent, alreadyThanked };
}
