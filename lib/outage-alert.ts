/**
 * One operator alert for a provider outage.
 *
 * Email to the deployment digest address is the operator mail channel.
 * When that address is not configured, the same alert goes to the account's
 * SMS alert number. Exactly one channel is attempted.
 */
import { config } from "./config";
import { systemMail } from "./integrations/system-mail";
import { sms } from "./integrations/twilio";

export async function deliverOutageAlert(input: {
  subject: string;
  text: string;
}): Promise<"email" | "sms" | "unconfigured"> {
  const to = config.systemMail.digestTo?.trim();
  if (to) {
    const result = await systemMail.send({ to, subject: input.subject, text: input.text });
    if (result.disabled || result.error) return "unconfigured";
    return "email";
  }
  const alert = await sms.alert(`${input.subject}. ${input.text}`);
  if (alert.disabled || alert.error) return "unconfigured";
  return "sms";
}
