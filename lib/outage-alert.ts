/**
 * One operator alert for a provider outage or a pursue stall.
 *
 * Email goes to DIGEST_EMAIL_TO. When that address is unset, the same
 * alert goes to hello@brostco.com. It does not fall back to SMS.
 */
import { config } from "./config";
import { systemMail } from "./integrations/system-mail";

const FALLBACK_DIGEST = "hello@brostco.com";

export async function deliverOutageAlert(input: {
  subject: string;
  text: string;
}): Promise<"email" | "unconfigured"> {
  const to = config.systemMail.digestTo?.trim() || FALLBACK_DIGEST;
  const result = await systemMail.send({ to, subject: input.subject, text: input.text });
  if (result.disabled || result.error) return "unconfigured";
  return "email";
}
