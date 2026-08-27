/**
 * Outreach email transport. Gmail only.
 *
 * Every tenant connects their own inbox, and all of their subcontractor email
 * is sent from it. That keeps sending, threading, reply detection, and
 * conversation history in one place: the mailbox we send from is the mailbox
 * we sync, so a reply is a real Gmail thread rather than something we have to
 * correlate by guesswork.
 *
 * Fails loudly when no inbox is connected, so outreach is never silently
 * dropped and never goes out as somebody else.
 */
import { gmail } from "./gmail";
import { config } from "../config";
import { normalizeAttachmentMeta } from "../domain/attachment-meta";
import {
  findEmailSafetyIssues,
  describeEmailSafetyIssues,
} from "../domain/email-safety";
import { resolveOutreachSender } from "../domain/sender-identity";
import { pursuitStatus } from "../pursuit-guard";
import { tryResolveTenantOrgId } from "../tenant";

/**
 * Last-resort identity, used only when tenant lookup is impossible (a script
 * with no org context). Real per-tenant identity comes from the connected
 * inbox via resolveOutreachSender(); these constants exist so a send can never
 * end up with a blank From header.
 */
export const OUTREACH_SENDER = "BROSTCO <info@brostco.com>";
export const OUTREACH_EMAIL = "info@brostco.com";

export interface OutreachAttachment {
  filename: string;
  content: Buffer;
  mime?: string;
}

export interface OutreachSendParams {
  to: string;
  subject: string;
  html: string;
  text?: string;
  /** Our tracking id; injects the open pixel + wraps links. */
  trackingId?: string;
  // NOTE: From and Reply-To are intentionally absent. The transport locks them
  // to the tenant's connected inbox so callers cannot send as another account.
  attachments?: OutreachAttachment[];
  /** Reply inside an existing Gmail thread instead of starting a new one. */
  threadId?: string;
  inReplyTo?: string;
  /** The conversation's full Message-ID chain, so a third message still threads. */
  references?: string[];
  /** Which tenant is sending. Defaults to the ambient org context. */
  orgId?: string;
  /**
   * The opportunity this message is about, when it is about one.
   *
   * Re-read here, immediately before the provider call, rather than trusted
   * from whenever the job started. A follow-up can spend minutes assembling
   * its packet, and that is long enough for somebody to press Abort while
   * watching the email they did not want go out anyway.
   *
   * Optional because not every outbound message belongs to a pursuit: a
   * digest, a password reset, an invitation. Absent means there is nothing to
   * check, not that the check passed.
   */
  opportunityId?: string;
  /**
   * The subcontractor being written to, when it is one.
   *
   * Carried so this transport can ask whether outreach to them has been
   * stopped. Absent means there is nobody to check, not that the check
   * passed: an operator who stops outreach for a firm and then watches the
   * follow-up go out anyway has learned that the control is decoration.
   */
  subcontractorId?: string;
  /** The trade this message is about, so a trade-scoped stop can apply. */
  trade?: string | null;
}

export type OutreachProvider = "gmail";

export interface OutreachSendResult {
  provider: OutreachProvider | null;
  /** True when no inbox is connected. */
  disabled?: boolean;
  /**
   * True when the email was refused by the pre-send safety check because the
   * rendered copy would have looked broken to the recipient. Distinct from
   * `disabled` (no transport) and from a provider `error` (delivery failed):
   * nothing was attempted, and the fix is to the content, not the connection.
   */
  blocked?: boolean;
  error?: string;
  messageId?: string | null;
  threadId?: string | null;
  /**
   * The RFC822 Message-ID of what we just sent. Stored so a later follow-up
   * can set In-Reply-To/References and thread on the RECIPIENT's side, not
   * just in our own mailbox.
   */
  rfc822MessageId?: string | null;
}

/** Inject the open pixel and wrap links through the click tracker. */
export function injectTracking(html: string, trackingId: string): string {
  const base = config.appUrl.replace(/\/$/, "");
  const pixel = `<img src="${base}/api/track/open/${trackingId}" width="1" height="1" style="display:none" alt="" />`;
  let out = html.replace(
    /href="(https?:\/\/[^"]+)"/g,
    (_m, url) => `href="${base}/api/track/click/${trackingId}?u=${encodeURIComponent(url)}"`
  );
  out = out.includes("</body>") ? out.replace("</body>", `${pixel}</body>`) : out + pixel;
  return out;
}

/** Which transport would be used for the next outreach send, or null. */
export async function outreachTransport(
  orgId?: string
): Promise<OutreachProvider | null> {
  return (await gmail.isConnected(orgId)) ? "gmail" : null;
}

/** Send an outreach email through the tenant's connected inbox. */
export async function sendOutreachEmail(
  params: OutreachSendParams
): Promise<OutreachSendResult> {
  /*
   * The last possible moment to find out this pursuit was stopped.
   *
   * Ahead of content safety and everything else, because the cheapest refusal
   * is the one that happens before any work. The agent runner already checked
   * when the job started; this is the check that catches an abort committed
   * while the job was assembling attachments.
   *
   * Fails closed by construction: pursuitStatus returns mayAct false when it
   * cannot read the row at all.
   */
  if (params.opportunityId) {
    const pursuit = await pursuitStatus(params.opportunityId);
    if (!pursuit.mayAct) {
      return { provider: null, disabled: true, error: pursuit.reason ?? "This pursuit is stopped." };
    }
  }

  // Content safety runs before anything else, so no configuration or transport
  // state can bypass it. An email that is never sent is recoverable; one that
  // reaches a subcontractor with a hole in it is not.
  const safetyIssues = findEmailSafetyIssues({
    subject: params.subject,
    text: params.text,
    html: params.html,
  });
  if (safetyIssues.length > 0) {
    return {
      provider: null,
      blocked: true,
      error: describeEmailSafetyIssues(safetyIssues),
    };
  }

  /**
   * Do-not-contact, at the one place every send passes through.
   *
   * Someone who asked to be taken off the list was closed out on that
   * solicitation and then emailed again as soon as the next one matched their
   * trade. Mail after an opt-out is what generates spam complaints, and
   * complaints are what move the whole sending domain into the spam folder
   * for every tenant at once -- so this is a deliverability control as much
   * as a courtesy. Checked here rather than at the seven call sites, because
   * the one that gets forgotten is the one that does the damage.
   */
  const suppressionOrg = params.orgId ?? (await tryResolveTenantOrgId().catch(() => null));
  if (suppressionOrg && params.to) {
    const { isSuppressed } = await import("../domain/email-suppression");
    if (await isSuppressed(suppressionOrg, params.to)) {
      return {
        provider: null,
        blocked: true,
        error: `${params.to} asked not to be contacted, so nothing was sent.`,
      };
    }
  }

  /*
   * The operator's own stop, asked at the moment of sending.
   *
   * Separate from the do-not-contact list above, and deliberately so. That one
   * is the subcontractor's decision, is keyed on an address, and is
   * account-wide. This one is the operator's, is keyed on the relationship,
   * and can be as narrow as one trade on one bid.
   *
   * Asked here rather than when the job was queued, because a follow-up
   * enqueued on Monday and running on Wednesday has to see Tuesday's decision.
   * A failure to read is treated as a stop: the moment the check cannot run is
   * exactly the moment it is least safe to send.
   */
  if (suppressionOrg && params.subcontractorId) {
    const { suppressionBlocking } = await import("../suppressions");
    const { describeSuppression } = await import("../domain/suppression");
    let stopped: Awaited<ReturnType<typeof suppressionBlocking>> | "unreadable";
    try {
      stopped = await suppressionBlocking(
        {
          subcontractorId: params.subcontractorId,
          opportunityId: params.opportunityId ?? null,
          trade: params.trade ?? null,
          channel: "email",
        },
        suppressionOrg
      );
    } catch {
      stopped = "unreadable";
    }
    if (stopped === "unreadable") {
      return {
        provider: null,
        blocked: true,
        error:
          "Whether outreach to this subcontractor has been stopped could not be established, so nothing was sent.",
      };
    }
    if (stopped) {
      return { provider: null, blocked: true, error: describeSuppression(stopped) };
    }
  }

  // Note: the block on sending real email from a development process lives in
  // the Gmail transport itself, not here, so that system mail and backlink
  // outreach inherit it too.

  // Nothing leaves the building while an admin is signed in as this customer.
  // A support session exists to see what the customer sees; a message sent
  // from it lands in a real subcontractor's inbox, over the customer's name,
  // and cannot be recalled. The check sits here, at the one choke point every
  // sending path already funnels through, so a future agent or route inherits
  // it instead of having to remember it.
  //
  // Background sends are unaffected: the worker has no session, so this reads
  // as "nobody is impersonating", which is the right answer for the
  // customer's own scheduled automation.
  const { currentImpersonator } = await import("../impersonation");
  const impersonator = await currentImpersonator();
  if (impersonator) {
    return {
      provider: null,
      blocked: true,
      error:
        "Blocked: this is a support session. Outreach is not sent while an administrator is signed in as this account.",
    };
  }

  const { isAutomationStopped, AUTOMATION_PAUSED_ERROR } = await import("../app-settings");
  if (await isAutomationStopped()) {
    return { provider: null, disabled: true, error: AUTOMATION_PAUSED_ERROR };
  }

  const orgId = params.orgId ?? (await tryResolveTenantOrgId());

  // The trial's outreach meter. Every path that emails a subcontractor goes
  // through this function, which is why the check lives here rather than in
  // each agent: a new sending code path inherits the limit instead of
  // quietly bypassing it. Reported as `disabled` so callers already handle
  // it the same way they handle a paused or unconnected transport, and the
  // message is the one the operator sees.
  const { checkTrialQuota } = await import("../billing/trial-limits");
  const quota = await checkTrialQuota(orgId, "outreach_emails");
  if (!quota.allowed) {
    return { provider: null, disabled: true, error: quota.message };
  }

  if (!(await gmail.isConnected(orgId ?? undefined))) {
    return {
      provider: null,
      disabled: true,
      error:
        "No inbox connected. Open Settings and click Connect Google Inbox to send outreach.",
    };
  }

  // Identity comes from the connected mailbox. If that row is unreadable while
  // the connection is live, fall back to the platform address rather than
  // sending with a blank From.
  const sender = orgId
    ? await resolveOutreachSender(orgId)
    : { from: OUTREACH_SENDER, replyTo: OUTREACH_EMAIL, connected: true };
  const { LEGACY_ORG_ID } = await import("../tenant-context");
  if (sender.unknown && orgId !== LEGACY_ORG_ID) {
    // The identity lookup failed for a NON-founding tenant. gmail.isConnected
    // passed a moment ago, so the send could go out, but only under the
    // platform's From header, and the sub's reply would then land where this
    // tenant's poller never looks. A held email is recoverable; one sent as
    // somebody else is not. The founding org is exempt: the platform address
    // IS its identity, so the fallback below is correct there.
    return {
      provider: null,
      error:
        "Could not resolve this account's sender identity (temporary database error). The email was held rather than sent from the wrong address; it will be retried.",
    };
  }
  const from = sender.connected && sender.from ? sender.from : OUTREACH_SENDER;
  const replyTo = sender.connected && sender.replyTo ? sender.replyTo : OUTREACH_EMAIL;

  const attachments = (params.attachments ?? [])
    .filter((a) => a.content?.length)
    .map((a) => {
      const meta = normalizeAttachmentMeta({
        filename: a.filename,
        mime: a.mime,
        content: a.content,
      });
      return { filename: meta.filename, content: a.content, mime: meta.mime };
    });

  const res = await gmail.send({
    to: params.to,
    subject: params.subject,
    html: params.html,
    text: params.text,
    trackingId: params.trackingId,
    from,
    replyTo,
    attachments,
    threadId: params.threadId,
    inReplyTo: params.inReplyTo,
    references: params.references,
    orgId: orgId ?? undefined,
  });

  if (res.disabled) {
    return { provider: null, disabled: true, error: "Gmail became unavailable." };
  }
  return {
    provider: "gmail",
    error: res.error,
    messageId: res.messageId ?? null,
    threadId: res.threadId ?? null,
    rfc822MessageId: res.rfc822MessageId ?? null,
  };
}
