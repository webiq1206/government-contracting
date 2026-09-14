import { NextResponse } from "next/server";
import { requireOrgContext } from "@/lib/org-guard";
import { can } from "@/lib/domain/roles";
import { config } from "@/lib/config";
import { getService, isAuthFailure, markServiceError, markSynced, mayManage } from "@/lib/connected-services";
import { postChannelMessage } from "@/lib/integrations/team-notify";
import { listCalendars } from "@/lib/integrations/calendar-sync";
import { ensureOpportunityFolder } from "@/lib/integrations/file-export";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Prove the connection works with something harmless: a test message to
 * the channel, a read of the calendar list, or the Brost Co root folder.
 * Never a real notification, event or document.
 */
export async function POST(_req: Request, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  // "view" is the floor; mayManage decides between a personal connection's owner and an administrator.
  const ctx = await requireOrgContext({ capability: "view" });
  if (ctx instanceof NextResponse) return ctx;
  const row = await getService(id, ctx.orgId);
  if (!row) return NextResponse.json({ error: "No such connection." }, { status: 404 });
  if (!mayManage(row, { id: ctx.user.id, canManageIntegrations: can(ctx.user.orgRole, "manage_integrations") })) {
    return NextResponse.json({ error: "You cannot test this connection." }, { status: 403 });
  }
  try {
    let message: string;
    if (row.provider === "slack" || row.provider === "teams") {
      await postChannelMessage(row, `Test from Brost Co: this channel is connected. Updates you choose on ${config.appUrl}/settings/integrations will arrive here.`);
      message = "A test message was posted to the channel.";
    } else if (row.provider === "google_calendar" || row.provider === "microsoft_calendar") {
      const cals = await listCalendars(row);
      message = `Connected. ${cals.length} calendar${cals.length === 1 ? "" : "s"} available to write to.`;
    } else {
      const folder = await ensureOpportunityFolder(row, "test", "Connection test");
      message = folder ? "Connected. A 'Brost Co' folder with a 'Connection test' subfolder is ready in your storage." : "Connected.";
    }
    await markSynced(row.id);
    return NextResponse.json({ ok: true, message });
  } catch (err) {
    const auth = isAuthFailure(err);
    const message = auth ? "The provider no longer accepts this connection. Reconnect it." : `The test failed: ${(err as Error).message}`;
    if (auth) await markServiceError(row.id, message);
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
