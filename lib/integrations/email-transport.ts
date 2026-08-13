/**
 * Unified outreach email transport. Gmail when connected (keeps threading +
 * reply detection); otherwise Resend (sends from the configured outreach
 * address, e.g. info@brostco.com). Fails loudly when neither is available so
 * outreach is never silently dropped.
 *
 * Reply reading is Gmail-only: Resend can send but cannot read an inbox, so
 * automatic reply detection / price capture still requires Gmail.
 */
import { gmail } from "./gmail";
import { email as resend } from "./resend";
import { config } from "../config";
import { normalizeAttachmentMeta } from "../domain/attachment-meta";
import {
  findEmailSafetyIssues,
  describeEmailSafetyIssues,
} from "../domain/email-safety";

/**
 * Canonical sub-facing sender identity — hardcoded so outreach is always
 * consistent regardless of RESEND_OUTREACH_FROM or the connected Gmail account.
 * Every email a subcontractor receives must come from (and be replyable to)
 * this address.
 */
export const OUTREACH_SENDER = "BROSTCO <info@brostco.com>";
export const OUTREACH_EMAIL  = "info@brostco.com";

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
  /** Our tracking id; injects the open pixel + wraps links for either provider. */
  trackingId?: string;
  // NOTE: From and Reply-To are intentionally absent from this interface.
  // The transport layer always locks them to the configured outreach sender
  // (RESEND_OUTREACH_FROM, default "BROSTCO <info@brostco.com>") so every
  // sub-facing email is consistent and callers cannot accidentally override them.
  attachments?: OutreachAttachment[];
}

export type OutreachProvider = "gmail" | "resend";

export interface OutreachSendResult {
  provider: OutreachProvider | null;
  /** True when no transport is available (neither Gmail nor Resend). */
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
  /** Gmail-only; Resend has no thread concept. */
  threadId?: string | null;
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
export async function outreachTransport(): Promise<OutreachProvider | null> {
  if (await gmail.isConnected()) return "gmail";
  if (config.resend.enabled) return "resend";
  return null;
}

/**
 * Send an outreach email through the active transport.
 * Gmail keeps its own tracking injection (buildRaw); the Resend path injects
 * tracking here before handing off.
 */
export async function sendOutreachEmail(
  params: OutreachSendParams
): Promise<OutreachSendResult> {
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

  const { isAutomationPaused, AUTOMATION_PAUSED_ERROR } = await import("../app-settings");
  if (await isAutomationPaused()) {
    return { provider: null, disabled: true, error: AUTOMATION_PAUSED_ERROR };
  }

  const provider = await outreachTransport();
  if (!provider) {
    return {
      provider: null,
      disabled: true,
      error:
        "No email transport available: connect Gmail or set RESEND_API_KEY to send outreach.",
    };
  }

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

  if (provider === "gmail") {
    // OUTREACH_SENDER / OUTREACH_EMAIL are module-level constants — they do not
    // read from config so From and Reply-To are the same regardless of which
    // Gmail account is OAuth-connected or what RESEND_OUTREACH_FROM is set to.
    const res = await gmail.send({
      to: params.to,
      subject: params.subject,
      html: params.html,
      text: params.text,
      trackingId: params.trackingId,
      from: OUTREACH_SENDER,
      replyTo: OUTREACH_EMAIL,
      attachments,
    });
    if (res.disabled) return { provider: null, disabled: true, error: "Gmail became unavailable." };
    return {
      provider,
      error: res.error,
      messageId: res.messageId ?? null,
      threadId: res.threadId ?? null,
    };
  }

  const html = params.trackingId ? injectTracking(params.html, params.trackingId) : params.html;
  // From is locked to OUTREACH_SENDER. Reply-To is OUTREACH_EMAIL so subs see
  // and reply to info@brostco.com. Inbound replies arriving at info@brostco.com
  // are correlated by sender email (weak match); Gmail threading is the strong
  // match path when Gmail is the active transport.
  const res = await resend.send({
    to: params.to,
    subject: params.subject,
    html,
    text: params.text,
    from: OUTREACH_SENDER,
    replyTo: OUTREACH_EMAIL,
    attachments: attachments.map((a) => ({
      filename: a.filename,
      content: a.content,
      // Required for openability when the filename is ambiguous; Resend
      // otherwise derives type only from the extension.
      contentType: a.mime,
    })),
  });
  if (res.disabled) return { provider: null, disabled: true, error: "Resend became unavailable." };
  return { provider, error: res.error, messageId: res.id ?? null, threadId: null };
}
