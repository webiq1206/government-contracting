/**
 * Webhook signing, kept out of the client-safe domain module because it
 * needs node:crypto. Receivers verify with the same recipe:
 *   v1 = HMAC-SHA256(secret, timestamp + "." + body)
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export function signWebhook(secret: string, timestamp: string, body: string): string {
  return createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
}

export function verifyWebhookSignature(secret: string, timestamp: string, body: string, signature: string): boolean {
  const expected = Buffer.from(signWebhook(secret, timestamp, body));
  const given = Buffer.from(signature);
  return expected.length === given.length && timingSafeEqual(expected, given);
}
