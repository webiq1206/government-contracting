import { NextResponse } from "next/server";
import { requireSubscriber } from "@/lib/api-auth";
import { resolveTenantOrgId } from "@/lib/tenant";
import { resendDomains } from "@/lib/integrations/resend-domains";
import {
  getSendingDomain,
  upsertSendingDomain,
  resolveOutreachSender,
} from "@/lib/domain/sending-domain";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Re-check DNS for this tenant's sending domain.
 *
 * The provider verifies asynchronously, so the status written here is the one
 * it reports back, never an optimistic "verified" just because the request
 * succeeded. Marking a domain verified while its DNS is still wrong would send
 * every subsequent outreach email straight to spam.
 */
export async function POST() {
  const auth = await requireSubscriber();
  if (auth instanceof NextResponse) return auth;
  const orgId = await resolveTenantOrgId();

  const row = await getSendingDomain(orgId);
  if (!row) {
    return NextResponse.json(
      { error: "Add a sending domain before checking it." },
      { status: 400 }
    );
  }
  if (!row.provider_domain_id) {
    return NextResponse.json(
      { error: "This domain was set up outside the app and needs no check." },
      { status: 400 }
    );
  }

  const res = await resendDomains.verify(row.provider_domain_id);
  if (res.disabled) {
    return NextResponse.json(
      { error: "Email sending is not configured on this deployment yet." },
      { status: 503 }
    );
  }

  const status =
    res.status === "verified" ? "verified" : res.status === "failed" ? "failed" : "pending";

  await upsertSendingDomain({
    orgId,
    domain: row.domain,
    fromLocal: row.from_local,
    fromName: row.from_name,
    replyTo: row.reply_to,
    providerDomainId: row.provider_domain_id,
    status,
    dnsRecords: res.records ?? row.dns_records ?? [],
    lastError: res.error ?? null,
  });

  const sender = await resolveOutreachSender(orgId);
  return NextResponse.json({
    ok: true,
    status,
    dnsRecords: res.records ?? row.dns_records ?? [],
    sender,
    // Plain-English result, because the person reading this just edited DNS
    // and wants to know whether it worked, not a provider status enum.
    message:
      status === "verified"
        ? "Verified. Your outreach now sends from your own domain."
        : status === "failed"
          ? "DNS did not match. Check the records below and try again."
          : "Not visible yet. DNS can take up to an hour to spread, then check again.",
  });
}
