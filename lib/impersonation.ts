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
 * Customer data stays readable, but mutations are refused centrally. Support
 * can inspect the exact state without accidentally changing it while trying
 * to reproduce an issue. The account holder performs any corrective action.
 */
import { NextResponse } from "next/server";
import type { SessionUser } from "./auth";

export const IMPERSONATION_REFUSAL =
  "This is a support session. Sign out of it and return to your admin account to do that.";

/**
 * A refusal response when the caller is inside a support session, or null when
 * they are not. Capability guards use this for all customer-data mutations;
 * personal credential and preference routes call it directly.
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
 * Deliberately safe to call with no request scope at all. `currentUser()`
 * distinguishes that worker state from a failed session or membership read:
 * the former returns null, while the latter still propagates and prevents an
 * outbound action from bypassing this guard during an authentication outage.
 */
export async function currentImpersonator(): Promise<string | null> {
  const { currentUser } = await import("./auth");
  const user = await currentUser();
  return user?.impersonatedBy ?? null;
}
