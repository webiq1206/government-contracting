/**
 * One operator alert for a provider outage or a pursue stall.
 *
 * Email goes to DIGEST_EMAIL_TO. When that address is unset, the same
 * alert goes to hello@brostco.com. It does not fall back to SMS.
 */
import { config } from "./config";
import { systemMail } from "./integrations/system-mail";
import { operatorAlertEmail } from "./domain/report-emails";

const FALLBACK_DIGEST = "hello@brostco.com";

export async function deliverOutageAlert(input: {
  subject: string;
  text: string;
  /** Banner tone. Inferred from the subject when omitted. */
  tone?: "critical" | "warning" | "good";
}): Promise<"email" | "unconfigured"> {
  const to = config.systemMail.digestTo?.trim() || FALLBACK_DIGEST;
  // An alert that cannot be laid out still goes out, as plain text. The
  // layout is presentation; the alert is the point.
  let email: { subject: string; html?: string; text: string };
  try {
    email = operatorAlertEmail(config.appUrl, input);
  } catch (error) {
    console.error("[outage-alert] layout failed; sending plain text:", error instanceof Error ? error.message : error);
    email = { subject: input.subject, text: input.text };
  }
  const result = await systemMail.send({ to, subject: email.subject, html: email.html, text: email.text });
  if (result.disabled || result.error) return "unconfigured";
  return "email";
}
