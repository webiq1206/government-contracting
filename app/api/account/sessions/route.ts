import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api-auth";
import { currentSessionId } from "@/lib/auth";
import { revokeOtherSessions, revokeSession } from "@/lib/account";
import { trackEvent } from "@/lib/analytics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * End a session, or every session but this one.
 *
 * Both paths are scoped to the signed-in user inside the delete statement
 * rather than checked first. A session id is a bearer token: a delete that
 * trusts an id from the request body would let anybody signed in end anybody
 * else's session by guessing one, and guessing is not needed if an id ever
 * leaks into a log.
 */
export async function POST(req: Request) {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;

  const body = (await req.json().catch(() => null)) as {
    sessionId?: unknown;
    scope?: unknown;
  } | null;
  const current = await currentSessionId();

  if (body?.scope === "others") {
    if (!current) {
      return NextResponse.json(
        { error: "This sign-in is not a stored session, so there is nothing to keep." },
        { status: 400 }
      );
    }
    /*
     * A failure here is reported as one.
     *
     * The revoke used to swallow its error and return 0, so a database that
     * refused the delete produced `ok: true, ended: 0` and an interface saying
     * "0 devices signed out" in the same green tone as a success. The person
     * pressing this button is usually the person who thinks somebody else is
     * in their account, and they would have walked away believing every other
     * session was gone.
     */
    let ended: number;
    try {
      ended = await revokeOtherSessions(auth.id, current);
    } catch {
      return NextResponse.json(
        {
          error:
            "Those devices could not be signed out and are still signed in. Try again, and change your password if you think somebody else is using the account.",
        },
        { status: 500 }
      );
    }
    void trackEvent({
      event: "sessions_revoked_others",
      userId: auth.id,
      orgId: auth.organizationId,
      path: "/settings/account",
      meta: { ended },
    });
    return NextResponse.json({ ok: true, ended });
  }

  const sessionId = typeof body?.sessionId === "string" ? body.sessionId : "";
  if (!sessionId) {
    return NextResponse.json({ error: "Which session?" }, { status: 400 });
  }
  if (current && sessionId === current) {
    // Ending the session you are holding is signing out, which has its own
    // button and clears the cookie. Doing it from here would leave the browser
    // holding a token for a row that no longer exists.
    return NextResponse.json(
      { error: "That is this device. Use Sign out instead." },
      { status: 400 }
    );
  }

  let ended: number;
  try {
    ended = await revokeSession(auth.id, sessionId);
  } catch {
    // Distinct from the 404 below: "already ended" is a true statement about a
    // session that is gone, and would be a false one about a session that is
    // still live because the delete failed.
    return NextResponse.json(
      {
        error:
          "That device could not be signed out and is still signed in. Try again, and change your password if you think somebody else is using the account.",
      },
      { status: 500 }
    );
  }
  if (ended === 0) {
    // Distinguished from success on purpose: "signed out" for a session that
    // was already gone teaches somebody the button works when it did nothing.
    return NextResponse.json(
      { error: "That session had already ended." },
      { status: 404 }
    );
  }
  void trackEvent({
    event: "session_revoked",
    userId: auth.id,
    orgId: auth.organizationId,
    path: "/settings/account",
  });
  return NextResponse.json({ ok: true, ended });
}
