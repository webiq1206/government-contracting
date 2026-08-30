import { NextResponse } from "next/server";
import { requireCapability } from "@/lib/api-auth";
import { tryResolveTenantOrgId } from "@/lib/tenant";
import { consume } from "@/lib/rate-limit";
import { logAgent } from "@/lib/logger";
import { systemMail } from "@/lib/integrations/system-mail";
import {
  getDelivery,
  markAttempting,
  markFailed,
  markSent,
  reopenForRetry,
} from "@/lib/recap/delivery";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Send a failed recap again.
 *
 * It sends the stored copy, byte for byte, rather than rebuilding it. That is
 * the whole reason the rendered mail is kept: a recap regenerated two days
 * later describes a different day, and the recipient would receive something
 * that does not match the history row they were told was being retried.
 *
 * Only a failed or bounced row can be retried, and the check is a conditional
 * update rather than a read followed by a write, so two people pressing the
 * button at the same moment produce one email.
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const auth = await requireCapability("manage_rules");
  if (auth instanceof NextResponse) return auth;

  if (auth.impersonatedBy) {
    return NextResponse.json(
      {
        error:
          "Retries are off during a support session, so nothing goes out of a customer's account without them asking.",
      },
      { status: 403 }
    );
  }

  const orgId = await tryResolveTenantOrgId();
  if (!orgId) {
    return NextResponse.json({ error: "No account is resolvable for this session." }, { status: 400 });
  }

  const limit = consume("recap-retry", orgId, { limit: 20, windowMs: 60 * 60_000 });
  if (!limit.ok) {
    return NextResponse.json(
      { error: "Too many retries in the last hour. Try again shortly." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } }
    );
  }

  const existing = await getDelivery(params.id);
  if (!existing || existing.orgId !== orgId) {
    // Same answer for "not yours" as for "does not exist": a distinguishable
    // 403 would confirm that somebody else's delivery id is real.
    return NextResponse.json({ error: "No such delivery." }, { status: 404 });
  }

  if (!existing.html || !existing.subject) {
    return NextResponse.json(
      {
        error:
          "There is no saved copy of this one to resend. It failed before the mail was written, so the next scheduled run will build it fresh if the day is still inside the window.",
      },
      { status: 409 }
    );
  }

  const reopened = await reopenForRetry(params.id, orgId);
  if (!reopened) {
    return NextResponse.json(
      { error: `This recap is marked ${existing.status}, so there is nothing to retry.` },
      { status: 409 }
    );
  }

  // Before the provider, not after: a crash in between must read as "we do
  // not know whether that arrived" rather than as "never sent".
  await markAttempting(params.id);

  const result = await systemMail.sendDigest({
    to: existing.recipientEmail,
    subject: existing.subject,
    html: existing.html,
    text: existing.textBody ?? "",
  });

  const failure = result.error ?? (result.disabled ? "Platform inbox is not connected." : null);

  if (failure) {
    await markFailed(params.id, failure);
    await logAgent({
      agent: "operator",
      action: "recap-unsent",
      level: "error",
      status: "error",
      message: `${auth.email} retried the ${existing.localDate} recap to ${existing.recipientEmail} and it failed again: ${failure}`.slice(
        0,
        500
      ),
    });
    return NextResponse.json({ error: `It failed again: ${failure}` }, { status: 502 });
  }

  await markSent(params.id, {
    subject: existing.subject,
    html: existing.html,
    text: existing.textBody ?? "",
    quiet: existing.quiet,
    urgentCount: existing.urgentCount,
    providerMessageId: result.messageId ?? null,
  });

  await logAgent({
    agent: "operator",
    action: "recap-sent",
    level: "info",
    message: `${auth.email} retried the ${existing.localDate} recap to ${existing.recipientEmail} and it went out.`,
  });

  return NextResponse.json({ ok: true, sentTo: existing.recipientEmail });
}
