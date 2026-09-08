/**
 * Recap mail that came back.
 *
 * Outreach bounces are already detected on tenant inboxes; this is the same
 * detection pointed at the platform's own inbox, which is where a recap that
 * cannot be delivered lands. Without it, a recipient whose address stopped
 * working simply stops receiving their morning summary, the history says
 * "sent" every day, and nobody finds out until they mention it.
 *
 * Only recap deliveries are matched here. A bounce for a password reset or any
 * other platform mail is left alone rather than half-attributed, because a
 * wrong attribution is worse than none: it would mark somebody's recap dead on
 * the strength of an unrelated failure.
 */
import { gmail } from "../integrations/gmail";
import { LEGACY_ORG_ID } from "../tenant-context";
import { looksLikeBounce, parseBounce } from "../domain/email-delivery";
import { markBounced, recentDeliveryTo } from "./delivery";

export interface BounceSweepResult {
  scanned: number;
  matched: number;
  /** Permanent delivery reports that could not be tied safely to one recap. */
  unmatched: number;
  /** Matching or persistence operations that failed. Never counted as matched. */
  failed: number;
  /** More Gmail history remains after this run's safety limit. */
  truncated: boolean;
  /** The scan or its history reconciliation failed. Not the same as finding nothing. */
  error: string | null;
}

/** Keep a pathological mailbox backlog from monopolising the worker forever. */
const MAX_BOUNCE_BATCHES = 10;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Scan the platform inbox for bounces and mark the recap they belong to.
 *
 * `lookbackMinutes` is generous relative to how often this runs, because
 * overlapping scans are harmless (a delivery already marked bounced is matched
 * again to the same state) and a gap is not.
 */
export async function sweepRecapBounces(lookbackMinutes = 180): Promise<BounceSweepResult> {
  const since = Math.floor((Date.now() - lookbackMinutes * 60_000) / 1000);
  let scanned = 0;
  let matched = 0;
  let unmatched = 0;
  let failed = 0;
  let pageToken: string | undefined;
  const errors: string[] = [];

  for (let batch = 0; batch < MAX_BOUNCE_BATCHES; batch += 1) {
    const res: Awaited<ReturnType<typeof gmail.fetchReplies>> = await gmail
      .fetchReplies(since, LEGACY_ORG_ID, pageToken ? { pageToken } : {})
      .catch((error) => ({ error: errorMessage(error), replies: [] as never[] }));

    if ("disabled" in res && res.disabled) {
      if (scanned === 0) {
        return { scanned: 0, matched: 0, unmatched: 0, failed: 0, truncated: false, error: null };
      }
      errors.push("The platform inbox became unavailable before the bounce scan finished.");
      return {
        scanned,
        matched,
        unmatched,
        failed,
        truncated: false,
        error: errors.join(" ").slice(0, 1000),
      };
    }
    if (res.error) {
      errors.push(`The platform inbox could not be read: ${res.error}`);
      return {
        scanned,
        matched,
        unmatched,
        failed,
        truncated: false,
        error: errors.join(" ").slice(0, 1000),
      };
    }

    scanned += res.replies.length;
    for (const msg of res.replies) {
      if (
        !looksLikeBounce({
          from: msg.from,
          subject: msg.subject,
          contentType: msg.contentType,
          body: msg.body,
        })
      ) {
        continue;
      }

      const report = parseBounce(msg.body ?? "");
      const address = (report.recipient ?? "").trim();
      if (!address || !address.includes("@")) continue;

      /*
       * Transient failures are left alone. A full mailbox or a greylist retry is
       * not a dead address, and marking it bounced would put a permanent-looking
       * failure in the history for something that fixed itself an hour later.
       */
      if (report.permanent === false) continue;

      let delivery: Awaited<ReturnType<typeof recentDeliveryTo>>;
      try {
        delivery = await recentDeliveryTo(address, 72, report.originalMessageId);
      } catch (error) {
        failed += 1;
        errors.push(`A recap delivery-history lookup failed: ${errorMessage(error)}`);
        continue;
      }
      if (!delivery) {
        unmatched += 1;
        continue;
      }
      // An overlapping scan will see the same DSN again. Recognising the
      // already-recorded row keeps that harmless overlap from becoming a new
      // "unmatched" warning every fifteen minutes.
      if (delivery.status === "bounced") continue;

      try {
        const recorded = await markBounced(
          delivery.id,
          [report.status, report.reason || msg.subject].filter(Boolean).join(" ").slice(0, 500)
        );
        if (!recorded) {
          failed += 1;
          errors.push("A matched recap changed before its bounce could be recorded.");
          continue;
        }
      } catch (error) {
        failed += 1;
        errors.push(`A recap bounce could not be saved to delivery history: ${errorMessage(error)}`);
        continue;
      }
      matched += 1;
    }

    if (!res.truncated) {
      return {
        scanned,
        matched,
        unmatched,
        failed,
        truncated: false,
        error: errors.length > 0 ? errors.join(" ").slice(0, 1000) : null,
      };
    }
    if (!res.nextPageToken) {
      errors.push("Gmail reported more bounce messages but supplied no continuation token.");
      return {
        scanned,
        matched,
        unmatched,
        failed,
        truncated: true,
        error: errors.join(" ").slice(0, 1000),
      };
    }
    pageToken = res.nextPageToken;
  }

  errors.push(
    `The bounce scan stopped after ${MAX_BOUNCE_BATCHES} batches so it would not block other automation; more mailbox history remains.`
  );
  return {
    scanned,
    matched,
    unmatched,
    failed,
    truncated: true,
    error: errors.join(" ").slice(0, 1000),
  };
}
