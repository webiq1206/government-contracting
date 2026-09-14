import { NextResponse } from "next/server";
import { requireOrgContext } from "@/lib/org-guard";
import { saveWebhookConnection } from "@/lib/connected-services";
import { acceptableWebhookUrl } from "@/lib/integrations/team-notify";
import { logAgent } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Connect a Teams channel from a Workflows link the person pasted. Company-wide. */
export async function POST(req: Request) {
  const ctx = await requireOrgContext({ capability: "manage_integrations" });
  if (ctx instanceof NextResponse) return ctx;
  const body = (await req.json().catch(() => ({}))) as { url?: unknown; label?: unknown };
  const url = typeof body.url === "string" ? body.url.trim() : "";
  if (!acceptableWebhookUrl("teams", url)) {
    return NextResponse.json({ error: "That does not look like a Teams workflow link. It should be an https address from Power Automate or Teams Workflows." }, { status: 400 });
  }
  const label = typeof body.label === "string" && body.label.trim() ? body.label.trim().slice(0, 120) : "Teams channel";
  const row = await saveWebhookConnection({ orgId: ctx.orgId, createdBy: ctx.user.id, provider: "teams", url, label });
  await logAgent({ agent: "operator", action: "service-connected", level: "info", message: `${ctx.user.email} connected a Microsoft Teams channel (${label}) for the company.` });
  return NextResponse.json({ ok: true, id: row.id });
}
