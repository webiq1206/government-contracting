import { NextResponse } from "next/server";
import { requireCapability } from "@/lib/api-auth";
import { tryResolveTenantOrgId } from "@/lib/tenant";
import { config } from "@/lib/config";
import { consume } from "@/lib/rate-limit";
import { logAgent } from "@/lib/logger";
import { systemMail } from "@/lib/integrations/system-mail";
import { previousLocalDate, safeTimeZone, parseLocalDate } from "@/lib/domain/recap/day-window";
import { renderRecapEmail } from "@/lib/domain/recap/email";
import { buildRecapFor } from "@/lib/recap/build";
import { claimDelivery, markAttempting, markFailed, markSent } from "@/lib/recap/delivery";
import { getRecapSettings, getUserRecapPreference } from "@/lib/recap/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Send one real recap to the person who asked for it, and nobody else.
 *
 * Three deliberate constraints:
 *
 *   1. It goes to the caller's own address, taken from the session rather than
 *      from the request body. A settings page that can mail an arbitrary
 *      address is a spam relay with a login page in front of it.
 *
 *   2. It is rate limited. Somebody checking whether the mail looks right will
 *      press this several times in a minute; the platform mailbox is shared
 *      with password resets, and a stuck finger must not spend that quota.
 *
 *   3. It is refused during a support session. An operator helping a customer
 *      is reading their screen, not sending mail as them, and a test send
 *      would arrive from the customer's account with nothing in it saying a
 *      stranger caused it.
 */
export async function POST(req: Request) {
  const auth = await requireCapability("manage_rules");
  if (auth instanceof NextResponse) return auth;

  if (auth.impersonatedBy) {
    return NextResponse.json(
      {
        error:
          "Test sends are off during a support session. Ask the account holder to press this themselves, so the mail is something they asked for.",
      },
      { status: 403 }
    );
  }

  const orgId = await tryResolveTenantOrgId();
  if (!orgId) {
    return NextResponse.json({ error: "No account is resolvable for this session." }, { status: 400 });
  }

  /*
   * Three an hour per person, and ten an hour per account. The per-account
   * ceiling is what stops a team of admins from each spending their own
   * allowance into one shared mailbox on the same morning.
   */
  const perUser = consume("recap-test", auth.id, { limit: 3, windowMs: 60 * 60_000 });
  if (!perUser.ok) {
    return NextResponse.json(
      {
        error: `That is three test recaps in an hour, which is enough to see what it looks like. Try again in ${Math.ceil(
          perUser.retryAfterSeconds / 60
        )} minute(s).`,
      },
      { status: 429, headers: { "Retry-After": String(perUser.retryAfterSeconds) } }
    );
  }
  const perOrg = consume("recap-test-org", orgId, { limit: 10, windowMs: 60 * 60_000 });
  if (!perOrg.ok) {
    return NextResponse.json(
      {
        error: `This account has sent ten test recaps in the last hour. Try again in ${Math.ceil(
          perOrg.retryAfterSeconds / 60
        )} minute(s).`,
      },
      { status: 429, headers: { "Retry-After": String(perOrg.retryAfterSeconds) } }
    );
  }

  if (!(await systemMail.deliverable())) {
    return NextResponse.json(
      {
        error:
          "Nothing can be sent right now: the platform inbox is not connected, so the morning recap would not go out either. That is worth fixing before testing this.",
      },
      { status: 503 }
    );
  }

  const body = (await req.json().catch(() => ({}))) as { date?: unknown };
  const me = await getUserRecapPreference(auth.id);
  const timezone = safeTimeZone(me?.timezone ?? null);
  const requested = typeof body.date === "string" ? body.date : null;
  const localDate =
    requested && parseLocalDate(requested) ? requested : previousLocalDate(new Date(), timezone);

  const settings = await getRecapSettings(orgId);
  const { recap } = await buildRecapFor({
    orgId,
    localDate,
    timezone,
    settings,
    // A rehearsal must not age the real list.
    recordAges: false,
  });

  const rendered = renderRecapEmail(recap, {
    appUrl: config.appUrl,
    recipientName: me?.name ?? auth.email,
    orgName: recap.orgName,
    test: true,
  });

  // Recorded as a test, which the once-per-day index excludes: testing the
  // mail must never consume the real morning's slot.
  const claim = await claimDelivery({
    orgId,
    userId: auth.id,
    recipientEmail: auth.email,
    scope: "org",
    localDate,
    timezone,
    dueAt: null,
    late: false,
    test: true,
  });

  if (claim.delivery) await markAttempting(claim.delivery.id);

  const result = await systemMail.sendDigest({
    to: auth.email,
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
  });

  const failure = result.error ?? (result.disabled ? "Platform inbox is not connected." : null);

  if (claim.delivery) {
    if (failure) {
      await markFailed(claim.delivery.id, failure, {
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
        quiet: recap.quiet,
        urgentCount: recap.urgentCount,
      });
    } else {
      await markSent(claim.delivery.id, {
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
        quiet: recap.quiet,
        urgentCount: recap.urgentCount,
        providerMessageId: result.messageId ?? null,
      });
    }
  }

  await logAgent({
    agent: "operator",
    action: failure ? "recap-test-unsent" : "recap-test-sent",
    level: failure ? "warn" : "info",
    ...(failure ? { status: "error" as const } : {}),
    message: `${auth.email} sent themselves a test recap for ${localDate}${
      failure ? ` and it failed: ${failure}` : ""
    }.`.slice(0, 500),
  });

  if (failure) {
    return NextResponse.json({ error: `The test send failed: ${failure}` }, { status: 502 });
  }

  return NextResponse.json({
    ok: true,
    sentTo: auth.email,
    localDate,
    subject: rendered.subject,
    urgentCount: recap.urgentCount,
    quiet: recap.quiet,
    remaining: perUser.remaining,
  });
}
