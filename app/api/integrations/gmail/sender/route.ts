/**
 * The address this tenant's email goes out from.
 *
 * Kept separate from the generic integrations route because this is not a
 * stored credential: the set of legal values belongs to Google, so both
 * reading and writing go through the connected mailbox rather than through a
 * settings table.
 */
import { NextResponse } from "next/server";
import { requireCapability } from "@/lib/api-auth";
import { gmail } from "@/lib/integrations/gmail";
import { resolveTenantOrgId } from "@/lib/tenant";
import { logAgent } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The verified addresses Google offers, and which one is in use. */
export async function GET() {
  const auth = await requireCapability("manage_integrations");
  if (auth instanceof NextResponse) return auth;

  const orgId = await resolveTenantOrgId();
  let connection: Awaited<ReturnType<typeof gmail.connection>>;
  let list: Awaited<ReturnType<typeof gmail.sendAsAddresses>>;
  try {
    [connection, list] = await Promise.all([
      gmail.connection(orgId),
      gmail.sendAsAddresses(orgId),
    ]);
  } catch (error) {
    console.error("[gmail-sender] status lookup failed", error);
    return NextResponse.json(
      {
        error:
          "The connected inbox and its sending address could not be verified. Nothing was changed. Check the database connection, reload this page, and try again.",
      },
      { status: 503 }
    );
  }

  if (!list.ok) {
    return NextResponse.json(
      {
        connectedEmail: connection.email,
        sendAs: connection.sendAs,
        options: [],
        error: `${list.error} No sending-address change was made. Reconnect the inbox if Google access was revoked, then try again.`,
      },
      { status: connection.connected ? 502 : 409 }
    );
  }

  return NextResponse.json({
    connectedEmail: connection.email,
    sendAs: connection.sendAs,
    options: list.options,
    error: null,
  });
}

/** Choose one of them. An empty address returns to the authorized account. */
export async function POST(req: Request) {
  const auth = await requireCapability("manage_integrations");
  if (auth instanceof NextResponse) return auth;

  const body = (await req.json().catch(() => ({}))) as { address?: string | null };
  const orgId = await resolveTenantOrgId();
  const result = await gmail.setSendAs(body.address ?? null, orgId);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  await logAgent({
    agent: "operator",
    action: "gmail-sender-changed",
    level: "info",
    message: `${auth.email} set the outgoing email address to ${
      result.sendAs ?? "the connected Google account"
    }.`,
  });

  return NextResponse.json({ ok: true, sendAs: result.sendAs });
}
