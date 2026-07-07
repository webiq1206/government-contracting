import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { requireUser } from "@/lib/api-auth";
import { exchangeCode } from "@/lib/integrations/gmail";
import { config } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATE_COOKIE = "brostco_gmail_state";

/** Gmail OAuth callback, exchanges the code for tokens and stores the refresh token. */
export async function GET(req: Request) {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;

  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const err = url.searchParams.get("error");
  const returnedState = url.searchParams.get("state");
  const expectedState = cookies().get(STATE_COOKIE)?.value;
  // Consume the state cookie either way so it can't be replayed.
  cookies().delete(STATE_COOKIE);
  if (!expectedState || !returnedState || returnedState !== expectedState) {
    return NextResponse.redirect(`${config.appUrl}/settings/integrations?gmail=csrf`);
  }
  if (err) {
    return NextResponse.redirect(`${config.appUrl}/settings/integrations?gmail=denied`);
  }
  if (!code) {
    return NextResponse.redirect(`${config.appUrl}/settings/integrations?gmail=missing_code`);
  }
  try {
    const { email } = await exchangeCode(code);
    return NextResponse.redirect(
      `${config.appUrl}/settings/integrations?gmail=connected${email ? `&email=${encodeURIComponent(email)}` : ""}`
    );
  } catch (e) {
    return NextResponse.redirect(
      `${config.appUrl}/settings/integrations?gmail=error&msg=${encodeURIComponent((e as Error).message)}`
    );
  }
}
