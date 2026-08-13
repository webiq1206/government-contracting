import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { requireUser } from "@/lib/api-auth";
import { getAuthUrl } from "@/lib/integrations/gmail";
import { config } from "@/lib/config";
import { hydrateIntegrationEnv } from "@/lib/integration-settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATE_COOKIE = "brostco_gmail_state";

/** Start the Gmail OAuth consent flow (CSRF-protected via `state`). */
export async function GET() {
  await hydrateIntegrationEnv();
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;
  if (!config.gmail.configured) {
    // Never strand the operator on a raw JSON error page. Send them back to
    // the page they came from with a plain-English explanation of the one
    // thing they missed (pasting is not saving).
    const back = new URL("/settings/integrations", config.appUrl);
    back.searchParams.set(
      "gmailError",
      "Gmail is not connected yet: your OAuth client ID and secret have not been saved. Paste both into the Gmail card below and press Save, then click Connect Gmail."
    );
    return NextResponse.redirect(back);
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
