/**
 * Sending for approved backlink outreach. This is the ONLY place a backlink
 * email is actually transmitted, and it refuses to send anything that has not
 * been approved by a human (approval_status = 'approved'). Reuses the app's
 * Gmail integration, so mail goes from the operator's own connected account and
 * nothing is sent when Gmail is not connected.
 */
import { randomUUID } from "crypto";
import { query, queryOne } from "./db";
import { gmail } from "./integrations/gmail";
import { currentImpersonator } from "./impersonation";
import { logAgent } from "./logger";

export type SendOutcome =
  | { status: "sent"; messageId: string | null }
  | { status: "skipped"; reason: string }
  | { status: "error"; reason: string };

const FOLLOW_UP_DAYS = 5;

/**
 * Nothing leaves this module during a support session.
 *
 * This is the second outbound-mail sink in the application, and it sends to
 * strangers from the operator's own Gmail account. The guarantee that an
 * administrator signed in as a customer cannot mail anybody on that customer's
 * behalf has to hold at every sink, not just the outreach one, or it is not a
 * guarantee. Returns null outside a request scope, so the worker's scheduled
 * sending is untouched.
 */
async function blockedBySupportSession(): Promise<SendOutcome | null> {
  const admin = await currentImpersonator();
  if (!admin) return null;
  return { status: "skipped", reason: "blocked during a support session" };
}

/** Send one approved outreach draft. No-op (skip) unless it is approved, unsent, and has a recipient. */
export async function sendApprovedOutreach(outreachId: string): Promise<SendOutcome> {
  const blocked = await blockedBySupportSession();
  if (blocked) return blocked;

  const row = await queryOne<{
    id: string;
    prospect_id: string;
    subject: string | null;
    body: string | null;
    approval_status: string;
    sent_at: string | null;
    contact_email: string | null;
    domain: string;
  }>(
    `select o.id, o.prospect_id, o.subject, o.body, o.approval_status, o.sent_at,
            p.contact_email, p.domain
       from backlink_outreach o join backlink_prospects p on p.id = o.prospect_id
      where o.id = $1`,
    [outreachId]
  );
  if (!row) return { status: "skipped", reason: "not found" };
  if (row.approval_status !== "approved") return { status: "skipped", reason: "not approved" };
  if (row.sent_at) return { status: "skipped", reason: "already sent" };
  if (!row.contact_email) return { status: "skipped", reason: "no contact email yet" };

  if (!(await gmail.isConnected())) {
    return { status: "skipped", reason: "Gmail not connected" };
  }

  const trackingId = randomUUID();
  const plain = row.body ?? "";
  const html = plain.replace(/\n/g, "<br>");
  const res = await gmail.send({
    to: row.contact_email,
    subject: row.subject ?? "Hello",
    html,
    text: plain,
    trackingId,
  });

  if (res.disabled) return { status: "skipped", reason: "Gmail not connected" };
  if (res.error) {
    await query(`update backlink_outreach set send_error = $2, updated_at = now() where id = $1`, [
      row.id,
      res.error,
    ]);
    await logAgent({
      agent: "backlink-scout",
      action: "outreach-send",
      level: "error",
      status: "error",
      message: `Failed to send backlink outreach to ${row.domain}: ${res.error}`,
    });
    return { status: "error", reason: res.error };
  }

  const followUpAt = new Date(Date.now() + FOLLOW_UP_DAYS * 86_400_000).toISOString();
  await query(
    `update backlink_outreach
        set sent_at = now(), gmail_message_id = $2, gmail_thread_id = $3,
            tracking_id = $4, follow_up_at = $5, send_error = null, updated_at = now()
      where id = $1`,
    [row.id, res.messageId ?? null, res.threadId ?? null, trackingId, followUpAt]
  );
  await query(`update backlink_prospects set status = 'in_outreach', updated_at = now() where id = $1`, [
    row.prospect_id,
  ]);
  await logAgent({
    agent: "backlink-scout",
    action: "outreach-send",
    level: "success",
    message: `Sent backlink outreach to ${row.contact_email} (${row.domain}).`,
  });
  return { status: "sent", messageId: res.messageId ?? null };
}

/**
 * Batch: send any approved-but-unsent outreach that now has a contact email
 * (e.g. the email was discovered after approval). Bounded per run.
 */
export async function sendPendingApproved(limit = 25): Promise<{ sent: number; skipped: number; errors: number }> {
  const rows = await query<{ id: string }>(
    `select o.id from backlink_outreach o join backlink_prospects p on p.id = o.prospect_id
      where o.approval_status = 'approved' and o.sent_at is null and p.contact_email is not null
      order by o.updated_at asc limit $1`,
    [limit]
  );
  let sent = 0,
    skipped = 0,
    errors = 0;
  for (const r of rows) {
    const out = await sendApprovedOutreach(r.id);
    if (out.status === "sent") sent++;
    else if (out.status === "error") errors++;
    else skipped++;
  }
  return { sent, skipped, errors };
}

/**
 * Send one polite follow-up for approved outreach that was sent, is now past its
 * follow_up_at, hasn't had a follow-up yet, and hasn't received a reply.
 */
export async function sendFollowUps(limit = 25): Promise<{ sent: number }> {
  const rows = await query<{
    id: string;
    subject: string | null;
    body: string | null;
    gmail_thread_id: string | null;
    contact_email: string | null;
    domain: string;
    tracking_id: string | null;
  }>(
    `select o.id, o.subject, o.body, o.gmail_thread_id, o.tracking_id, p.contact_email, p.domain
       from backlink_outreach o join backlink_prospects p on p.id = o.prospect_id
      where o.approval_status = 'approved' and o.sent_at is not null
        and o.replied_at is null and o.follow_up_sent = false
        and o.follow_up_at is not null and o.follow_up_at < now()
        and p.contact_email is not null
      order by o.follow_up_at asc limit $1`,
    [limit]
  );
  if (!rows.length || (await blockedBySupportSession())) return { sent: 0 };
  if (!(await gmail.isConnected())) return { sent: 0 };
  let sent = 0;
  for (const r of rows) {
    const body = `Hi,\n\nJust following up on my note below in case it slipped through. No worries if now isn't a good time.\n\n${r.body ?? ""}`;
    const res = await gmail.send({
      to: r.contact_email!,
      subject: `Re: ${r.subject ?? "Following up"}`,
      html: body.replace(/\n/g, "<br>"),
      text: body,
      trackingId: r.tracking_id ?? undefined,
    });
    if (!res.error && !res.disabled) {
      sent++;
      await query(`update backlink_outreach set follow_up_sent = true, updated_at = now() where id = $1`, [
        r.id,
      ]);
    }
  }
  if (sent > 0) {
    await logAgent({
      agent: "backlink-scout",
      action: "outreach-followup",
      message: `Sent ${sent} backlink outreach follow-up(s).`,
    });
  }
  return { sent };
}
