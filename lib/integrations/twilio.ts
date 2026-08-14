/**
 * Twilio SMS client, outbound texts + operator alerts. Requires
 * TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_FROM_NUMBER. When any is
 * missing, methods return { disabled: true } and log a single skip warning
 * instead of throwing, so the platform boots without SMS configured.
 */
import { config } from "../config";
import { orgApiKey } from "../integration-keys";
import twilioSdk from "twilio";

const MAX_LEN = 1500;

function truncate(body: string): string {
  return body.length > MAX_LEN ? body.slice(0, MAX_LEN) : body;
}

export interface SmsResult {
  disabled?: boolean;
  sid?: string;
  error?: string;
}

/**
 * Twilio credentials belong to the customer, not the platform.
 *
 * The FROM number in particular is their phone number: sending a
 * subcontractor an SMS from OUR number would misattribute the message and
 * bill us for it.
 */
async function twilioCreds(): Promise<{ sid: string; token: string; from: string } | null> {
  const [sid, token, from] = await Promise.all([
    orgApiKey("TWILIO_ACCOUNT_SID"),
    orgApiKey("TWILIO_AUTH_TOKEN"),
    orgApiKey("TWILIO_FROM_NUMBER"),
  ]);
  if (!sid || !token || !from) return null;
  return { sid, token, from };
}

export const sms = {
  enabled: async () => (await twilioCreds()) !== null,

  /** Send an SMS to an arbitrary recipient. */
  async send(to: string, body: string): Promise<SmsResult> {
    const { isAutomationPaused, AUTOMATION_PAUSED_ERROR } = await import("../app-settings");
    if (await isAutomationPaused()) {
      console.warn("[twilio] Automation paused, skipping send");
      return { disabled: true, error: AUTOMATION_PAUSED_ERROR };
    }
    const creds = await twilioCreds();
    if (!creds) {
      console.warn("[twilio] SMS not configured for this organization, skipping send");
      return { disabled: true };
    }
    try {
      const client = twilioSdk(creds.sid, creds.token);
      const msg = await client.messages.create({
        from: creds.from,
        to,
        body: truncate(body),
      });
      return { sid: msg.sid };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  },

  /** Send an operator alert to the configured ALERT_SMS_TO number. */
  async alert(body: string): Promise<SmsResult> {
    const creds = await twilioCreds();
    if (!creds) {
      console.warn("[twilio] SMS not configured for this organization, skipping alert");
      return { disabled: true };
    }
    const alertTo = await orgApiKey("ALERT_SMS_TO");
    if (!alertTo) {
      console.warn("[twilio] No alert number set for this organization, skipping alert");
      return { disabled: true };
    }
    return this.send(alertTo, truncate(`[BROSTCO] ${body}`));
  },
};
