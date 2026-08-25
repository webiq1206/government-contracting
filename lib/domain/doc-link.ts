/**
 * Public document links for subcontractor outreach.
 *
 * A subcontractor has no account, so anything we link must open with a single
 * click. It also must never point at SAM.gov (or any other third party): the
 * sub is being asked to quote OUR job, and a raw SAM link both looks
 * unprofessional and invites them to bid it themselves.
 *
 * So every document reference in an outreach email becomes a link on our own
 * domain: /d/<token>. The token is a stateless, HMAC-signed pointer, so
 * nothing extra is stored and the link cannot be guessed or edited. Tokens
 * expire, which limits how long a forwarded link stays live.
 *
 * Two pointer kinds:
 *   s = stored file      -> streamed from our own storage
 *   u = upstream file    -> fetched server side and streamed through us, so
 *                           the recipient never sees the source URL. Only
 *                           hosts on ALLOWED_UPSTREAM_HOSTS can be pointed
 *                           at, which keeps this from being an open proxy.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export interface DocPointer {
  /** "s" = stored key, "u" = upstream URL we proxy, "p" = a package page. */
  k: "s" | "u" | "p";
  /** Storage key, upstream URL, or (for a package) the opportunity id. */
  v: string;
  /** Filename, or the package's title, shown to the recipient. */
  n: string;
  /** Expiry, seconds since epoch. */
  e: number;
  /**
   * For a package: the documents it lists.
   *
   * Carried in the token rather than looked up at open time, so the page shows
   * exactly the set that was promised in the email. A document added to the
   * opportunity afterwards is not silently included, and one deleted since
   * does not silently vanish: the recipient sees what they were told about.
   */
  d?: { k: "s" | "u"; v: string; n: string }[];
}

/** Only these hosts may be proxied. Prevents the route becoming an open proxy. */
export const ALLOWED_UPSTREAM_HOSTS = [
  "sam.gov",
  "www.sam.gov",
  "api.sam.gov",
  "falextracts.s3.amazonaws.com",
  "s3.amazonaws.com",
];

export function isAllowedUpstream(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:") return false;
    return ALLOWED_UPSTREAM_HOSTS.some(
      (h) => u.hostname === h || u.hostname.endsWith(`.${h}`)
    );
  } catch {
    return false;
  }
}

function secret(): string {
  return (
    process.env.AUTH_SECRET ||
    process.env.SESSION_SECRET ||
    "dev-insecure-secret-change-me"
  );
}

function b64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function unb64url(s: string): Buffer {
  return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

function sign(payload: string): string {
  return b64url(createHmac("sha256", `doc-link:${secret()}`).update(payload).digest());
}

/** Build the opaque token for a pointer. */
export function encodeDocToken(p: DocPointer): string {
  const payload = b64url(Buffer.from(JSON.stringify(p), "utf8"));
  return `${payload}.${sign(payload)}`;
}

/** Verify and decode. Returns null for tampered, malformed, or expired tokens. */
export function decodeDocToken(
  token: string,
  nowSec = Math.floor(Date.now() / 1000)
): DocPointer | null {
  const [payload, sig] = String(token ?? "").split(".");
  if (!payload || !sig) return null;
  const expected = sign(payload);
  // Constant-time compare; lengths must match first or timingSafeEqual throws.
  if (sig.length !== expected.length) return null;
  if (!timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const p = JSON.parse(unb64url(payload).toString("utf8")) as DocPointer;
    if (p.k !== "s" && p.k !== "u" && p.k !== "p") return null;
    if (typeof p.v !== "string" || !p.v) return null;
    if (typeof p.e !== "number" || p.e <= nowSec) return null;
    if (p.k === "u" && !isAllowedUpstream(p.v)) return null;
    if (p.k === "p") {
      if (!Array.isArray(p.d) || p.d.length === 0) return null;
      // Every entry is held to the same rules as a standalone pointer, so a
      // package cannot become a way to smuggle an unapproved upstream host.
      for (const entry of p.d) {
        if (entry?.k !== "s" && entry?.k !== "u") return null;
        if (typeof entry.v !== "string" || !entry.v) return null;
        if (entry.k === "u" && !isAllowedUpstream(entry.v)) return null;
      }
    }
    return p;
  } catch {
    return null;
  }
}

/**
 * The public URL for a document. Absolute, because it goes in an email.
 * APP_URL should be the site's public origin.
 */
export function publicDocUrl(p: Omit<DocPointer, "e">, ttlSeconds = 30 * 24 * 3600): string {
  const base = (process.env.APP_URL || "https://brostco.com").replace(/\/+$/, "");
  const token = encodeDocToken({ ...p, e: Math.floor(Date.now() / 1000) + ttlSeconds });
  return `${base}/d/${token}`;
}

/**
 * One link for a set of documents too large to attach.
 *
 * The email used to carry a separate link per oversized file, which on a
 * solicitation with a full drawing set meant a wall of URLs. This is a single
 * address the recipient opens to find them all listed.
 *
 * A page rather than an archive, deliberately. A zip would need a hand-written
 * implementation of the format in a bid-critical path, and would hand a
 * subcontractor a 40MB download before they can see what is in it. A list lets
 * them take the two drawings they need.
 *
 * Each entry keeps its own signed pointer, so the page grants no access the
 * individual links would not have.
 */
export function packageDocUrl(
  input: {
    /** The opportunity, so the page can name the job it belongs to. */
    opportunityId: string;
    title: string;
    documents: { k: "s" | "u"; v: string; n: string }[];
  },
  ttlSeconds = 30 * 24 * 3600
): string {
  const base = (process.env.APP_URL || "https://brostco.com").replace(/\/+$/, "");
  const token = encodeDocToken({
    k: "p",
    v: input.opportunityId,
    n: input.title,
    d: input.documents,
    e: Math.floor(Date.now() / 1000) + ttlSeconds,
  });
  return `${base}/d/${token}`;
}
