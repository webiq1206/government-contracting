import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { requireUser } from "@/lib/api-auth";
import { getAuthUrl } from "@/lib/integrations/gmail";
import { config } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATE_COOKIE = "brostco_gmail_state";

/** Start the Gmail OAuth consent flow (CSRF-protected via `state`). */
export async function GET() {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;
  if (!config.gmail.configured) {
    return NextResponse.json(
      { error: "Set GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET first." },
      { status: 400 }
    );
  }
  // Random state, stored in a short-lived httpOnly cookie and echoed via the
  // OAuth `state` param; the callback rejects any mismatch. This blocks a
  // logged-in operator from being tricked into connecting the attacker's Gmail.
  const state = randomBytes(24).toString("hex");
  cookies().set(STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    secure: config.isProd,
    path: "/",
    maxAge: 600, // 10 minutes
  });
  return NextResponse.redirect(getAuthUrl(state));
}
