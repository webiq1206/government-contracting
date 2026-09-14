import { NextResponse } from "next/server";
import { requireOrgContext } from "@/lib/org-guard";
import { can } from "@/lib/domain/roles";
import { getService, isAuthFailure, markServiceError, mayManage } from "@/lib/connected-services";
import { listCalendars } from "@/lib/integrations/calendar-sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The calendars this connection may write to, so a person can pick one. */
export async function GET(_req: Request, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const ctx = await requireOrgContext();
  if (ctx instanceof NextResponse) return ctx;
  const row = await getService(id, ctx.orgId);
  if (!row) return NextResponse.json({ error: "No such connection." }, { status: 404 });
  if (!mayManage(row, { id: ctx.user.id, canManageIntegrations: can(ctx.user.orgRole, "manage_integrations") })) {
    return NextResponse.json({ error: "You cannot change this connection." }, { status: 403 });
  }
  if (row.provider !== "google_calendar" && row.provider !== "microsoft_calendar") return NextResponse.json({ calendars: [] });
  try {
    return NextResponse.json({ calendars: await listCalendars(row) });
  } catch (err) {
    const message = isAuthFailure(err) ? "The provider no longer accepts this connection. Reconnect it." : `Could not list calendars: ${(err as Error).message}`;
    if (isAuthFailure(err)) await markServiceError(row.id, message);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
