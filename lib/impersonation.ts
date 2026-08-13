/**
 * Guards for "sign in as a customer".
 *
 * An impersonated session exists so an admin can see what a customer sees. It
 * must not be able to act as them in ways that are irreversible or that reach
 * the outside world. The two that matter:
 *
 *   - Money. Changing a card or opening a billing portal as somebody else is
 *     not support, and the customer would have no record of who did it.
 *   - Mail. Outreach lands in a real subcontractor's inbox under the
 *     customer's name. An admin poking around an account to reproduce a bug
 *     must not be able to send that, and cannot un-send it.
 *
 * Everything else stays readable and usable, because a support session that
 * cannot reproduce the problem is not worth the risk of having one.
 */
import { NextResponse } from "next/server";
import type { SessionUser } from "./auth";

export const IMPERSONATION_REFUSAL =
  "This is a support session. Sign out of it and return to your admin account to do that.";

/**
 * A refusal response when the caller is inside a support session, or null when
 * they are not. Use in routes that spend money or change credentials.
 */
export function impersonationRefusal(
  user: Pick<SessionUser, "impersonatedBy">
): NextResponse | null {
  if (!user.impersonatedBy) return null;
  return NextResponse.json({ error: IMPERSONATION_REFUSAL }, { status: 403 });
}

/**
 * The admin behind the current request's support session, or null.
 *
 * Deliberately tolerant of being called with no request scope at all. This is
 * read from inside the email transport, which runs both in request handlers
 * and in the background worker; in the worker there is no session and
 * `cookies()` throws, which is the correct answer (a scheduled send is the
 * customer's own automation, not an admin acting as them) rather than an
 * error worth propagating.
 */
export async function currentImpersonator(): Promise<string | null> {
  try {
    const { currentUser } = await import("./auth");
    const user = await currentUser();
    return user?.impersonatedBy ?? null;
  } catch {
    return null;
  }
}
