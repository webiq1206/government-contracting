import { NextResponse } from "next/server";
import { requireOrgContext, notFoundResponse } from "@/lib/org-guard";
import { queryOne } from "@/lib/db";
import { enqueue } from "@/lib/queue";
import { logAgent } from "@/lib/logger";
import {
  VerificationRejected,
  acceptFindings,
  cancelVerification,
  lastFullVerificationAt,
  lastVerification,
  liveVerification,
  startVerification,
  verificationsFor,
} from "@/lib/reverification";
import {
  VERIFICATION_SCOPES,
  recommendScope,
  verificationKey,
  type VerificationScope,
} from "@/lib/domain/reverification";
import type { Opportunity } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** How old a full check may be before it stops counting. */
const FRESHNESS_HOURS = 72;
/** Inside this many hours of the close, a surprise is expensive. */
const SUBMISSION_WINDOW_HOURS = 96;

/**
 * What has been checked, and what should be checked next.
 *
 * The recommendation is computed rather than fixed, because the right answer
 * is different for a solicitation checked an hour ago and one that has never
 * been checked at all, and a button that always says the same thing teaches
 * people to ignore it.
 */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const ctx = await requireOrgContext({ capability: "view" });
  if (ctx instanceof NextResponse) return ctx;

  const opp = await queryOne<Opportunity>(
    `select * from opportunities where id = $1 and org_id = $2`,
    [params.id, ctx.orgId]
  );
  if (!opp) return notFoundResponse();

  const [runs, live, last, lastFullAt] = await Promise.all([
    verificationsFor(params.id, ctx.orgId),
    liveVerification(params.id, ctx.orgId),
    lastVerification(params.id, ctx.orgId),
    lastFullVerificationAt(params.id, ctx.orgId),
  ]);

  const hoursToClose = opp.deadline
    ? (new Date(opp.deadline).getTime() - Date.now()) / 3_600_000
    : null;

  const recommendation = recommendScope({
    now: new Date(),
    lastFullAt,
    freshnessHours: FRESHNESS_HOURS,
    // Derived from what the last run found rather than from a flag somebody
    // has to remember to set.
    amendmentDetected: (last?.findings ?? []).some(
      (f) => f.scope === "documents" && f.kind === "added"
    ),
    documentsChanged: (last?.findings ?? []).some(
      (f) => f.scope === "documents" && f.kind === "changed"
    ),
    conflictOpen: last?.state === "conflicts_found" && last.acceptedAt == null,
    approachingSubmission:
      hoursToClose != null && hoursToClose > 0 && hoursToClose <= SUBMISSION_WINDOW_HOURS,
  });

  return NextResponse.json({ runs, live, last, lastFullAt, recommendation });
}

/**
 * Start a check.
 *
 * The snapshot is taken here, before the job is queued, so the comparison has
 * something that predates every part of the run. Taking it inside the agent
 * would leave a window in which the record could move between the request and
 * the snapshot, which is a small window and exactly the kind that produces an
 * unreproducible report.
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const ctx = await requireOrgContext({ capability: "decide" });
  if (ctx instanceof NextResponse) return ctx;

  const opp = await queryOne<Opportunity>(
    `select * from opportunities where id = $1 and org_id = $2`,
    [params.id, ctx.orgId]
  );
  if (!opp) return notFoundResponse();

  const body = (await req.json().catch(() => ({}))) as { scope?: string };
  const scope = (VERIFICATION_SCOPES as readonly string[]).includes(body.scope ?? "")
    ? (body.scope as VerificationScope)
    : "full";

  try {
    const { run, alreadyRunning } = await startVerification({
      orgId: ctx.orgId,
      opportunityId: params.id,
      scope,
      requestedBy: ctx.user.email,
      snapshot: {
        title: opp.title,
        solicitationNumber: opp.solicitation_number,
        deadline: opp.deadline,
        naics: opp.naics_code,
        setAside: opp.set_aside_type,
        requiredTrades: opp.solicitation_analysis?.required_trades ?? [],
        complianceMatrix: opp.solicitation_analysis?.compliance_matrix ?? [],
      },
    });

    if (alreadyRunning) {
      // Not an error: the caller asked for something that is already happening,
      // and the useful answer is the run rather than a refusal.
      return NextResponse.json({ ok: true, run, alreadyRunning: true });
    }

    /*
     * An aborted pursuit may still be checked, and checking it must not
     * restart anything. The job carries no side effects beyond the
     * verification row, so this is a read-only action on a stopped bid.
     */
    await enqueue("reverify", {
      runId: run.id,
      opportunityId: params.id,
      scope,
      orgId: ctx.orgId,
    }, { singletonKey: verificationKey(params.id, scope), singletonSeconds: 3600 });

    await logAgent({
      agent: "operator",
      action: "reverify-requested",
      opportunityId: params.id,
      level: "info",
      message: `${ctx.user.email} asked for a ${scope.replace(/_/g, " ")} check against the source.`,
    });

    return NextResponse.json({ ok: true, run, alreadyRunning: false });
  } catch (err) {
    if (err instanceof VerificationRejected) {
      return NextResponse.json({ error: err.reason }, { status: 400 });
    }
    throw err;
  }
}

/** Accept what a run found, or cancel one that has not started. */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const ctx = await requireOrgContext({ capability: "decide" });
  if (ctx instanceof NextResponse) return ctx;

  const body = (await req.json().catch(() => ({}))) as {
    runId?: string;
    action?: "accept" | "cancel";
  };
  if (!body.runId) {
    return NextResponse.json({ error: "Say which check." }, { status: 400 });
  }

  if (body.action === "cancel") {
    const cancelled = await cancelVerification(body.runId, ctx.orgId);
    if (!cancelled) {
      return NextResponse.json(
        {
          error:
            "That check has already started. It will finish and record what it found; nothing it finds is applied on its own.",
        },
        { status: 409 }
      );
    }
    return NextResponse.json({ ok: true });
  }

  const accepted = await acceptFindings(body.runId, ctx.orgId, ctx.user.email);
  if (!accepted) {
    return NextResponse.json(
      { error: "That check has nothing outstanding to accept." },
      { status: 409 }
    );
  }
  await logAgent({
    agent: "operator",
    action: "reverify-accepted",
    opportunityId: params.id,
    level: "info",
    message: `${ctx.user.email} accepted what the source check found.`,
  });
  return NextResponse.json({ ok: true });
}
