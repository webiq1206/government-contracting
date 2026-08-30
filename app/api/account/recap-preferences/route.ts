import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api-auth";
import { isValidTimeZone } from "@/lib/domain/recap/day-window";
import { getUserRecapPreference, setUserRecapOptOut, setUserTimeZone } from "@/lib/recap/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Your own time zone, and whether you want the morning recap.
 *
 * Scoped to the signed-in person, like the display name endpoint beside it. An
 * administrator deciding who receives the recap does that in the account's
 * recap settings; this is the personal half, and one person cannot set
 * another's zone here.
 *
 * The zone is not cosmetic. It decides which twenty-four hours "yesterday"
 * means and what hour six in the morning is, so an unrecognised value is
 * refused rather than stored: the failure would otherwise surface weeks later
 * as mail arriving at the wrong time with nothing to explain it.
 */
export async function GET() {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;

  const pref = await getUserRecapPreference(auth.id);
  if (!pref) return NextResponse.json({ error: "No such account." }, { status: 404 });

  return NextResponse.json({
    timezone: pref.timezone,
    timezoneIsDefault: pref.timezoneIsDefault,
    optedOut: pref.optedOut,
  });
}

export async function POST(req: Request) {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;

  const body = (await req.json().catch(() => ({}))) as {
    timezone?: unknown;
    optedOut?: unknown;
  };

  if (typeof body.timezone === "string") {
    if (!isValidTimeZone(body.timezone)) {
      return NextResponse.json(
        { error: `"${body.timezone}" is not a time zone this system recognises.` },
        { status: 400 }
      );
    }
    await setUserTimeZone(auth.id, body.timezone);
  }

  if (typeof body.optedOut === "boolean") {
    await setUserRecapOptOut(auth.id, body.optedOut);
  }

  const pref = await getUserRecapPreference(auth.id);
  return NextResponse.json({
    ok: true,
    timezone: pref?.timezone,
    timezoneIsDefault: pref?.timezoneIsDefault ?? true,
    optedOut: pref?.optedOut ?? false,
  });
}
