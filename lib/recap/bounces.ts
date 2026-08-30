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
  /** The poll itself failed. Not the same as finding nothing. */
  error: string | null;
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

  const res = await gmail
    .fetchReplies(since, LEGACY_ORG_ID)
    .catch((err) => ({ error: (err as Error).message, replies: [] as never[] }));

  if ("disabled" in res && res.disabled) {
    return { scanned: 0, matched: 0, error: null };
  }
  if (res.error) {
    return { scanned: 0, matched: 0, error: res.error };
  }

  let matched = 0;
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

    const delivery = await recentDeliveryTo(address).catch(() => null);
    if (!delivery) continue;

    await markBounced(
      delivery.id,
      [report.status, report.reason || msg.subject].filter(Boolean).join(" ").slice(0, 500)
    ).catch(() => undefined);
    matched += 1;
  }

  return { scanned: res.replies.length, matched, error: null };
}
