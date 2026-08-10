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
import { replyCorrelationAddress } from "../reply-capture";

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
  replyTo?: string;
  attachments?: OutreachAttachment[];
}

export type OutreachProvider = "gmail" | "resend";

export interface OutreachSendResult {
  provider: OutreachProvider | null;
  /** True when no transport is available (neither Gmail nor Resend). */
  disabled?: boolean;
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
  const provider = await outreachTransport();
  if (!provider) {
    return {
      provider: null,
      disabled: true,
      error:
        "No email transport available: connect Gmail or set RESEND_API_KEY to send outreach.",
    };
  }

  if (provider === "gmail") {
    const res = await gmail.send({
      to: params.to,
      subject: params.subject,
      html: params.html,
      text: params.text,
      trackingId: params.trackingId,
      replyTo: params.replyTo,
      attachments: params.attachments,
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
  // Plus-addressed reply-to (info+t<trackingId>@domain) lets the inbound
  // webhook correlate replies exactly with this outbound communication.
  const correlatedReplyTo =
    params.replyTo ??
    (params.trackingId
      ? replyCorrelationAddress(config.resend.outreachFrom, params.trackingId) ?? undefined
      : undefined);
  const res = await resend.send({
    to: params.to,
    subject: params.subject,
    html,
    text: params.text,
    from: config.resend.outreachFrom,
    replyTo: correlatedReplyTo,
    attachments: params.attachments?.map((a) => ({
      filename: a.filename,
      content: a.content,
    })),
  });
  if (res.disabled) return { provider: null, disabled: true, error: "Resend became unavailable." };
  return { provider, error: res.error, messageId: res.id ?? null, threadId: null };
}
