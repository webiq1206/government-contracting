import { NextResponse } from "next/server";
import { requireOrgContext } from "@/lib/org-guard";
import { acceptableWebhookTarget, createWebhook, listWebhooks } from "@/lib/webhooks";
import { logAgent } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const ctx = await requireOrgContext();
  if (ctx instanceof NextResponse) return ctx;
  return NextResponse.json({ webhooks: await listWebhooks(ctx.orgId) });
}

/** Create a webhook. The signing secret is returned once. */
export async function POST(req: Request) {
  const ctx = await requireOrgContext({ capability: "manage_integrations" });
  if (ctx instanceof NextResponse) return ctx;
  const body = (await req.json().catch(() => ({}))) as { url?: unknown; label?: unknown; events?: unknown };
  const url = typeof body.url === "string" ? body.url.trim() : "";
  if (!acceptableWebhookTarget(url)) return NextResponse.json({ error: "Enter an https address." }, { status: 400 });
  const events = Array.isArray(body.events) ? (body.events as unknown[]).filter((e): e is string => typeof e === "string") : [];
  if (events.length === 0) return NextResponse.json({ error: "Choose at least one event to send." }, { status: 400 });
  const { row, secret } = await createWebhook({
    orgId: ctx.orgId,
    createdBy: ctx.user.id,
    label: typeof body.label === "string" && body.label.trim() ? body.label : "Webhook",
    url,
    events,
  });
  await logAgent({ agent: "operator", action: "webhook-created", level: "info", message: `${ctx.user.email} added a webhook (${row.label}) for ${events.join(", ")}.` });
  return NextResponse.json({ ok: true, id: row.id, secret });
}
