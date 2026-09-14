import { NextResponse } from "next/server";
import { requireOrgContext } from "@/lib/org-guard";
import { can } from "@/lib/domain/roles";
import { disconnectService, getService, mayManage, setPaused, updateSettings } from "@/lib/connected-services";
import { NOTIFY_EVENT_KEYS, SERVICE_BY_ID } from "@/lib/domain/connected-services";
import { logAgent } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function load(id: string) {
  // "view" is the floor: a personal connection is its owner's to change, a
  // company-wide one needs manage_integrations, and mayManage decides which.
  const ctx = await requireOrgContext({ capability: "view" });
  if (ctx instanceof NextResponse) return ctx;
  const row = await getService(id, ctx.orgId);
  if (!row) return NextResponse.json({ error: "No such connection." }, { status: 404 });
  const allowed = mayManage(row, { id: ctx.user.id, canManageIntegrations: can(ctx.user.orgRole, "manage_integrations") });
  if (!allowed) return NextResponse.json({ error: "Only the person who connected this, or an administrator for company-wide connections, can change it." }, { status: 403 });
  return { ctx, row };
}

/** Preferences, pause and resume. Body: { calendar_id?, events?, paused? }. */
export async function PATCH(req: Request, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const loaded = await load(id);
  if (loaded instanceof NextResponse) return loaded;
  const { ctx, row } = loaded;
  const body = (await req.json().catch(() => ({}))) as { calendar_id?: unknown; events?: unknown; paused?: unknown };
  const patch: Record<string, unknown> = {};
  if (typeof body.calendar_id === "string") patch.calendar_id = body.calendar_id.slice(0, 300);
  if (Array.isArray(body.events)) patch.events = (body.events as unknown[]).filter((e): e is string => typeof e === "string" && NOTIFY_EVENT_KEYS.has(e));
  if (Object.keys(patch).length > 0) await updateSettings(row.id, ctx.orgId, patch);
  if (typeof body.paused === "boolean") await setPaused(row.id, ctx.orgId, body.paused);
  const fresh = await getService(row.id, ctx.orgId);
  return NextResponse.json({ ok: true, connection: fresh });
}

/**
 * Disconnect. Stops all future access and syncing. Events already on the
 * calendar and files already saved stay where they are, by design.
 */
export async function DELETE(_req: Request, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const loaded = await load(id);
  if (loaded instanceof NextResponse) return loaded;
  const { ctx, row } = loaded;
  await disconnectService(row.id, ctx.orgId);
  await logAgent({
    agent: "operator",
    action: "service-disconnected",
    level: "info",
    message: `${ctx.user.email} disconnected ${SERVICE_BY_ID[row.provider].name}${row.account_label ? ` (${row.account_label})` : ""}. Nothing already pushed was removed.`,
  });
  return NextResponse.json({ ok: true });
}
