/**
 * Resend email client — transactional sends + the daily digest. Requires
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
  }): Promise<EmailResult> {
    if (!config.resend.enabled) {
      console.warn("[resend] Email not configured — skipping send");
      return { disabled: true };
    }
    try {
      const client = new Resend(config.resend.apiKey);
      const { data, error } = await client.emails.send({
        from: config.resend.from,
        to: params.to,
        subject: params.subject,
        html: params.html,
        text: params.text ?? "",
      });
      if (error) return { error: error.message };
      return { id: data?.id };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  },

  /** Send the operator digest to the configured DIGEST_EMAIL_TO address. */
  async sendDigest(params: {
    subject: string;
    html: string;
    text?: string;
  }): Promise<EmailResult> {
    if (!config.resend.enabled) {
      console.warn("[resend] Email not configured — skipping digest");
      return { disabled: true };
    }
    if (!config.resend.digestTo) {
      console.warn("[resend] DIGEST_EMAIL_TO not set — skipping digest");
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
