import { NextResponse } from "next/server";
import { requireOrgContext } from "@/lib/org-guard";
import { incidentById, incidentHistory, openIncidents } from "@/lib/incidents";
import { runRecoveryCheck } from "@/lib/recovery";
import { INCIDENT_NEXT_ACTION, INCIDENT_STATE_LABEL } from "@/lib/domain/incident";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The open incidents for this account, and how each one got where it is.
 *
 * `test_detail` is deliberately absent from this response. It carries whatever
 * the provider said, which can name an account, an organization id, or a
 * request body, and an operator does not need it to decide what to do. The
 * plain-English `detail` is what they act on; the technical text stays for
 * support and platform admin.
 */
export async function GET() {
  const ctx = await requireOrgContext();
  if (ctx instanceof NextResponse) return ctx;

  const incidents = await openIncidents(ctx.orgId);
  const withHistory = await Promise.all(
    incidents.map(async (i) => ({
      id: i.id,
      state: i.state,
      stateLabel: INCIDENT_STATE_LABEL[i.state],
      nextAction: INCIDENT_NEXT_ACTION[i.state],
      cause: i.cause,
      severity: i.severity,
      provider: i.provider,
      startedAt: i.startedAt.toISOString(),
      failedCount: i.failedCount,
      requeuedCount: i.requeuedCount,
      completedCount: i.completedCount,
      remainingCount: i.remainingCount,
      lastAgentSuccessAt: i.lastAgentSuccessAt?.toISOString() ?? null,
      nextRunAt: i.nextRunAt?.toISOString() ?? null,
      recommendedAction: i.recommendedAction,
      repairAttempts: i.repairAttempts,
      recoveryOwner: i.recoveryOwner,
      // Whether a test has run, and whether it passed, are two facts. Null is
      // not false: a UI that reads "no test yet" as "test failed" tells
      // somebody their provider is broken when nothing has asked it anything.
      testRanAt: i.testRanAt?.toISOString() ?? null,
      testPassed: i.testPassed,
      recoveryNote: i.recoveryNote,
      history: (await incidentHistory(i.id, ctx.orgId)).map((h) => ({
        from: h.fromState,
        to: h.toState,
        label: INCIDENT_STATE_LABEL[h.toState],
        actor: h.actor,
        detail: h.detail,
        at: h.at.toISOString(),
      })),
    }))
  );
  return NextResponse.json({ incidents: withHistory });
}

/**
 * Run recovery check.
 *
 * POST /api/automation/recovery { incidentId }
 *
 * Takes `pause_automation`: this is the same class of decision as stopping and
 * starting the machine, and it can put hundreds of jobs back into the queue.
 * A viewer or an estimator should not be able to do it by accident.
 *
 * Never throws a provider error at the caller. A recovery that did not work is
 * an outcome to report, and the incident records the attempt either way.
 */
export async function POST(req: Request) {
  const ctx = await requireOrgContext({ capability: "pause_automation" });
  if (ctx instanceof NextResponse) return ctx;

  const body = (await req.json().catch(() => ({}))) as { incidentId?: string };
  const incidentId = (body.incidentId ?? "").trim();
  if (!incidentId) {
    return NextResponse.json({ error: "Name the incident to recover." }, { status: 400 });
  }
  // Scoped lookup before any work: an incident id is something a person can
  // put in a request body.
  const incident = await incidentById(incidentId, ctx.orgId);
  if (!incident) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (incident.state === "recovered") {
    return NextResponse.json(
      { error: "This incident is already closed. A new outage opens a new incident." },
      { status: 409 }
    );
  }

  const result = await runRecoveryCheck(incidentId, ctx.orgId, ctx.user.email);
  return NextResponse.json({
    incidentId: result.incidentId,
    state: result.state,
    stateLabel: INCIDENT_STATE_LABEL[result.state],
    nextAction: INCIDENT_NEXT_ACTION[result.state],
    // The operator-safe sentence, never the raw provider payload.
    testPassed: result.test.passed,
    testDetail: result.test.detail,
    plan: result.plan,
    requeued: result.requeued,
    skipped: result.skipped,
    remaining: result.remaining,
    confirmation: result.confirmation,
    message: result.message,
  });
}
