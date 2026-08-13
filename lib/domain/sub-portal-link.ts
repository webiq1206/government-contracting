/**
 * The link a subcontractor uses to hand us their paperwork.
 *
 * Same reasoning as doc-link.ts: a subcontractor has no account and never will
 * have one. Asking a two-person roofing outfit to create a login before they
 * can send a certificate of insurance is how the certificate never arrives.
 * So access is a signed, expiring token in the URL rather than a session.
 *
 * What is different here, and why this is a separate module rather than
 * another pointer kind on doc-link: this token authorizes writes. It lets the
 * holder sign a tax form. That earns it a shorter life, a distinct signing
 * key (so a leaked document link can never be reshaped into a signing link),
 * and a scope naming exactly one subcontractor.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export interface PortalPointer {
  /** Subcontractor this link speaks for. The only record it can touch. */
  s: string;
  /** Expiry, seconds since epoch. */
  e: number;
}

/**
 * Two weeks. Long enough to survive a foreman who checks email on Sundays,
 * short enough that a link forwarded around a supply house goes dead.
 */
export const PORTAL_TTL_SECONDS = 14 * 24 * 3600;

function secret(): string {
  const s = process.env.AUTH_SECRET || process.env.SESSION_SECRET;
  if (s) return s;
  // These tokens authorize signing a tax form. Minting one against the
  // public default secret in production would make every portal link
  // forgeable by anyone who has read the source, so refuse outright rather
  // than degrade. Dev and tests keep the default for convenience.
  if (process.env.NODE_ENV === "production") {
    throw new Error("AUTH_SECRET must be set before portal links can be issued.");
  }
  return "dev-insecure-secret-change-me";
}

function b64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function unb64url(s: string): Buffer {
  return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

function sign(payload: string): string {
  // Key namespace differs from doc-link on purpose. A token minted for one
  // purpose must never verify for the other.
  return b64url(createHmac("sha256", `sub-portal:${secret()}`).update(payload).digest());
}

export function encodePortalToken(p: PortalPointer): string {
  const payload = b64url(Buffer.from(JSON.stringify(p), "utf8"));
  return `${payload}.${sign(payload)}`;
}

/** Verify and decode. Null for tampered, malformed, or expired tokens. */
export function decodePortalToken(
  token: string,
  nowSec = Math.floor(Date.now() / 1000)
): PortalPointer | null {
  const [payload, sig] = String(token ?? "").split(".");
  if (!payload || !sig) return null;
  const expected = sign(payload);
  if (sig.length !== expected.length) return null;
  try {
    if (!timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  } catch {
    return null;
  }
  try {
    const p = JSON.parse(unb64url(payload).toString("utf8")) as PortalPointer;
    if (typeof p.s !== "string" || !p.s) return null;
    if (typeof p.e !== "number" || p.e <= nowSec) return null;
    return p;
  } catch {
    return null;
  }
}

/** Absolute, because it goes in an email. */
export function subPortalUrl(
  subcontractorId: string,
  ttlSeconds = PORTAL_TTL_SECONDS
): string {
  const base = (process.env.APP_URL || "https://brostco.com").replace(/\/+$/, "");
  const token = encodePortalToken({
    s: subcontractorId,
    e: Math.floor(Date.now() / 1000) + ttlSeconds,
  });
  return `${base}/vendor/${token}`;
}

/** When a link minted now will stop working, for the operator UI to show. */
export function portalLinkExpiry(ttlSeconds = PORTAL_TTL_SECONDS): Date {
  return new Date(Date.now() + ttlSeconds * 1000);
}
