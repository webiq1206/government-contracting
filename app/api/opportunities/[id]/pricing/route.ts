import { NextResponse } from "next/server";
import { requireOrgContext } from "@/lib/org-guard";
import { query, queryOne } from "@/lib/db";
import { enqueue } from "@/lib/queue";
import { logAgent } from "@/lib/logger";
import {
  PricingRowRejected,
  deletePricingRow,
  pricingRowsWithQuotes,
  savePricingRow,
} from "@/lib/pricing-rows";
import { tradeScopeKey } from "@/lib/domain/pricing-row";
import { opportunityMutationProblem } from "@/lib/domain/opportunity-lifecycle";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function pricingEditProblem(opportunityId: string, orgId: string): Promise<string | null> {
  const facts = await queryOne<{
    stage: string;
    status: string;
    pursuit_state: string | null;
    submission_state: string | null;
  }>(
    `select o.stage, o.status, o.pursuit_state,
            (select b.submission_state from bids b
              where b.opportunity_id=o.id and b.org_id=o.org_id
              order by b.created_at desc limit 1) as submission_state
       from opportunities o where o.id=$1 and o.org_id=$2`,
    [opportunityId, orgId]
  );
  if (!facts) return "That opportunity is not on this account.";
  return opportunityMutationProblem(
    {
      stage: facts.stage,
      status: facts.status,
      pursuitState: facts.pursuit_state,
      submissionState: facts.submission_state,
    },
    "pricing"
  );
}

async function queuePricingRebuild(opportunityId: string, orgId: string): Promise<boolean> {
  await query(
    `update bids set package_ready=false, audit_status='pending', updated_at=now()
      where opportunity_id=$1 and org_id=$2 and submission_state='package_ready'`,
    [opportunityId, orgId]
  );
  const jobId = await enqueue("bid-builder", { opportunityId }).catch(() => null);
  if (!jobId) {
    await query(
      `update opportunities set human_action_required=true
        where id=$1 and org_id=$2 and status='open'`,
      [opportunityId, orgId]
    );
  }
  return Boolean(jobId);
}

/** The pricing rows for one opportunity, with the older quote screen folded in. */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const ctx = await requireOrgContext({ capability: "view" });
  if (ctx instanceof NextResponse) return ctx;
  const rows = await pricingRowsWithQuotes(params.id, ctx.orgId);
  return NextResponse.json({ rows });
}

/**
 * Write one trade's pricing row.
 *
 * `price` rather than `view`: entering what a trade costs is the act that sets
 * the bid, and the role model already separates the person who may see the
 * numbers from the person who may set them.
 */
export async function PUT(req: Request, { params }: { params: { id: string } }) {
  const ctx = await requireOrgContext({ capability: "price" });
  if (ctx instanceof NextResponse) return ctx;
  const { user: auth, orgId } = ctx;

  const lifecycleProblem = await pricingEditProblem(params.id, orgId);
  if (lifecycleProblem) {
    return NextResponse.json({ error: lifecycleProblem }, { status: 409 });
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const trade = typeof body.trade === "string" ? body.trade : "";

  try {
    const row = await savePricingRow({
      orgId,
      opportunityId: params.id,
      trade,
      selectedSubId: str(body.selectedSubId),
      backupSubId: str(body.backupSubId),
      baseQuote: num(body.baseQuote),
      taxes: num(body.taxes),
      freight: num(body.freight),
      mobilization: num(body.mobilization),
      bonding: num(body.bonding),
      manualAdjustment: num(body.manualAdjustment),
      manualAdjustmentReason: str(body.manualAdjustmentReason),
      pendingComponents: Array.isArray(body.pendingComponents)
        ? (body.pendingComponents as unknown[]).filter((c): c is string => typeof c === "string")
        : [],
      alternates: body.alternates,
      exclusions: body.exclusions,
      paymentTerms: str(body.paymentTerms),
      quoteExpiresOn: str(body.quoteExpiresOn),
      availability: str(body.availability),
      leadTimeDays: int(body.leadTimeDays),
      confidence: typeof body.confidence === "string" ? body.confidence : "unknown",
      supportingDocumentId: str(body.supportingDocumentId),
      actor: auth.email,
    });
    const rebuildQueued = await queuePricingRebuild(params.id, orgId);
    await logAgent({
      agent: "operator",
      action: "pricing-row",
      opportunityId: params.id,
      level: "info",
      message: `Operator ${auth.email} saved the ${row.trade} pricing row.`,
    });
    return NextResponse.json({
      ok: true,
      row,
      rebuildQueued,
      warning: rebuildQueued
        ? null
        : "The pricing was saved, but the bid rebuild could not be queued. Resume automation, then run Bid Builder from this opportunity.",
    });
  } catch (err) {
    if (err instanceof PricingRowRejected) {
      return NextResponse.json({ error: err.reason }, { status: err.status });
    }
    throw err;
  }
}

/**
 * Remove one trade's row.
 *
 * Deleting a row does not delete the quotes behind it: a row that was
 * projected from the quote screen reappears on the next read, which is
 * correct. What is removed is the reviewed pricing, not the evidence.
 */
export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  const ctx = await requireOrgContext({ capability: "price" });
  if (ctx instanceof NextResponse) return ctx;

  const lifecycleProblem = await pricingEditProblem(params.id, ctx.orgId);
  if (lifecycleProblem) {
    return NextResponse.json({ error: lifecycleProblem }, { status: 409 });
  }

  const body = (await req.json().catch(() => ({}))) as { trade?: string; scopeKey?: string };
  const key = body.scopeKey?.trim() || (body.trade ? tradeScopeKey(body.trade) : "");
  if (!key) return NextResponse.json({ error: "Say which trade to remove." }, { status: 400 });

  const removed = await deletePricingRow(params.id, ctx.orgId, key);
  if (!removed) {
    return NextResponse.json(
      { error: "That pricing row no longer exists, or the opportunity changed before it could be removed." },
      { status: 409 }
    );
  }
  const rebuildQueued = await queuePricingRebuild(params.id, ctx.orgId);
  await logAgent({
    agent: "operator",
    action: "pricing-row-removed",
    opportunityId: params.id,
    level: "info",
    message: `Operator ${ctx.user.email} removed the ${body.trade ?? key} pricing row.`,
  });
  return NextResponse.json({
    ok: true,
    rebuildQueued,
    warning: rebuildQueued
      ? null
      : "The pricing row was removed, but the bid rebuild could not be queued. Resume automation, then run Bid Builder from this opportunity.",
  });
}

/**
 * An empty string is a cleared field, which is null. A missing key is also
 * null. Neither is the string "null", which is what a form posts when nobody
 * checks.
 */
function str(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s.length > 0 && s !== "null" && s !== "undefined" ? s : null;
}

/**
 * A blank money field is unknown, not zero.
 *
 * `Number("")` is 0, which is how an empty box becomes a free trade. Every
 * money field in this route goes through here for that reason.
 */
function num(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function int(v: unknown): number | null {
  const n = num(v);
  return n == null ? null : Math.round(n);
}
