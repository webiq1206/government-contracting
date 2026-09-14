import { NextResponse } from "next/server";
import { requireOrgContext } from "@/lib/org-guard";
import { queryOne } from "@/lib/db";
import { deliverDueWebhooks } from "@/lib/webhooks";
import { query } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Queue and send one clearly labelled test event to this webhook now. */
export async function POST(_req: Request, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const ctx = await requireOrgContext({ capability: "manage_integrations" });
  if (ctx instanceof NextResponse) return ctx;
  const hook = await queryOne<{ id: string }>(`select id from outbound_webhooks where id=$1 and org_id=$2`, [id, ctx.orgId]);
  if (!hook) return NextResponse.json({ error: "No such webhook." }, { status: 404 });
  const key = `test:${Date.now()}`;
  await query(
    `insert into webhook_deliveries (webhook_id, org_id, event, event_key, payload) values ($1,$2,'test',$3,$4::jsonb)`,
    [id, ctx.orgId, key, JSON.stringify({ title: "Test event from Brost Co", occurred_at: new Date().toISOString(), test: true })]
  );
  const result = await deliverDueWebhooks(20);
  const row = await queryOne<{ status: string; last_error: string | null; response_status: number | null }>(
    `select status, last_error, response_status from webhook_deliveries where webhook_id=$1 and event_key=$2`,
    [id, key]
  );
  return NextResponse.json({
    ok: row?.status === "delivered",
    message: row?.status === "delivered" ? "Delivered. The receiver answered with success." : `Not delivered: ${row?.last_error ?? "unknown"}. It will be retried.`,
    result,
  });
}
