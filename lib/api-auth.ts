import { NextResponse } from "next/server";
import { currentUser, type SessionUser } from "./auth";

/**
 * Guard for API route handlers. Returns the user, or a 401 response to return
 * early. Usage:
 *   const auth = await requireUser();
 *   if (auth instanceof NextResponse) return auth;
 *   // auth is SessionUser
 */
export async function requireUser(): Promise<SessionUser | NextResponse> {
  const user = await currentUser().catch(() => null);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return user;
}
