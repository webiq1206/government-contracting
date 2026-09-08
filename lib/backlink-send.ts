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
import { resolveOutreachSender } from "./domain/sender-identity";

/**
 * The From / Reply-To pair for this organization, or nothing.
 *
 * Backlink outreach is still outreach: it goes to a stranger, over the
 * company's name, and it has to carry the same address as everything else the
 * company sends. Left unset, Gmail stamps whichever account authorized the
 * connection, which is the exact discrepancy this identity exists to remove.
 *
 * A failure here is a hard stop. Omitting these headers lets Gmail substitute
 * whichever account authorized the connection, which can be a different
 * address from the one the operator reviewed and can strand replies in an
 * inbox the platform does not monitor.
 */
type SenderHeadersResult =
  | { ok: true; headers: { from: string; replyTo: string } }
  | { ok: false; reason: string };

async function senderHeaders(
  orgId: string
): Promise<SenderHeadersResult> {
  let sender: Awaited<ReturnType<typeof resolveOutreachSender>>;
  try {
    sender = await resolveOutreachSender(orgId);
  } catch {
    return {
      ok: false,
      reason:
        "The sender identity could not be checked because the account settings could not be read. No email was sent. Check the Gmail connection and retry.",
    };
  }
  if (sender.unknown) {
    return {
      ok: false,
      reason:
        "The sender identity could not be checked because the account settings could not be read. No email was sent. Check the Gmail connection and retry.",
    };
  }
  if (!sender.connected || !sender.from || !sender.replyTo) {
    return {
      ok: false,
      reason:
        "No verified sender identity is available. No email was sent. Reconnect Gmail or choose a verified sending address, then retry.",
    };
  }
  return { ok: true, headers: { from: sender.from, replyTo: sender.replyTo } };
}

async function recordSendFailure(input: {
  outreachId: string;
  orgId: string;
  domain: string;
  reason: string;
  action: "outreach-send" | "outreach-followup";
}): Promise<void> {
  await query(
    `update backlink_outreach set send_error = $2, updated_at = now()
      where id = $1 and org_id = $3`,
    [input.outreachId, input.reason, input.orgId]
  );
  await logAgent({
    agent: "backlink-scout",
    action: input.action,
    level: "error",
    status: "error",
    message: `Could not send backlink outreach to ${input.domain}: ${input.reason}`,
  });
}

/**
 * The organization whose outreach this is.
 *
 * Every query and every send here names it. Prospects, drafts and the mailbox
 * they go out of all belong to one customer, and unscoped this module sent one
 * customer's approved outreach from another customer's inbox, and listed their
 * prospect domains and message bodies to whoever opened the page.
 */
async function resolveOrgId(orgId?: string): Promise<string> {
  if (orgId) return orgId;
  const { resolveTenantOrgId } = await import("./tenant");
  return resolveTenantOrgId();
}

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
export async function sendApprovedOutreach(
  outreachId: string,
  orgIdOpt?: string
): Promise<SendOutcome> {
  const blocked = await blockedBySupportSession();
  if (blocked) return blocked;
  const orgId = await resolveOrgId(orgIdOpt);

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
       from backlink_outreach o join backlink_prospects p
         on p.id = o.prospect_id and p.org_id = o.org_id
      where o.org_id = $2 and o.id = $1`,
    [outreachId, orgId]
  );
  if (!row) return { status: "skipped", reason: "not found" };
  if (row.approval_status !== "approved") return { status: "skipped", reason: "not approved" };
  if (row.sent_at) return { status: "skipped", reason: "already sent" };
  if (!row.contact_email) return { status: "skipped", reason: "no contact email yet" };

  let connected = false;
  try {
    connected = await gmail.isConnected(orgId);
  } catch {
    const reason =
      "The Gmail connection could not be checked because its settings could not be read. No email was sent. Reload the integration status and retry.";
    await recordSendFailure({
      outreachId: row.id,
      orgId,
      domain: row.domain,
      reason,
      action: "outreach-send",
    });
    return { status: "error", reason };
  }
  if (!connected) {
    return { status: "skipped", reason: "Gmail not connected" };
  }

  const sender = await senderHeaders(orgId);
  if (!sender.ok) {
    await recordSendFailure({
      outreachId: row.id,
      orgId,
      domain: row.domain,
      reason: sender.reason,
      action: "outreach-send",
    });
    return { status: "error", reason: sender.reason };
  }

  const trackingId = randomUUID();
  const plain = row.body ?? "";
  const html = plain.replace(/\n/g, "<br>");
  // Named, not inferred: this decides whose mailbox the outreach leaves from,
  // and which of that mailbox's verified addresses it appears to come from.
  let res: Awaited<ReturnType<typeof gmail.send>>;
  try {
    res = await gmail.send({
      to: row.contact_email,
      subject: row.subject ?? "Hello",
      html,
      text: plain,
      trackingId,
      orgId,
      ...sender.headers,
    });
  } catch (err) {
    console.error("[backlink-send] Gmail send did not return a result:", err);
    const reason =
      "Gmail delivery could not be confirmed. Check the Gmail Sent folder before retrying to avoid a duplicate.";
    await recordSendFailure({
      outreachId: row.id,
      orgId,
      domain: row.domain,
      reason,
      action: "outreach-send",
    });
    return { status: "error", reason };
  }

  if (res.disabled) {
    const reason =
      res.error ??
      "Gmail refused the approved outreach because the connection is unavailable. Reconnect Gmail and retry.";
    await recordSendFailure({
      outreachId: row.id,
      orgId,
      domain: row.domain,
      reason,
      action: "outreach-send",
    });
    return { status: "error", reason };
  }
  if (res.error) {
    await recordSendFailure({
      outreachId: row.id,
      orgId,
      domain: row.domain,
      reason: res.error,
      action: "outreach-send",
    });
    return { status: "error", reason: res.error };
  }

  const followUpAt = new Date(Date.now() + FOLLOW_UP_DAYS * 86_400_000).toISOString();
  await query(
    `update backlink_outreach
        set sent_at = now(), gmail_message_id = $2, gmail_thread_id = $3,
            tracking_id = $4, follow_up_at = $5, send_error = null, updated_at = now()
      where id = $1 and org_id = $6`,
    [row.id, res.messageId ?? null, res.threadId ?? null, trackingId, followUpAt, orgId]
  );
  await query(
    `update backlink_prospects set status = 'in_outreach', updated_at = now()
      where id = $1 and org_id = $2`,
    [row.prospect_id, orgId]
  );
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
export async function sendPendingApproved(
  orgIdOpt?: string,
  limit = 25
): Promise<{ sent: number; skipped: number; errors: number }> {
  const orgId = await resolveOrgId(orgIdOpt);
  const rows = await query<{ id: string }>(
    `select o.id from backlink_outreach o join backlink_prospects p
        on p.id = o.prospect_id and p.org_id = o.org_id
      where o.org_id = $2
        and o.approval_status = 'approved' and o.sent_at is null and p.contact_email is not null
      order by o.updated_at asc limit $1`,
    [limit, orgId]
  );
  let sent = 0,
    skipped = 0,
    errors = 0;
  for (const r of rows) {
    const out = await sendApprovedOutreach(r.id, orgId);
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
export async function sendFollowUps(
  orgIdOpt?: string,
  limit = 25
): Promise<{ sent: number; errors: number }> {
  const orgId = await resolveOrgId(orgIdOpt);
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
       from backlink_outreach o join backlink_prospects p
         on p.id = o.prospect_id and p.org_id = o.org_id
      where o.org_id = $2
        and o.approval_status = 'approved' and o.sent_at is not null
        and o.replied_at is null and o.follow_up_sent = false
        and o.follow_up_at is not null and o.follow_up_at < now()
        and p.contact_email is not null
      order by o.follow_up_at asc limit $1`,
    [limit, orgId]
  );
  if (!rows.length || (await blockedBySupportSession())) return { sent: 0, errors: 0 };
  let connected = false;
  try {
    connected = await gmail.isConnected(orgId);
  } catch {
    const reason =
      "The Gmail connection could not be checked because its settings could not be read. No follow-up was sent. Reload the integration status and retry.";
    for (const row of rows) {
      await recordSendFailure({
        outreachId: row.id,
        orgId,
        domain: row.domain,
        reason,
        action: "outreach-followup",
      });
    }
    return { sent: 0, errors: rows.length };
  }
  if (!connected) return { sent: 0, errors: 0 };
  // Read once for the sweep: a follow-up has to arrive from the same address
  // as the message it is following up on.
  const sender = await senderHeaders(orgId);
  if (!sender.ok) {
    for (const row of rows) {
      await recordSendFailure({
        outreachId: row.id,
        orgId,
        domain: row.domain,
        reason: sender.reason,
        action: "outreach-followup",
      });
    }
    return { sent: 0, errors: rows.length };
  }
  let sent = 0;
  let errors = 0;
  for (const r of rows) {
    const body = `Hi,\n\nJust following up on my note below in case it slipped through. No worries if now isn't a good time.\n\n${r.body ?? ""}`;
    let res: Awaited<ReturnType<typeof gmail.send>>;
    try {
      res = await gmail.send({
        to: r.contact_email!,
        subject: `Re: ${r.subject ?? "Following up"}`,
        html: body.replace(/\n/g, "<br>"),
        text: body,
        trackingId: r.tracking_id ?? undefined,
        orgId,
        ...sender.headers,
      });
    } catch (err) {
      console.error("[backlink-send] Gmail follow-up did not return a result:", err);
      errors++;
      await recordSendFailure({
        outreachId: r.id,
        orgId,
        domain: r.domain,
        reason:
          "Gmail delivery could not be confirmed. Check the Gmail Sent folder before retrying to avoid a duplicate.",
        action: "outreach-followup",
      });
      continue;
    }
    if (!res.error && !res.disabled) {
      sent++;
      await query(
        `update backlink_outreach
            set follow_up_sent = true, send_error = null, updated_at = now()
          where id = $1 and org_id = $2`,
        [r.id, orgId]
      );
    } else {
      errors++;
      await recordSendFailure({
        outreachId: r.id,
        orgId,
        domain: r.domain,
        reason: res.error ?? "Gmail refused the follow-up because the connection is unavailable.",
        action: "outreach-followup",
      });
    }
  }
  if (sent > 0) {
    await logAgent({
      agent: "backlink-scout",
      action: "outreach-followup",
      message: `Sent ${sent} backlink outreach follow-up(s).`,
    });
  }
  return { sent, errors };
}
