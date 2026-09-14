import { NextResponse } from "next/server";
import { requireOrgContext } from "@/lib/org-guard";
import { can } from "@/lib/domain/roles";
import { listServices, serviceAvailable } from "@/lib/connected-services";
import { listWebhooks } from "@/lib/webhooks";
import { SERVICE_DEFS } from "@/lib/domain/connected-services";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Every connected app this person can see, plus which providers are on offer. */
export async function GET() {
  const ctx = await requireOrgContext();
  if (ctx instanceof NextResponse) return ctx;
  const [rows, hooks] = await Promise.all([listServices(ctx.orgId, ctx.user.id), listWebhooks(ctx.orgId)]);
  return NextResponse.json({
    providers: SERVICE_DEFS.map((d) => ({ ...d, available: serviceAvailable(d) })),
    connections: rows.map((r) => ({
      id: r.id,
      provider: r.provider,
      personal: r.user_id != null,
      mine: r.user_id === ctx.user.id,
      status: r.status,
      account_label: r.account_label,
      settings: r.settings,
      last_error: r.last_error,
      last_synced_at: r.last_synced_at,
      created_at: r.created_at,
    })),
    webhooks: hooks.map((w) => ({ id: w.id, label: w.label, url: w.url, events: w.events, active: w.active, last_status: w.last_status, last_delivered_at: w.last_delivered_at, failure_count: w.failure_count })),
    canManageIntegrations: can(ctx.user.orgRole, "manage_integrations"),
    userId: ctx.user.id,
  });
}
