/**
 * Per-tenant outreach sender identity, derived from the connected Gmail inbox.
 *
 * Every customer connects their own mailbox with one button, and their
 * subcontractor email goes out from it. The From address is therefore the
 * address Google authorized, or a "Send mail as" alias the tenant has already
 * verified with Google. That check is Google's, not ours, which is exactly
 * where it belongs: an unverified alias is rejected at send time rather than
 * silently delivered as someone else.
 */
import { query } from "../db";
import { config } from "../config";

export interface OutreachSender {
  /** Ready-to-use From header. */
  from: string;
  /** Bare address subcontractors reply to. Always a real, monitored inbox. */
  replyTo: string;
  /** False when no inbox is connected and nothing can actually be sent. */
  connected: boolean;
}

/**
 * A From header is a single line. Anything that could start a new one, or
 * break the display-name quoting, is stripped rather than escaped: these
 * values come from a settings form, so a hostile value is a bug to neutralise,
 * not data to preserve. Em dashes go too, matching the house rule that they
 * never appear in anything a recipient sees.
 */
export function sanitizeDisplayName(raw: string | null | undefined): string {
  return (raw ?? "")
    .replace(/[\r\n]+/g, " ")
    .replace(/[<>"\\]/g, "")
    .replace(/[\u2014\u2013]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 64);
}

/**
 * An address destined for a header must not carry a line break either. Unlike
 * the display name this is not cosmetic: a newline here would let a settings
 * value inject Bcc.
 */
export function sanitizeAddress(raw: string | null | undefined): string {
  const v = (raw ?? "").replace(/[\r\n<>",\\]/g, "").trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? v : "";
}

/** Build a From header from parts that have already been sanitized. */
export function formatSender(name: string, address: string): string {
  return name ? `${name} <${address}>` : address;
}

/**
 * Resolve the From / Reply-To pair for a tenant's outreach.
 *
 * Never throws. When nothing is connected it reports connected:false rather
 * than inventing an address, so the transport refuses the send instead of
 * emitting mail that would bounce or impersonate.
 */
export async function resolveOutreachSender(orgId: string): Promise<OutreachSender> {
  let rows: {
    email: string | null;
    send_as: string | null;
    display_name: string | null;
    status: string | null;
    org_name: string | null;
  }[];
  try {
    rows = await query(
      `select t.email, t.send_as, t.display_name, t.status, o.name as org_name
         from organizations o
         left join integration_tokens t
           on t.org_id = o.id and t.provider = 'gmail'
        where o.id = $1`,
      [orgId]
    );
  } catch {
    return { from: "", replyTo: "", connected: false };
  }

  const row = rows[0];
  // send_as wins when set (a verified alias), otherwise the authorized address.
  const address = sanitizeAddress(row?.send_as) || sanitizeAddress(row?.email);
  if (!address || row?.status === "revoked") {
    return { from: "", replyTo: "", connected: false };
  }

  const name = sanitizeDisplayName(row?.display_name || row?.org_name);
  return {
    from: formatSender(name, address),
    // Replies must land in the same inbox we sync, otherwise a subcontractor's
    // answer would never be seen by the platform.
    replyTo: address,
    connected: true,
  };
}

/** Sender identity for platform system mail (resets, digests, alerts). */
export function systemSenderOverride(): string | null {
  const raw = config.systemMail.from;
  return raw ? raw : null;
}
