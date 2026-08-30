import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api-auth";
import { tryResolveTenantOrgId } from "@/lib/tenant";
import { config } from "@/lib/config";
import { parseLocalDate, previousLocalDate, safeTimeZone } from "@/lib/domain/recap/day-window";
import { renderRecapEmail } from "@/lib/domain/recap/email";
import { buildRecapFor } from "@/lib/recap/build";
import { getRecapSettings, getUserRecapPreference } from "@/lib/recap/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The exact mail, without sending it.
 *
 * Built through the same path the morning send uses, with one difference:
 * `recordAges` is off. A preview must not age the urgent list, or opening this
 * page twice would make yesterday's problem read as two days old in tomorrow's
 * real mail.
 *
 * Returns the HTML as a document when asked for it, so the settings page can
 * drop it straight into a sandboxed frame and show what will actually arrive
 * rather than an approximation of it.
 */
export async function GET(req: Request) {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;

  const orgId = await tryResolveTenantOrgId();
  if (!orgId) {
    return NextResponse.json({ error: "No account is resolvable for this session." }, { status: 400 });
  }

  const url = new URL(req.url);
  const wantsHtml = url.searchParams.get("format") !== "json";

  const me = await getUserRecapPreference(auth.id);
  const timezone = safeTimeZone(me?.timezone ?? null);
  const requested = url.searchParams.get("date");
  const localDate =
    requested && parseLocalDate(requested) ? requested : previousLocalDate(new Date(), timezone);

  const settings = await getRecapSettings(orgId);
  const { recap } = await buildRecapFor({
    orgId,
    localDate,
    timezone,
    settings,
    recordAges: false,
  });

  const rendered = renderRecapEmail(recap, {
    appUrl: config.appUrl,
    recipientName: me?.name ?? auth.email,
    orgName: recap.orgName,
  });

  if (wantsHtml) {
    return new NextResponse(rendered.html, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        // A preview of live data should never be served from a cache; the
        // whole point is that it shows the account as it is right now.
        "Cache-Control": "no-store",
        // It is rendered inside a sandboxed frame on our own page and nowhere
        // else.
        "X-Frame-Options": "SAMEORIGIN",
      },
    });
  }

  return NextResponse.json({
    localDate,
    timezone,
    subject: rendered.subject,
    text: rendered.text,
    urgentCount: recap.urgentCount,
    quiet: recap.quiet,
  });
}
