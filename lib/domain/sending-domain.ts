/**
 * Per-tenant outreach sender identity.
 *
 * Every customer sends subcontractor email through OUR infrastructure. They
 * never register an OAuth app, never clear Google verification, and never hand
 * us a mailbox password. They prove one domain by DNS and we send as them.
 *
 * Two states, and both must work:
 *
 *   verified  From is their own domain ("Acme Builders <bids@mail.acme.com>").
 *   pending   From is the shared platform domain, Reply-To is still their real
 *             inbox, so a customer who signed up ten minutes ago can send today
 *             and replies still reach a human. Deliverability is the only thing
 *             they trade away until DNS lands.
 */
import { query, queryOne } from "../db";
import { config } from "../config";

export interface SendingDomainRow {
  org_id: string;
  domain: string;
  from_local: string;
  from_name: string | null;
  reply_to: string | null;
  provider_domain_id: string | null;
  status: string;
  dns_records: unknown;
  last_error: string | null;
  last_checked_at: string | null;
  verified_at: string | null;
}

export interface OutreachSender {
  /** Ready-to-use From header. */
  from: string;
  /** Bare address subcontractors reply to. Always a real, monitored inbox. */
  replyTo: string;
  /** False when sending on the shared platform domain. */
  verified: boolean;
  /** The domain the From address sits on. */
  domain: string;
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

/** Local parts are restricted to the dot-atom characters we actually issue. */
export function sanitizeLocalPart(raw: string | null | undefined): string {
  const cleaned = (raw ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, "")
    .replace(/^[._-]+|[._-]+$/g, "")
    .slice(0, 32);
  return cleaned || "bids";
}

/**
 * Accept only what a real sending domain looks like. Rejecting here keeps
 * garbage out of the Resend API call and out of the From header alike.
 */
export function isValidSendingDomain(raw: string): boolean {
  const d = raw.trim().toLowerCase();
  if (d.length < 4 || d.length > 253) return false;
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(d)) return false;
  // A bare public suffix ("com") or a single label is never a sending domain.
  return d.split(".").length >= 2 && /\.[a-z]{2,}$/.test(d);
}

/** Build a From header from parts that have already been sanitized. */
export function formatSender(name: string, local: string, domain: string): string {
  const addr = `${local}@${domain}`;
  return name ? `${name} <${addr}>` : addr;
}

export async function getSendingDomain(orgId: string): Promise<SendingDomainRow | null> {
  return queryOne<SendingDomainRow>(
    `select * from organization_sending_domains where org_id = $1`,
    [orgId]
  );
}

/**
 * The shared domain a tenant sends from before their own is verified.
 *
 * The local part is per-tenant so inbound replies to the shared domain can be
 * routed back to the right org, and so one tenant's reputation problem does
 * not silently become another's.
 */
function fallbackSender(orgId: string, orgName: string, replyTo: string): OutreachSender {
  const domain = config.platformSendingDomain;
  const local = sanitizeLocalPart(orgId.replace(/-/g, "").slice(0, 12));
  return {
    from: formatSender(sanitizeDisplayName(orgName), local, domain),
    replyTo,
    verified: false,
    domain,
  };
}

/**
 * Resolve the From / Reply-To pair for a tenant's outreach.
 *
 * Never throws: outreach must not be blocked by a missing settings row, so an
 * org with nothing configured still gets a working shared-domain identity.
 */
export async function resolveOutreachSender(orgId: string): Promise<OutreachSender> {
  let rows: {
    domain: string;
    from_local: string;
    from_name: string | null;
    reply_to: string | null;
    status: string;
    org_name: string | null;
  }[];
  try {
    rows = await query(
      `select d.domain, d.from_local, d.from_name, d.reply_to, d.status, o.name as org_name
         from organizations o
         left join organization_sending_domains d on d.org_id = o.id
        where o.id = $1`,
      [orgId]
    );
  } catch {
    // Lookup failed, which is NOT the same as "this tenant has no domain".
    // Falling through to the shared domain here would downgrade a customer who
    // has already verified their own, every time the database hiccups. Use the
    // platform identity instead and leave their configuration untouched.
    return {
      from: config.outreach.fallbackFrom,
      replyTo: config.outreach.fallbackReplyTo,
      verified: true,
      domain: config.outreach.fallbackFrom.split("@").pop()?.replace(">", "") ?? "",
    };
  }

  const row = rows[0];
  const orgName = row?.org_name ?? "";
  // Reply-To falls back through: explicit setting, then the platform address,
  // so a subcontractor reply always has somewhere real to land.
  const replyTo = row?.reply_to?.trim() || config.outreach.fallbackReplyTo;

  if (!row?.domain || row.status !== "verified") {
    return fallbackSender(orgId, orgName || "BROSTCO", replyTo);
  }

  const name = sanitizeDisplayName(row.from_name || orgName);
  const local = sanitizeLocalPart(row.from_local);
  return {
    from: formatSender(name, local, row.domain),
    replyTo,
    verified: true,
    domain: row.domain,
  };
}

/** Persist a tenant's chosen domain and the DNS records they must publish. */
export async function upsertSendingDomain(input: {
  orgId: string;
  domain: string;
  fromLocal: string;
  fromName: string | null;
  replyTo: string | null;
  providerDomainId: string | null;
  status: string;
  dnsRecords: unknown;
  lastError?: string | null;
}): Promise<void> {
  await query(
    `insert into organization_sending_domains
       (org_id, domain, from_local, from_name, reply_to, provider_domain_id,
        status, dns_records, last_error, last_checked_at, verified_at, updated_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, now(),
             case when $7 = 'verified' then now() else null end, now())
     on conflict (org_id) do update set
       domain             = excluded.domain,
       from_local         = excluded.from_local,
       from_name          = excluded.from_name,
       reply_to           = excluded.reply_to,
       provider_domain_id = excluded.provider_domain_id,
       status             = excluded.status,
       dns_records        = excluded.dns_records,
       last_error         = excluded.last_error,
       last_checked_at    = now(),
       -- Keep the original verification timestamp once earned; a later status
       -- re-check must not look like a fresh verification.
       verified_at        = coalesce(organization_sending_domains.verified_at,
                                     excluded.verified_at),
       updated_at         = now()`,
    [
      input.orgId,
      input.domain.trim().toLowerCase(),
      sanitizeLocalPart(input.fromLocal),
      input.fromName ? sanitizeDisplayName(input.fromName) : null,
      input.replyTo?.trim() || null,
      input.providerDomainId,
      input.status,
      JSON.stringify(input.dnsRecords ?? []),
      input.lastError ?? null,
    ]
  );
}
