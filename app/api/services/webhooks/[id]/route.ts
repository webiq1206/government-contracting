import { NextResponse } from "next/server";
import { requireOrgContext } from "@/lib/org-guard";
import { deleteWebhook, recentDeliveries, updateWebhook } from "@/lib/webhooks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const ctx = await requireOrgContext();
  if (ctx instanceof NextResponse) return ctx;
  return NextResponse.json({ deliveries: await recentDeliveries(id, ctx.orgId) });
}

export async function PATCH(req: Request, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const ctx = await requireOrgContext({ capability: "manage_integrations" });
  if (ctx instanceof NextResponse) return ctx;
  const body = (await req.json().catch(() => ({}))) as { label?: unknown; events?: unknown; active?: unknown };
  await updateWebhook(id, ctx.orgId, {
    label: typeof body.label === "string" ? body.label : undefined,
    events: Array.isArray(body.events) ? (body.events as unknown[]).filter((e): e is string => typeof e === "string") : undefined,
    active: typeof body.active === "boolean" ? body.active : undefined,
  });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const ctx = await requireOrgContext({ capability: "manage_integrations" });
  if (ctx instanceof NextResponse) return ctx;
  await deleteWebhook(id, ctx.orgId);
  return NextResponse.json({ ok: true });
}
