import { readBudget, saveBudget } from "@/lib/api-usage/budgets";
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
    const [
      usage,
      tenants,
      reports,
      rates,
      batches,
      billingSettings,
      syncRuns,
      adjustments,
      budget,
    ] = await Promise.all([
      readUsage(new URL(req.url).searchParams),
      query("select id,name from organizations order by name"),
      query(
        "select id,provider,starts_at::text,ends_at::text,reported_cost::text,tracked_cost::text,unknown_calls,evidence from api_usage_provider_reports order by created_at desc limit 25",
      ),
      query(
        "select provider,service,rates,max_request_cost::text,evidence,updated_at::text from api_usage_rates order by provider,service",
      ),
      query(
        "select b.*,o.name as tenant from api_usage_invoice_batches b join organizations o on o.id=b.org_id order by b.created_at desc limit 100",
      ),
      query("select * from api_usage_billing_settings"),
      query(
        "select * from api_usage_sync_runs order by created_at desc limit 25",
      ),
      query(
        "select * from api_usage_adjustments order by created_at desc limit 50",
      ),
      auth.organizationId
        ? readBudget(auth.organizationId)
        : Promise.resolve(null),
    ]);
    return NextResponse.json({
      ...usage,
      tenants,
      reports,
      rates,
      batches,
      billingSettings,
      syncRuns,
      adjustments,
      budget,
    });
  } catch (error) {
    if ((error as Error)?.name === "UsageFilterError")
      return NextResponse.json(
        { error: (error as Error).message },
        { status: 400 },
      );
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
    action: z.literal("syncAdjustment"),
    id: z.string().uuid(),
    creditNoteId: z
      .string()
      .regex(/^cn_[A-Za-z0-9]+$/)
      .optional(),
  }),
  z.object({
    action: z.literal("external"),
    records: z
      .array(
        z.object({
          id: z.string().uuid(),
          orgId: z.string().uuid(),
          provider: z.string().min(1).max(100),
          service: z.string().min(1).max(150),
          feature: z.string().min(1).max(150),
          requestId: z.string().min(1).max(200),
          occurredAt: z.string().datetime(),
          cost: z.string(),
          source: z.enum(["platform", "tenant"]),
          envKey: z.string().max(100).optional(),
          evidence: z.string().min(5).max(1000),
        }),
      )
      .min(1)
      .max(500),
  }),
  z.object({
    action: z.literal("sync"),
    provider: z.enum(["Anthropic", "Twilio"]),
  }),
  z.object({
    action: z.literal("receipts"),
    receipts: z
      .array(
        z.object({
          id: z.string().uuid(),
          provider: z.string().min(1).max(100),
          requestId: z.string().min(1).max(200),
          cost: z.string(),
          evidence: z.string().min(5).max(1000),
        }),
      )
      .min(1)
      .max(500),
  }),
  z.object({
    action: z.literal("automatic"),
    orgId: z.string().uuid(),
    enabled: z.boolean(),
  }),
  z.object({ action: z.literal("syncPeriod"), orgId: z.string().uuid() }),
  z.object({
    action: z.literal("finalize"),
    orgId: z.string().uuid(),
    batchId: z.string().uuid(),
  }),
  z.object({
    action: z.literal("adjust"),
    id: z.string().uuid(),
    orgId: z.string().uuid(),
    batchId: z.string().uuid(),
    amountCents: z.number().int().positive().max(100000000),
    kind: z.enum(["credit", "refund"]),
    reason: z.string().min(5).max(500),
  }),
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
    dailyRequests: z.number().int().min(0).max(1000000).nullable().optional(),
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
    const input = await req.json();
    if (input.action === "budget") {
      const orgId = z
        .string()
        .uuid()
        .parse(input.orgId ?? auth.organizationId);
      try {
        await saveBudget(orgId, auth.email, input.budget);
      } catch {
        return NextResponse.json(
          {
            error:
              "Your spending limits were not saved. Check the amounts and try again.",
          },
          { status: 400 },
        );
      }
      return NextResponse.json({ ok: true });
    }
    const body = schema.parse(input);
    if (body.action === "syncAdjustment") {
      const { syncUsageAdjustment } = await import("@/lib/api-usage/billing");
      return NextResponse.json({
        ok: true,
        settlement: await syncUsageAdjustment(body.id, body.creditNoteId),
      });
    }
    if (body.action === "external") {
      const { importExternalUsage } = await import(
        "@/lib/api-usage/reconciliation"
      );
      return NextResponse.json({
        ok: true,
        count: await importExternalUsage(body.records, auth.email),
      });
    }
    if (body.action === "sync") {
      const { syncProviderCosts } = await import(
        "@/lib/api-usage/reconciliation"
      );
      return NextResponse.json({
        ok: true,
        count: await syncProviderCosts(body.provider),
      });
    }
    if (body.action === "receipts") {
      const { reconcileReceipts } = await import(
        "@/lib/api-usage/reconciliation"
      );
      return NextResponse.json({
        ok: true,
        count: await reconcileReceipts(body.receipts, auth.email),
      });
    }
    if (
      ["automatic", "syncPeriod", "finalize", "adjust"].includes(body.action)
    ) {
      const { syncBillingPeriod, finalizeUsageInvoice, adjustUsageInvoice } =
        await import("@/lib/api-usage/billing");
      if (body.action === "automatic") {
        if (body.enabled) await syncBillingPeriod(body.orgId);
        await transaction(async (c) => {
          await c.query(
            `insert into api_usage_billing_settings(org_id,automatic,enabled_at) values($1,$2,case when $2 then now() end) on conflict(org_id) do update set automatic=excluded.automatic,enabled_at=case when not api_usage_billing_settings.automatic and excluded.automatic then now() else api_usage_billing_settings.enabled_at end,updated_at=now()`,
            [body.orgId, body.enabled],
          );
          await c.query(
            "insert into api_usage_audit(org_id,actor,action,details) values($1,$2,'automatic_billing_changed',$3)",
            [body.orgId, auth.email, JSON.stringify({ enabled: body.enabled })],
          );
        });
        return NextResponse.json({ ok: true });
      }
      if (body.action === "syncPeriod")
        return NextResponse.json({
          ok: true,
          period: await syncBillingPeriod(body.orgId),
        });
      if (body.action === "finalize")
        return NextResponse.json({
          ok: true,
          invoiceId: await finalizeUsageInvoice(
            body.orgId,
            body.batchId,
            auth.email,
          ),
        });
      if (body.action === "adjust")
        return NextResponse.json({
          ok: true,
          creditNote: await adjustUsageInvoice(body, auth.email),
        });
    }
    if (body.action === "invoice") {
      const { createUsageInvoice } = await import("@/lib/api-usage/invoice");
      return NextResponse.json({
        ok: true,
        invoiceId: await createUsageInvoice(body.orgId, auth.email),
      });
    }
    if (
      body.action === "automatic" ||
      body.action === "syncPeriod" ||
      body.action === "finalize" ||
      body.action === "adjust"
    )
      throw new Error("Unsupported action.");
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
          `insert into api_usage_limits(org_id,provider,feature,monthly_limit,warning_percent,paused,require_tenant_key,daily_requests)
          values($1,$2,$3,$4,$5,$6,$7,$8) on conflict(coalesce(org_id::text,''),provider,feature) do update set
          monthly_limit=excluded.monthly_limit,warning_percent=excluded.warning_percent,paused=excluded.paused,
          require_tenant_key=excluded.require_tenant_key,daily_requests=excluded.daily_requests,updated_at=now()`,
          [
            body.orgId,
            body.provider,
            body.feature,
            body.amount,
            body.warning,
            body.paused,
            body.requireTenant,
            body.dailyRequests ?? null,
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
