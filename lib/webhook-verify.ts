/**
 * Svix webhook signature verification (used by Resend webhooks).
 * Kept out of the route module so it can be imported by tests and other
 * handlers (Next.js route files may only export handlers/config).
 */
import { createHmac, timingSafeEqual } from "crypto";

/** Verify a svix signature: HMAC-SHA256(base64secret, "{id}.{timestamp}.{payload}"). */
export function verifySvixSignature(opts: {
  secret: string;
  id: string;
  timestamp: string;
  payload: string;
  signatureHeader: string;
}): boolean {
  const { secret, id, timestamp, payload, signatureHeader } = opts;
  if (!secret || !id || !timestamp || !signatureHeader) return false;
  // Reject stale timestamps (5 minute tolerance).
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > 300) return false;
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const expected = createHmac("sha256", key).update(`${id}.${timestamp}.${payload}`).digest("base64");
  // Header format: "v1,<sig> v1,<sig2> ..."
  for (const part of signatureHeader.split(" ")) {
    const sig = part.split(",")[1];
    if (!sig) continue;
    try {
      const a = Buffer.from(sig, "base64");
      const b = Buffer.from(expected, "base64");
      if (a.length === b.length && timingSafeEqual(a, b)) return true;
    } catch {
      /* try next */
    }
  }
  return false;
}
