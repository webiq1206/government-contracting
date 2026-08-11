/**
 * Twilio SMS client, outbound texts + operator alerts. Requires
 * TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_FROM_NUMBER. When any is
 * missing, methods return { disabled: true } and log a single skip warning
 * instead of throwing, so the platform boots without SMS configured.
 */
import { config } from "../config";
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

export const sms = {
  enabled: () => config.twilio.enabled,

  /** Send an SMS to an arbitrary recipient. */
  async send(to: string, body: string): Promise<SmsResult> {
    const { isAutomationPaused, AUTOMATION_PAUSED_ERROR } = await import("../app-settings");
    if (await isAutomationPaused()) {
      console.warn("[twilio] Automation paused, skipping send");
      return { disabled: true, error: AUTOMATION_PAUSED_ERROR };
    }
    if (!config.twilio.enabled) {
      console.warn("[twilio] SMS not configured, skipping send");
      return { disabled: true };
    }
    try {
      const client = twilioSdk(config.twilio.accountSid, config.twilio.authToken);
      const msg = await client.messages.create({
        from: config.twilio.fromNumber,
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
    if (!config.twilio.enabled) {
      console.warn("[twilio] SMS not configured, skipping alert");
      return { disabled: true };
    }
    if (!config.twilio.alertTo) {
      console.warn("[twilio] ALERT_SMS_TO not set, skipping alert");
      return { disabled: true };
    }
    return this.send(config.twilio.alertTo, truncate(`[BROSTCO] ${body}`));
  },
};
