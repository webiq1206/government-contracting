/**
 * Soft-close a sub on a solicitation after they decline or cannot fulfill.
 * Sets outreach_state=declined, skips pending call cards, records capability
 * notes, and optionally sends a short thank-you email (no follow-up).
 */
import { query, queryOne } from "../db";
import { logAgent } from "../logger";
import { scrubGovtContacts } from "../integrations/scrub-contacts";
import {
  sendOutreachEmail,
  type OutreachSendResult,
} from "../integrations/email-transport";

export type DeclineCloseoutSource = "email_reply" | "call_workspace";

export interface DeclineThankYouInput {
  firstName?: string | null;
  companyName?: string | null;
  opportunityTitle?: string | null;
  trade?: string | null;
}

export interface DeclineThankYouEmail {
  subject: string;
  text: string;
  html: string;
}

/** Short first-person thank-you; no em dashes. */
export function buildDeclineThankYouEmail(
  input: DeclineThankYouInput
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
  const tradeClean = scrubGovtContacts((input.trade ?? "").trim()).sanitised.trim();
  const tradeBit = tradeClean ? ` (${tradeClean})` : "";

  const subject = `Thank you, ${title}`;
  const text = [
    `Hi ${greeting},`,
    "",
    `Thank you for getting back to us about ${title}${tradeBit}. We appreciate you taking the time to respond.`,
    "",
    "We will close out this request on our side and keep your note on file for future fits.",
    "",
    "Best regards,",
    "BROSTCO",
  ].join("\n");

  const html = text
    .split("\n")
    .map((line) => (line ? `<p style="margin:0 0 12px">${escapeHtml(line)}</p>` : "<br/>"))
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
  opportunityId: string;
  subcontractorId: string;
  trade?: string | null;
  source: DeclineCloseoutSource;
  capabilityNotes?: string | null;
  sendThankYou: boolean;
  /** Injectable for tests; defaults to sendOutreachEmail. */
  sendEmail?: (params: {
    to: string;
    subject: string;
    html: string;
    text?: string;
  }) => Promise<OutreachSendResult>;
}

export interface CloseOutDeclinedSubResult {
  thankYouSent: boolean;
  alreadyThanked: boolean;
}

export async function closeOutDeclinedSub(
  input: CloseOutDeclinedSubInput
): Promise<CloseOutDeclinedSubResult> {
  const {
    opportunityId,
    subcontractorId,
    trade = null,
    source,
    capabilityNotes,
    sendThankYou,
  } = input;
  const sendEmail = input.sendEmail ?? sendOutreachEmail;

  await query(
    `update opportunity_subs
        set outreach_state='declined', responded_at=now()
      where opportunity_id=$1 and subcontractor_id=$2
        and ($3::text is null or trade = $3)`,
    [opportunityId, subcontractorId, trade]
  );

  const skipReason = source === "email_reply" ? "email_declined" : "call_declined";
  await query(
    `update call_cards
        set status='skipped',
            response_json = coalesce(response_json, '{}'::jsonb)
              || jsonb_build_object('skip_reason', $3::text)
      where opportunity_id=$1 and subcontractor_id=$2 and status='pending'`,
    [opportunityId, subcontractorId, skipReason]
  );

  if (capabilityNotes && capabilityNotes.trim()) {
    const stamp = new Date().toISOString().slice(0, 10);
    const line = `[${stamp}] Reply capability (${source}): ${capabilityNotes.trim()}`;
    await query(
      `update subcontractors
          set notes = case
            when notes is null or notes = '' then $2
            else notes || E'\n\n' || $2
          end
        where id=$1`,
      [subcontractorId, line]
    );
  }

  let thankYouSent = false;
  let alreadyThanked = false;

  if (sendThankYou) {
    const prior = await queryOne<{ id: string }>(
      `select id from communications
        where opportunity_id=$1 and subcontractor_id=$2
          and direction='outbound'
          and meta->>'kind' = 'decline_thank_you'
        limit 1`,
      [opportunityId, subcontractorId]
    );
    if (prior) {
      alreadyThanked = true;
    } else {
      const sub = await queryOne<{
        email: string | null;
        owner_name: string | null;
        company_name: string | null;
      }>(
        `select email, owner_name, company_name from subcontractors where id=$1`,
        [subcontractorId]
      );
      const opp = await queryOne<{ title: string | null }>(
        `select title from opportunities where id=$1`,
        [opportunityId]
      );
      const to = (sub?.email ?? "").trim();
      if (to) {
        const firstName = (() => {
          const raw = (sub?.owner_name ?? "").trim();
          if (!raw) return "there";
          return raw.split(/\s+/)[0] || "there";
        })();
        const mail = buildDeclineThankYouEmail({
          firstName,
          companyName: sub?.company_name,
          opportunityTitle: opp?.title,
          trade,
        });
        const res = await sendEmail({
          to,
          subject: mail.subject,
          html: mail.html,
          text: mail.text,
        });
        if (!res.error && !res.disabled) {
          thankYouSent = true;
          await query(
            `insert into communications
               (subcontractor_id, opportunity_id, channel, direction, subject, body,
                gmail_message_id, gmail_thread_id, provider, recipient_email, meta)
             values ($1,$2,'email','outbound',$3,$4,$5,$6,$7,$8,$9::jsonb)`,
            [
              subcontractorId,
              opportunityId,
              mail.subject,
              mail.text,
              res.messageId ?? null,
              res.threadId ?? null,
              res.provider,
              to,
              JSON.stringify({ kind: "decline_thank_you", source }),
            ]
          );
        }
      }
    }
  }

  await logAgent({
    agent: source === "email_reply" ? "reply-poll" : "operator",
    action: "reply-declined",
    opportunityId,
    subcontractorId,
    level: "success",
    message: thankYouSent
      ? `Sub declined / cannot fulfill. Closed out on this solicitation and sent a thank-you email.`
      : alreadyThanked
        ? `Sub declined / cannot fulfill. Closed out on this solicitation (thank-you already sent).`
        : `Sub declined / cannot fulfill. Closed out on this solicitation.${sendThankYou ? " Thank-you email was not sent." : ""}`,
    reasoning: capabilityNotes?.trim() || undefined,
  });

  return { thankYouSent, alreadyThanked };
}
