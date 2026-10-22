/**
 * Settle scheduled sends whose outcome was never written.
 *
 * Runs inside the hold sweep. It reads the connected mailbox's Sent folder
 * for each attempting or unknown scheduled send past its lease and records
 * what it finds: a message that left becomes `sent` with its ids, so the
 * follow-up and reply matching work as if the send had settled normally; a
 * message that is absent or cannot be checked remains uncertain. A bounded
 * search cannot authorize a retry. This process never sends anything.
 */
import { query, queryOne } from "./db";
import { gmail } from "./integrations/gmail";
import { runWithOrg } from "./tenant-context";
import { MAIL_CLAIM_TTL_MS } from "./domain/hold-registry";
import {
  UNCERTAIN_MAIL_CONFIRMED_DETAIL,
  reconcileUncertainMail,
  type SentLookup,
} from "./domain/mail-reconcile";

/** Look back a little before the stamped attempt: clocks are not shared with Google. */
const LOOKBACK_MS = 5 * 60_000;
const BATCH = 25;

interface UncertainSend {
  id: string;
  org_id: string;
  recipient_email: string | null;
  subject: string | null;
  delivery_state: string;
  kind: string;
  attempted_at: Date;
}

export interface MailReconcileResult {
  confirmedSent: number;
  releasedForRetry: number;
  leftUnresolved: number;
}

export async function reconcileUncertainScheduledMail(limit = BATCH): Promise<MailReconcileResult> {
  const result: MailReconcileResult = { confirmedSent: 0, releasedForRetry: 0, leftUnresolved: 0 };
  const rows = await query<UncertainSend>(
    `select id, org_id, recipient_email, subject, delivery_state,
            coalesce(meta->>'kind', '') as kind,
            coalesce(provider_attempted_at, created_at) as attempted_at
       from communications
      where request_key is not null
        and delivery_state in ('attempting', 'unknown')
        and coalesce(provider_attempted_at, created_at) <= clock_timestamp() - ($1::bigint * interval '1 millisecond')
      order by coalesce(provider_attempted_at, created_at) asc
      limit $2`,
    [MAIL_CLAIM_TTL_MS, limit]
  );
  for (const row of rows) {
    const outcome = await reconcileOne(row).catch((error) => {
      console.error(
        `[mail-reconcile] communication ${row.id} was left as is: ${error instanceof Error ? error.message : String(error)}`
      );
      return "leave" as const;
    });
    if (outcome === "record_sent") result.confirmedSent++;
    else result.leftUnresolved++;
  }
  return result;
}

async function reconcileOne(row: UncertainSend): Promise<"record_sent" | "leave"> {
  return runWithOrg(row.org_id, async () => {
    let lookup: SentLookup = "unavailable";
    let found: { messageId: string; threadId: string | null; rfc822MessageId: string | null } | null = null;
    if (row.recipient_email && row.subject) {
      const after = Math.floor((new Date(row.attempted_at).getTime() - LOOKBACK_MS) / 1000);
      const answer = await gmail.findSentMessage(row.org_id, {
        to: row.recipient_email,
        subject: row.subject,
        afterEpochSec: after,
        intentId:row.id,
      });
      lookup = answer.status === "found" ? "found" : answer.status === "not_found" ? "not_found" : "unavailable";
      if (answer.status === "found") found = answer;
    } else {
      // Missing correlation is unknown, never evidence that no send occurred.
      lookup = "unavailable";
    }
    const decision = reconcileUncertainMail({ deliveryState: row.delivery_state, kind: row.kind, lookup });
    if (decision === "record_sent" && found) {
      const followUpAt = await followUpFor(row.kind, new Date(row.attempted_at));
      await queryOne(
        `update communications
            set delivery_state = 'sent',
                provider = 'gmail',
                gmail_message_id = $3,
                gmail_thread_id = coalesce($4, gmail_thread_id),
                rfc822_message_id = coalesce($5, rfc822_message_id),
                provider_accepted_at = coalesce(provider_attempted_at, created_at),
                follow_up_at = $6::timestamptz,
                delivery_detail = $7,
                delivery_updated_at = clock_timestamp(),
                meta = coalesce(meta, '{}'::jsonb) || jsonb_build_object('sent', true, 'reconciled', 'gmail_sent')
          where id = $1 and org_id = $2 and delivery_state in ('attempting', 'unknown')
          returning id`,
        [row.id, row.org_id, found.messageId, found.threadId, found.rfc822MessageId, followUpAt, UNCERTAIN_MAIL_CONFIRMED_DETAIL]
      );
      return "record_sent";
    }
    return "leave";
  });
}

/** The same chaser the normal send path schedules, from the time it actually left. */
async function followUpFor(kind: string, sentAt: Date): Promise<string | null> {
  if (kind !== "outreach") return null;
  const { getAutomationRules } = await import("./app-settings");
  const rules = await getAutomationRules();
  if (!(rules.followup_max > 0)) return null;
  return new Date(sentAt.getTime() + rules.followup_hours * 3_600_000).toISOString();
}
