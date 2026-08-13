import { NextResponse } from "next/server";
import { requireSubscriber } from "@/lib/api-auth";
import { resolveTenantOrgId } from "@/lib/tenant";
import { resendDomains } from "@/lib/integrations/resend-domains";
import {
  getSendingDomain,
  upsertSendingDomain,
  isValidSendingDomain,
  resolveOutreachSender,
  sanitizeLocalPart,
  sanitizeDisplayName,
} from "@/lib/domain/sending-domain";
import { query } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Current sending identity plus the DNS records still to publish. */
export async function GET() {
  const auth = await requireSubscriber();
  if (auth instanceof NextResponse) return auth;
  const orgId = await resolveTenantOrgId();

  const [row, sender] = await Promise.all([
    getSendingDomain(orgId),
    resolveOutreachSender(orgId),
  ]);

  return NextResponse.json({
    sender,
    domain: row
      ? {
          domain: row.domain,
          fromLocal: row.from_local,
          fromName: row.from_name,
          replyTo: row.reply_to,
          status: row.status,
          dnsRecords: row.dns_records ?? [],
          lastError: row.last_error,
          lastCheckedAt: row.last_checked_at,
          verifiedAt: row.verified_at,
        }
      : null,
  });
}

/**
 * Claim a sending domain. Registers it with the email provider and stores the
 * DNS records the customer must publish. Re-posting the same domain is a
 * no-op re-read rather than a duplicate registration.
 */
export async function POST(req: Request) {
  const auth = await requireSubscriber();
  if (auth instanceof NextResponse) return auth;
  const orgId = await resolveTenantOrgId();

  const body = (await req.json().catch(() => ({}))) as {
    domain?: string;
    fromLocal?: string;
    fromName?: string;
    replyTo?: string;
  };

  const domain = (body.domain ?? "").trim().toLowerCase();
  if (!isValidSendingDomain(domain)) {
    return NextResponse.json(
      { error: "Enter a domain you own, like mail.yourcompany.com." },
      { status: 400 }
    );
  }

  const replyTo = (body.replyTo ?? "").trim();
  if (replyTo && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(replyTo)) {
    return NextResponse.json(
      { error: "Reply-to must be a working email address you actually read." },
      { status: 400 }
    );
  }

  // A domain is a global identity at the provider. Refuse to re-register one
  // another tenant already claimed rather than letting two orgs fight over it.
  const taken = await query<{ org_id: string }>(
    `select org_id from organization_sending_domains
      where lower(domain) = $1 and org_id <> $2`,
    [domain, orgId]
  );
  if (taken.length > 0) {
    return NextResponse.json(
      { error: "That domain is already in use by another account." },
      { status: 409 }
    );
  }

  const existing = await getSendingDomain(orgId);

  // Only call the provider when the domain actually changed. Re-registering a
  // verified domain would reset it to pending and silently stop outreach.
  let providerId = existing?.provider_domain_id ?? null;
  let status = existing?.status ?? "pending";
  let records: unknown = existing?.dns_records ?? [];
  let lastError: string | null = null;

  if (!existing || existing.domain.toLowerCase() !== domain || !providerId) {
    const created = await resendDomains.create(domain);
    if (created.error && !created.disabled) {
      return NextResponse.json({ error: created.error }, { status: 502 });
    }
    if (created.disabled) {
      return NextResponse.json(
        { error: "Email sending is not configured on this deployment yet." },
        { status: 503 }
      );
    }
    providerId = created.id ?? null;
    status = created.status === "verified" ? "verified" : "pending";
    records = created.records ?? [];
    lastError = null;
  }

  await upsertSendingDomain({
    orgId,
    domain,
    fromLocal: sanitizeLocalPart(body.fromLocal),
    fromName: body.fromName ? sanitizeDisplayName(body.fromName) : null,
    replyTo: replyTo || null,
    providerDomainId: providerId,
    status,
    dnsRecords: records,
    lastError,
  });

  const sender = await resolveOutreachSender(orgId);
  return NextResponse.json({ ok: true, status, dnsRecords: records, sender });
}
