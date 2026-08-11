/**
 * Resend email client, transactional sends + the daily digest. Requires
 * RESEND_API_KEY. When missing, methods return { disabled: true } and log a
 * single skip warning instead of throwing, so the platform boots without email
 * configured.
 */
import { config } from "../config";
import { Resend } from "resend";

export interface EmailResult {
  disabled?: boolean;
  id?: string;
  error?: string;
}

export const email = {
  enabled: () => config.resend.enabled,

  /** Send an email to one or more recipients. */
  async send(params: {
    to: string | string[];
    subject: string;
    html: string;
    text?: string;
    /** Override the From address (e.g. the outreach sender). */
    from?: string;
    replyTo?: string;
    attachments?: { filename: string; content: Buffer }[];
  }): Promise<EmailResult> {
    const { isAutomationPaused, AUTOMATION_PAUSED_ERROR } = await import("../app-settings");
    if (await isAutomationPaused()) {
      console.warn("[resend] Automation paused, skipping send");
      return { disabled: true, error: AUTOMATION_PAUSED_ERROR };
    }
    if (!config.resend.enabled) {
      console.warn("[resend] Email not configured, skipping send");
      return { disabled: true };
    }
    try {
      const client = new Resend(config.resend.apiKey);
      const { data, error } = await client.emails.send({
        from: params.from ?? config.resend.from,
        to: params.to,
        subject: params.subject,
        html: params.html,
        text: params.text ?? "",
        ...(params.replyTo ? { replyTo: params.replyTo } : {}),
        ...(params.attachments?.length
          ? {
              attachments: params.attachments.map((a) => ({
                filename: a.filename,
                content: a.content,
              })),
            }
          : {}),
      });
      if (error) return { error: error.message };
      return { id: data?.id };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  },

  /**
   * Fetch a received (inbound) email's content by id. The `email.received`
   * webhook carries metadata only; the body must be retrieved separately.
   * Tries the receiving endpoint first, then the generic email endpoint.
   */
  async getReceived(
    emailId: string
  ): Promise<{ text?: string; html?: string; from?: string; to?: string[]; error?: string }> {
    if (!config.resend.enabled) return { error: "Resend not configured" };
    const headers = { Authorization: `Bearer ${config.resend.apiKey}` };
    for (const path of [`/emails/receiving/${emailId}`, `/emails/${emailId}`]) {
      try {
        const res = await fetch(`https://api.resend.com${path}`, { headers });
        if (!res.ok) continue;
        const data: any = await res.json();
        const from = typeof data.from === "string" ? data.from : data.from?.email;
        const to = Array.isArray(data.to)
          ? data.to.map((t: any) => (typeof t === "string" ? t : t?.email ?? ""))
          : undefined;
        return { text: data.text ?? undefined, html: data.html ?? undefined, from, to };
      } catch {
        /* try next endpoint */
      }
    }
    return { error: `could not fetch received email ${emailId}` };
  },

  /** Send the operator digest to the configured DIGEST_EMAIL_TO address. */
  async sendDigest(params: {
    subject: string;
    html: string;
    text?: string;
  }): Promise<EmailResult> {
    if (!config.resend.enabled) {
      console.warn("[resend] Email not configured, skipping digest");
      return { disabled: true };
    }
    if (!config.resend.digestTo) {
      console.warn("[resend] DIGEST_EMAIL_TO not set, skipping digest");
      return { disabled: true };
    }
    return this.send({
      to: config.resend.digestTo,
      subject: params.subject,
      html: params.html,
      text: params.text,
    });
  },
};
