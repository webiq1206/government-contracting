import { NextResponse } from "next/server";
import { requirePlatformAdmin } from "@/lib/platform-admin";
import { readUsage } from "@/lib/api-usage/read";
import { query, transaction } from "@/lib/db";
import { z } from "zod";
import { validateCost } from "@/lib/api-usage/money";
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  const auth = await requirePlatformAdmin();
  if (auth instanceof Response) return auth;
  try {
    const [usage, tenants, reports, rates] = await Promise.all([
      readUsage(new URL(req.url).searchParams),
      query("select id,name from organizations order by name"),
      query(
        "select id,provider,starts_at::text,ends_at::text,reported_cost::text,tracked_cost::text,unknown_calls,evidence from api_usage_provider_reports order by created_at desc limit 25",
      ),
      query('select provider,service,rates,max_request_cost::text,evidence,updated_at::text from api_usage_rates order by provider,service'),
    ]);
    return NextResponse.json({ ...usage, tenants, reports, rates });
  } catch {
    return NextResponse.json(
      {
        error:
          "Usage could not be loaded. Check the date filters and retry. If this continues, check the database migration.",
      },
      { status: 503 },
    );
  }
}
const schema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("report"),
    provider: z.string().min(1).max(100),
    from: z.string().datetime(),
    to: z.string().datetime(),
    cost: z.string(),
    evidence: z.string().min(5).max(1000),
  }),
  z.object({ action: z.literal("invoice"), orgId: z.string().uuid() }),
  z.object({
    action: z.literal("limit"),
    orgId: z.string().uuid().nullable(),
    provider: z.string().min(1).max(100),
    feature: z.string().min(1).max(150),
    amount: z.string().nullable(),
    warning: z.number().int().min(1).max(100),
    paused: z.boolean(),
    requireTenant: z.boolean(),
  }),
  z.object({
    action: z.literal("reconcile"),
    id: z.string().uuid(),
    cost: z.string(),
    evidence: z.string().min(5).max(1000),
  }),
  z.object({
    action: z.literal("status"),
    id: z.string().uuid(),
    status: z.enum(["billed", "paid", "credited", "refunded"]),
    reference: z.string().min(3).max(200),
  }),
  z.object({
    action: z.literal("rate"),
    provider: z.string().min(1).max(100),
    service: z.string().min(1).max(150),
    rates: z.record(z.string(), z.string()),
    maxCost: z.string().nullable(),
    evidence: z.string().min(5).max(1000),
  }),
]);
export async function POST(req: Request) {
  const auth = await requirePlatformAdmin();
  if (auth instanceof Response) return auth;
  try {
    const body = schema.parse(await req.json());
    if (body.action === "invoice") {
      const { createUsageInvoice } = await import("@/lib/api-usage/invoice");
      return NextResponse.json({
        ok: true,
        invoiceId: await createUsageInvoice(body.orgId, auth.email),
      });
    }
    if (body.action === "limit" && body.amount !== null)
      validateCost(body.amount);
    if (body.action === "reconcile" || body.action === "report")
      validateCost(body.cost);
    if (body.action === "rate") {
      Object.values(body.rates).forEach(validateCost);
      if (body.maxCost !== null) validateCost(body.maxCost);
    }
    await transaction(async (client) => {
      await client.query(
        "select pg_advisory_xact_lock(hashtext('api-usage-admission'))",
      );
      let orgId: string | null = null;
      if (body.action === "report") {
        await client.query(
          `insert into api_usage_provider_reports(provider,starts_at,ends_at,reported_cost,tracked_cost,unknown_calls,evidence)
          select $1,$2::timestamptz,$3::timestamptz,$4::numeric,coalesce(sum(provider_cost),0),count(*) filter(where provider_cost is null),$5
          from api_usage_events where provider=$1 and credential_source='platform' and started_at >=$2::timestamptz and started_at<$3::timestamptz`,
          [body.provider, body.from, body.to, body.cost, body.evidence],
        );
      } else if (body.action === "limit") {
        orgId = body.orgId;
        await client.query(
          `insert into api_usage_limits(org_id,provider,feature,monthly_limit,warning_percent,paused,require_tenant_key)
          values($1,$2,$3,$4,$5,$6,$7) on conflict(coalesce(org_id::text,''),provider,feature) do update set
          monthly_limit=excluded.monthly_limit,warning_percent=excluded.warning_percent,paused=excluded.paused,
          require_tenant_key=excluded.require_tenant_key,updated_at=now()`,
          [
            body.orgId,
            body.provider,
            body.feature,
            body.amount,
            body.warning,
            body.paused,
            body.requireTenant,
          ],
        );
      } else if (body.action === "rate") {
        await client.query(
          `insert into api_usage_rates(provider,service,rates,evidence,max_request_cost) values($1,$2,$3,$4,$5)
          on conflict(provider,service) do update set rates=excluded.rates,evidence=excluded.evidence,max_request_cost=excluded.max_request_cost,updated_at=now()`,
          [
            body.provider,
            body.service,
            JSON.stringify(body.rates),
            body.evidence,
            body.maxCost,
          ],
        );
      } else {
        const { rows } = await client.query(
          "select * from api_usage_events where id=$1 for update",
          [body.id],
        );
        const row = rows[0];
        if (!row) throw new Error("Usage record not found.");
        orgId = row.org_id;
        if (row.batch_id)
          throw new Error(
            "This usage belongs to an invoice batch. Manage its invoice in Stripe.",
          );
        if (body.action === "reconcile") {
          if (
            !["review", "unbilled", "not_billable"].includes(row.billing_status)
          )
            throw new Error(
              "This record is already on a bill. Record a credit through billing before correcting it.",
            );
          if (row.provider_request_id) {
            const duplicate = await client.query(
              "select id from api_usage_events where provider=$1 and provider_request_id=$2 and id<>$3",
              [row.provider, row.provider_request_id, row.id],
            );
            if (duplicate.rows.length)
              throw new Error(
                "Duplicate provider request. Investigate before approving a charge.",
              );
          }
          await client.query(
            `update api_usage_events set provider_cost=$2,evidence=$3,
            billing_status=case when credential_source='tenant' then 'not_billable' when billing_accepted then 'unbilled' else 'review' end where id=$1`,
            [body.id, body.cost, body.evidence],
          );
        } else {
          const allowed: Record<string, string[]> = {
            unbilled: ["billed"],
            billed: ["paid", "credited"],
            paid: ["refunded"],
            credited: [],
            refunded: [],
          };
          if (
            !allowed[row.billing_status]?.includes(body.status) ||
            !row.billing_accepted ||
            row.provider_cost == null ||
            row.credential_source !== "platform"
          )
            throw new Error(
              "This billing change is not allowed. Confirm the cost and billing acceptance first.",
            );
          await client.query(
            "update api_usage_events set billing_status=$2,invoice_reference=$3 where id=$1",
            [body.id, body.status, body.reference],
          );
        }
      }
      await client.query(
        "insert into api_usage_audit(org_id,actor,action,details) values($1,$2,$3,$4)",
        [orgId, auth.email, body.action, JSON.stringify(body)],
      );
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof z.ZodError
            ? "Check the fields and try again."
            : (error as Error).message,
      },
      { status: 400 },
    );
  }
}
