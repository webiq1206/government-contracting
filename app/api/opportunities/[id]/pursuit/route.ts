import { NextResponse } from "next/server";
import { requireOrgContext, findOrgRecord, notFoundResponse } from "@/lib/org-guard";
import { query, queryOne } from "@/lib/db";
import { pursuitImpact } from "@/lib/pursuit-impact";
import { logAgent } from "@/lib/logger";
import {
  abortRequestProblem,
  parsePursuitState,
  ABORT_REASON_LABEL,
  RESTART_REVALIDATION,
  type AbortReason,
} from "@/lib/domain/pursuit-state";
import { enqueue } from "@/lib/queue";
import {
  RESTART_REQUEUE_AGENTS,
  restartMayProceed,
} from "@/lib/domain/restart-revalidation";
import { startVerification } from "@/lib/reverification";
import { verificationKey } from "@/lib/domain/reverification";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * What aborting this pursuit would stop, and what it could not undo.
 *
 * GET /api/opportunities/[id]/pursuit
 *
 * Read before the confirmation is shown, so the operator is deciding against
 * counts rather than against an adjective. A dialog that only asks whether
 * they are sure is a speed bump; the question they are actually asking is what
 * happens if they do this.
 */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const ctx = await requireOrgContext({ capability: "outreach" });
  if (ctx instanceof NextResponse) return ctx;
  const owned = await findOrgRecord("opportunities", params.id, ctx.orgId, "id");
  if (!owned) return notFoundResponse();
  const impact = await pursuitImpact(params.id);
  if (!impact) return notFoundResponse();
  const row = await queryOne<{ pursuit_state: string; pursuit_reason: string | null }>(
    `select pursuit_state, pursuit_reason from opportunities where id = $1`,
    [params.id]
  );
  return NextResponse.json({
    state: parsePursuitState(row?.pursuit_state),
    reason: row?.pursuit_reason ?? null,
    impact,
  });
}

/**
 * Pause, resume, abort or restart a pursuit.
 *
 * POST /api/opportunities/[id]/pursuit
 * Body: { action: "pause" | "resume" | "abort" | "restart", reason?, note? }
 *
 * These four are separate actions with different effects, and the instructions
 * are explicit that they must not be treated as synonyms. Pausing preserves
 * everything and resumes where it stopped. Aborting is a decision that the
 * bid is not happening, and coming back from it is a restart rather than a
 * resume, because the solicitation may have been amended twice in between.
 *
 * None of them deletes anything. Every packet, reply, quote, document and log
 * line stays exactly where it was and stays readable; what changes is whether
 * automation may act.
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const ctx = await requireOrgContext({ capability: "outreach" });
  if (ctx instanceof NextResponse) return ctx;

  const opp = await findOrgRecord("opportunities", params.id, ctx.orgId, "id");
  if (!opp) return notFoundResponse();
  // Captured before the closure below: TypeScript cannot narrow `ctx` past the
  // early return once it is read inside a nested function.
  const actor = ctx.user.email;

  const body = (await req.json().catch(() => ({}))) as {
    action?: unknown;
    reason?: unknown;
    note?: unknown;
  };

  const current = await queryOne<{ pursuit_state: string; pursuit_version: number }>(
    `select pursuit_state, pursuit_version from opportunities where id = $1`,
    [params.id]
  );
  if (!current) return notFoundResponse();
  const state = parsePursuitState(current.pursuit_state);
  const note = typeof body.note === "string" ? body.note.trim().slice(0, 2000) : null;

  /** One shape for every transition, so none of them can forget the audit. */
  async function commit(
    next: "active" | "paused" | "aborted",
    reason: string | null,
    bumpVersion: boolean,
    message: string
  ) {
    await query(
      `update opportunities
          set pursuit_state = $2,
              pursuit_changed_at = now(),
              pursuit_changed_by = $3,
              pursuit_reason = $4,
              pursuit_note = $5,
              pursuit_version = pursuit_version + $6
        where id = $1`,
      [params.id, next, actor, reason, note, bumpVersion ? 1 : 0]
    );
    await logAgent({
      agent: "operator",
      action: `pursuit-${next === "active" ? (state === "aborted" ? "restarted" : "resumed") : next}`,
      level: "info",
      opportunityId: params.id,
      message,
    });
  }

  if (body.action === "pause") {
    if (state === "aborted") {
      return NextResponse.json(
        { error: "This pursuit was aborted. Restart it rather than pausing it." },
        { status: 409 }
      );
    }
    await commit("paused", null, false, `Pursuit paused by ${actor}. Nothing automatic will run for it until it is resumed.`);
    return NextResponse.json({ ok: true, state: "paused" });
  }

  if (body.action === "resume") {
    if (state !== "paused") {
      /*
       * Deliberately refuses to resume an aborted pursuit rather than quietly
       * doing a restart. Resuming reuses everything as it stands; that is the
       * one thing an abort must not allow, because the packets and scoring it
       * would revive were built against a solicitation that has had weeks to
       * move on.
       */
      return NextResponse.json(
        {
          error:
            state === "aborted"
              ? "An aborted pursuit is restarted, not resumed, so its facts are rechecked before anything is sent."
              : "This pursuit is already running.",
          restartChecks: state === "aborted" ? RESTART_REVALIDATION : undefined,
        },
        { status: 409 }
      );
    }
    await commit("active", null, false, `Pursuit resumed by ${actor}.`);
    return NextResponse.json({ ok: true, state: "active" });
  }

  if (body.action === "abort") {
    const problem = abortRequestProblem({ reason: body.reason, note: body.note });
    if (problem) return NextResponse.json({ error: problem }, { status: 400 });
    const reason = body.reason as AbortReason;
    if (state === "aborted") {
      // Idempotent: repeating an abort must not duplicate events or bump the
      // version again, which would make an unrelated restart look stale.
      return NextResponse.json({ ok: true, state: "aborted", alreadyAborted: true });
    }
    await commit(
      "aborted",
      reason,
      true,
      `Pursuit aborted by ${actor}: ${ABORT_REASON_LABEL[reason]}${note ? `. ${note}` : ""}. ` +
        `No further automatic work runs for it. Everything already sent stands and cannot be recalled; ` +
        `everything received is kept and readable.`
    );
    const { stopOpportunityAutomation } = await import("@/lib/close-opportunity-work");
    await stopOpportunityAutomation(ctx.orgId, [params.id], "aborted");
    return NextResponse.json({ ok: true, state: "aborted", reason });
  }

  if (body.action === "restart") {
    if (state === "active") {
      return NextResponse.json({ error: "This pursuit is already running." }, { status: 409 });
    }
    const facts = await queryOne<{
      status: string;
      stage: string;
      deadline: string | null;
      title: string | null;
      solicitation_number: string | null;
      naics_code: string | null;
      set_aside_type: string | null;
      solicitation_analysis: {
        required_trades?: unknown;
        compliance_matrix?: unknown;
      } | null;
    }>(
      `select status, stage, deadline::text as deadline, title, solicitation_number,
              naics_code, set_aside_type, solicitation_analysis
         from opportunities where id = $1`,
      [params.id]
    );
    const gate = restartMayProceed({
      status: facts?.status,
      stage: facts?.stage,
      deadline: facts?.deadline,
    });
    if (!gate.ok) {
      return NextResponse.json({ error: gate.error }, { status: 409 });
    }
    /*
     * The version bump is what stops a restart reviving the work the abort
     * stopped. A job queued before the abort carries the old version; anything
     * created after this carries the new one.
     */
    await commit(
      "active",
      null,
      true,
      `Pursuit restarted by ${actor}. Its facts are rechecked before anything is sent: ${RESTART_REVALIDATION.join("; ")}.`
    );

    const queued: string[] = [];
    if (facts) {
      try {
        const { run, alreadyRunning } = await startVerification({
          orgId: ctx.orgId,
          opportunityId: params.id,
          scope: "full",
          requestedBy: actor,
          snapshot: {
            title: facts.title,
            solicitationNumber: facts.solicitation_number,
            deadline: facts.deadline,
            naics: facts.naics_code,
            setAside: facts.set_aside_type,
            requiredTrades: facts.solicitation_analysis?.required_trades ?? [],
            complianceMatrix: facts.solicitation_analysis?.compliance_matrix ?? [],
          },
        });
        if (!alreadyRunning) {
          await enqueue(
            "reverify",
            {
              runId: run.id,
              opportunityId: params.id,
              scope: "full",
              orgId: ctx.orgId,
            },
            { singletonKey: verificationKey(params.id, "full"), singletonSeconds: 3600 }
          );
        }
        queued.push("reverify");
      } catch (err) {
        await logAgent({
          agent: "operator",
          action: "pursuit-restart-reverify-failed",
          level: "warn",
          opportunityId: params.id,
          message: `Restart is active, but the source check did not queue: ${(err as Error).message}`,
        }).catch(() => {});
      }
    }
    for (const agent of RESTART_REQUEUE_AGENTS) {
      await enqueue(agent, { opportunityId: params.id });
      queued.push(agent);
    }

    return NextResponse.json({
      ok: true,
      state: "active",
      revalidation: RESTART_REVALIDATION,
      queued,
      /*
       * Said out loud rather than assumed. A restart that silently resumed
       * outreach would be the one-click resume the instructions rule out.
       */
      note: "Nothing is sent until the rebuilt packets are approved.",
    });
  }

  return NextResponse.json(
    { error: 'action must be one of "pause", "resume", "abort", "restart".' },
    { status: 400 }
  );
}
