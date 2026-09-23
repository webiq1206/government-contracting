import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { config } from "../config";
import { escapeHtml } from "./email-shell";
import { singleMailbox } from "./email-mime";

type Recipient = { orgId: string; email: string };

function tokenKey(secret: string): Buffer {
  return createHash("sha256").update("brostco-marketing-opt-out-v1\0" + secret).digest();
}

/** Opaque, authenticated tokens disclose neither the recipient nor tenant ID. */
export function createOptOutToken(recipient: Recipient): string {
  if (config.auth.secretIsDefault) throw new Error("Configure AUTH_SECRET before sending marketing email.");
  if (!recipient.orgId || !singleMailbox(recipient.email)) throw new Error("A valid opt-out recipient is required.");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", tokenKey(config.auth.secret), iv);
  const body = Buffer.concat([cipher.update(JSON.stringify({ orgId: recipient.orgId, email: recipient.email.trim().toLowerCase() }), "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64url");
}

export function readOptOutToken(token: string): Recipient | null {
  if (config.auth.secretIsDefault || token.length > 2048 || !/^[A-Za-z0-9_-]+$/.test(token)) return null;
  const data = Buffer.from(token, "base64url");
  if (data.length < 29) return null;
  // Rotation must preserve links already delivered to recipients.
  const secrets = [...new Set([config.auth.secret, process.env.AUTH_SECRET_PREVIOUS, process.env.SESSION_SECRET])].filter((secret): secret is string => Boolean(secret) && secret !== "dev-insecure-secret-change-me");
  for (const secret of secrets) {
    try {
      const cipher = createDecipheriv("aes-256-gcm", tokenKey(secret), data.subarray(0, 12));
      cipher.setAuthTag(data.subarray(12, 28));
      const value = JSON.parse(Buffer.concat([cipher.update(data.subarray(28)), cipher.final()]).toString("utf8"));
      if (typeof value.orgId === "string" && value.orgId.length > 0 && value.orgId.length <= 100 && typeof value.email === "string" && value.email.length <= 320 && singleMailbox(value.email)) {
        return { orgId: value.orgId, email: value.email };
      }
    } catch { /* Invalid or signed with another key. */ }
  }
  return null;
}

export function marketingMessage(input: Recipient & { text: string; html: string }) {
  const base = new URL(config.appUrl);
  if (base.protocol !== "https:" || base.username || base.password) throw new Error("Configure a public HTTPS APP_URL before sending marketing email.");
  const unsubscribeUrl = new URL(`/api/email/unsubscribe/${createOptOutToken(input)}`, base).href;
  return {
    unsubscribeUrl,
    text: `${input.text}\n\nTo stop outreach from this sender: ${unsubscribeUrl}`,
    html: `${input.html}<p style="font-size:12px;color:#555"><a href="${escapeHtml(unsubscribeUrl)}">Stop outreach from this sender</a></p>`,
  };
}
