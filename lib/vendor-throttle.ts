/**
 * What the subcontractor portal will put up with.
 *
 * The policy lives here rather than in the route handlers so that all of it
 * can be read at once. Every number below is set against what a real
 * subcontractor does, not against what feels safe: these routes are the only
 * way a sub can hand us a W-9, and a limit that locks out an estimator on a
 * bad phone connection costs us the document we were chasing.
 *
 * Two different things are being defended against, and they need different
 * limits:
 *
 *   1. Guessing a token. The signal is a burst of rejected tokens from one
 *      address. Tokens are HMAC-signed so guessing is already hopeless, but
 *      an attempt should cost the attacker something rather than costing us.
 *      Limited hard, because no legitimate visitor produces this.
 *   2. Hammering with a token that is real. Only reachable by someone we sent
 *      a link to, so this is loosened: the concern is a retry loop or a script
 *      burning storage writes and PDF renders, not an intruder.
 *
 * The token remains the access control. This is only about cost.
 */
import { consume, clientIp, tooManyRequests, type RateLimitResult } from "./rate-limit";

const HOUR = 60 * 60 * 1000;

/**
 * Rejected tokens, per address. Matches the login route's brute-force
 * threshold, since it is the same shape of attack.
 */
const BAD_TOKEN = { limit: 10, windowMs: 10 * 60 * 1000 };

/**
 * Signing, per subcontractor.
 *
 * A sub signs a W-9 once. Allowing five leaves room for a correction and a
 * genuine re-sign when details change, and still bounds how many PDF renders
 * and storage writes one link can cause in an hour.
 */
const SIGN = { limit: 5, windowMs: HOUR };

/**
 * Uploads, per subcontractor. Four documents is a full set (general liability,
 * workers comp, auto, licence), so this leaves generous room for retries,
 * re-scans, and a photo that came out unreadable the first three times.
 */
const UPLOAD = { limit: 20, windowMs: HOUR };

/**
 * Writes per address, across every subcontractor.
 *
 * Deliberately well above the per-subcontractor limits: several subs can share
 * one office or site address, and a shared connection must not mean the second
 * firm to send their certificate gets turned away.
 */
const WRITES_PER_IP = { limit: 60, windowMs: HOUR };

/**
 * Keyed on the subcontractor rather than the raw token, so that issuing a
 * fresh link does not hand out a fresh allowance. Otherwise the limit would be
 * bypassed by anyone who could get a new link, which is the one thing every
 * holder of an old one can do.
 */
export type WriteKind = "sign" | "upload";

/**
 * Count a rejected token against an address.
 *
 * Returns false once the address has run out of attempts. Takes a bare address
 * so the portal page, which is a server component with no Request object, can
 * share one counter with the API routes: a scanner that probes the page and
 * then tries to post is already partway through its allowance.
 */
export function rejectedTokenAllowed(ip: string): boolean {
  return consume("vendor-bad-token", ip, BAD_TOKEN).ok;
}

/** Call when a token failed to decode. Returns a 429 once the run is long. */
export function guardRejectedToken(req: Request): Response | null {
  const result = consume("vendor-bad-token", clientIp(req), BAD_TOKEN);
  if (result.ok) return null;
  return tooManyRequests(
    "Too many attempts from this connection. Wait a few minutes and use the link from your email.",
    result
  );
}

/**
 * Call once a token has been accepted, before doing any real work.
 *
 * Checks the per-subcontractor allowance and the per-address one, and reports
 * whichever is exhausted. Both are counted on every call rather than
 * short-circuiting, so a caller cannot dodge the address limit by spreading
 * requests across subcontractors.
 */
export function guardWrite(
  req: Request,
  subcontractorId: string,
  kind: WriteKind
): Response | null {
  const perSub = consume(
    kind === "sign" ? "vendor-sign" : "vendor-upload",
    subcontractorId,
    kind === "sign" ? SIGN : UPLOAD
  );
  const perIp = consume("vendor-writes", clientIp(req), WRITES_PER_IP);

  if (!perSub.ok) {
    return tooManyRequests(
      kind === "sign"
        ? "That has been signed several times already in the last hour. Give it a few minutes, or reply to our email and we will sort it out."
        : "That is a lot of uploads in one hour. Give it a few minutes, or reply to our email and we will take the file directly.",
      perSub
    );
  }
  if (!perIp.ok) {
    return tooManyRequests(
      "Too many uploads from this connection in the last hour. Give it a few minutes, or reply to our email and we will take them directly.",
      perIp
    );
  }
  return null;
}

export type { RateLimitResult };
