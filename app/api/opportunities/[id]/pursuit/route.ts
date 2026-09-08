import { NextResponse } from "next/server";
import { requireOrgContext, findOrgRecord, notFoundResponse } from "@/lib/org-guard";
import { query, queryOne, transaction } from "@/lib/db";
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
  const organizationId = ctx.orgId;

  const body = (await req.json().catch(() => ({}))) as {
    action?: unknown;
    reason?: unknown;
    note?: unknown;
  };

  const current = await queryOne<{
    pursuit_state: string;
    pursuit_version: number;
    stage: string;
    status: string;
  }>(
    `select pursuit_state, pursuit_version, stage, status
       from opportunities where id = $1 and org_id = $2`,
    [params.id, ctx.orgId]
  );
  if (!current) return notFoundResponse();
  const currentPursuitState = current.pursuit_state;
  const currentPursuitVersion = current.pursuit_version;
  const currentStage = current.stage;
  const currentStatus = current.status;
  const state = parsePursuitState(current.pursuit_state);
  const note = typeof body.note === "string" ? body.note.trim().slice(0, 2000) : null;

  const knownAction = ["pause", "resume", "abort", "restart"].includes(String(body.action));
  if (knownAction && ["submitted", "won", "lost"].includes(current.stage)) {
    return NextResponse.json(
      {
        error:
          current.stage === "submitted"
            ? "This bid was already sent. Record the agency outcome instead of changing its pursuit state."
            : "This opportunity has a final outcome and its pursuit state is read-only.",
      },
      { status: 409 }
    );
  }
  if (knownAction && body.action !== "restart" && current.status !== "open") {
    return NextResponse.json(
      { error: "This opportunity is closed. Restore it before changing its pursuit state." },
      { status: 409 }
    );
  }

  /** One shape for every transition, so none of them can forget the audit. */
  async function commit(
    next: "active" | "paused" | "aborted",
    reason: string | null,
    bumpVersion: boolean,
    message: string
  ): Promise<{ ok: boolean; error?: string; status?: number; warnings: string[] }> {
    let changed = false;
    try {
      changed = await transaction(async (client) => {
        const result = await client.query<{ id: string }>(
          `update opportunities
              set pursuit_state = $2,
                  pursuit_changed_at = now(),
                  pursuit_changed_by = $3,
                  pursuit_reason = $4,
                  pursuit_note = $5,
                  pursuit_version = pursuit_version + $6
            where id = $1 and org_id = $7
              and pursuit_state = $8 and pursuit_version = $9
              and stage = $10 and status = $11
            returning id`,
          [
            params.id,
            next,
            actor,
            reason,
            note,
            bumpVersion ? 1 : 0,
            organizationId,
            currentPursuitState,
            currentPursuitVersion,
            currentStage,
            currentStatus,
          ]
        );
        if (result.rows.length === 0) return false;

        // A restart must get a fresh verification run. Any live run belongs
        // to the version that was aborted and its queued worker is fenced too.
        if (next === "active" && bumpVersion) {
          await client.query(
            `update bids
                set package_ready=false,
                    audit_status='pending',
                    human_flags=(
                      select array(
                        select distinct unnest(
                          coalesce(human_flags, '{}'::text[])
                          || array['restart_revalidation_pending']
                        )
                      )
                    ),
                    updated_at=now()
              where opportunity_id=$1 and org_id=$2
                and submission_state='package_ready'`,
            [params.id, organizationId]
          );
          await client.query(
            `update solicitation_verifications
                set state='stale', finished_at=coalesce(finished_at, now()),
                    error=coalesce(error, 'Superseded by a pursuit restart.')
              where opportunity_id=$1 and org_id=$2
                and state in ('queued','in_progress')`,
            [params.id, organizationId]
          );
        }
        return true;
      });
    } catch (error) {
      await logAgent({
        agent: "operator",
        action: "pursuit-transition-failed",
        level: "error",
        status: "error",
        opportunityId: params.id,
        message: `The pursuit transition was rolled back: ${(error as Error).message}`,
      }).catch(() => {});
      return {
        ok: false,
        status: 500,
        error: "The pursuit state could not be saved. Nothing changed. Refresh and try again.",
        warnings: [],
      };
    }
    if (!changed) {
      return {
        ok: false,
        status: 409,
        error: "The pursuit changed before this action completed. Refresh and try again.",
        warnings: [],
      };
    }
    const warnings: string[] = [];
    await logAgent({
      agent: "operator",
      action: `pursuit-${next === "active" ? (state === "aborted" ? "restarted" : "resumed") : next}`,
      level: "info",
      opportunityId: params.id,
      message,
    }).catch(() => {
      warnings.push(
        "The pursuit state changed, but its activity log entry could not be written. The state change itself is intact."
      );
    });
    return { ok: true, warnings };
  }

  if (body.action === "pause") {
    if (state === "aborted") {
      return NextResponse.json(
        { error: "This pursuit was aborted. Restart it rather than pausing it." },
        { status: 409 }
      );
    }
    const saved = await commit(
      "paused",
      null,
      false,
      `Pursuit paused by ${actor}. Nothing automatic will run for it until it is resumed.`
    );
    if (!saved.ok) {
      return NextResponse.json({ error: saved.error }, { status: saved.status ?? 409 });
    }
    return NextResponse.json({ ok: true, state: "paused", warnings: saved.warnings });
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
    const saved = await commit("active", null, false, `Pursuit resumed by ${actor}.`);
    if (!saved.ok) {
      return NextResponse.json({ error: saved.error }, { status: saved.status ?? 409 });
    }
    return NextResponse.json({ ok: true, state: "active", warnings: saved.warnings });
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
    const saved = await commit(
      "aborted",
      reason,
      true,
      `Pursuit aborted by ${actor}: ${ABORT_REASON_LABEL[reason]}${note ? `. ${note}` : ""}. ` +
        `No further automatic work runs for it. Everything already sent stands and cannot be recalled; ` +
        `everything received is kept and readable.`
    );
    if (!saved.ok) {
      return NextResponse.json({ error: saved.error }, { status: saved.status ?? 409 });
    }
    const { stopOpportunityAutomation } = await import("@/lib/close-opportunity-work");
    await stopOpportunityAutomation(ctx.orgId, [params.id], "aborted").catch(async (error) => {
      const warning =
        "The pursuit was aborted, but pending follow-ups could not be cleared. Pause account automation and contact support.";
      saved.warnings.push(warning);
      await logAgent({
        agent: "operator",
        action: "pursuit-abort-cleanup-failed",
        level: "error",
        status: "error",
        opportunityId: params.id,
        message: `${warning} ${(error as Error).message}`,
      }).catch(() => {});
    });
    return NextResponse.json({
      ok: true,
      state: "aborted",
      reason,
      warnings: saved.warnings,
    });
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
         from opportunities where id = $1 and org_id = $2`,
      [params.id, ctx.orgId]
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
    const restarted = await commit(
      "active",
      null,
      true,
      `Pursuit restarted by ${actor}. Its facts are rechecked before anything is sent: ${RESTART_REVALIDATION.join("; ")}.`
    );
    if (!restarted.ok) {
      return NextResponse.json(
        { error: restarted.error },
        { status: restarted.status ?? 409 }
      );
    }

    const queued: string[] = [];
    const warnings = [...restarted.warnings];
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
          const jobId = await enqueue(
            "reverify",
            {
              runId: run.id,
              opportunityId: params.id,
              scope: "full",
              orgId: ctx.orgId,
            },
            { singletonKey: verificationKey(params.id, "full"), singletonSeconds: 3600 }
          ).catch(() => null);
          if (!jobId) {
            await query(
              `update solicitation_verifications
                  set state='failed', finished_at=now(),
                      error='The restart verification job could not be queued.'
                where id=$1 and org_id=$2 and state='queued'`,
              [run.id, ctx.orgId]
            ).catch(() => {});
            warnings.push(
              "The pursuit restarted, but its source verification could not be queued. Pause the pursuit and contact support before relying on the rebuilt work."
            );
          } else {
            queued.push("reverify");
          }
        } else {
          queued.push("reverify");
        }
      } catch (err) {
        warnings.push(
          "The pursuit restarted, but its source verification could not be queued. Pause the pursuit and contact support before relying on the rebuilt work."
        );
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
      const jobId = await enqueue(agent, { opportunityId: params.id }).catch(() => null);
      if (jobId) queued.push(agent);
      else {
        warnings.push(
          `${agent.replace(/-/g, " ")} could not be queued. Resume automation and run it from this opportunity before relying on the restart.`
        );
      }
    }

    return NextResponse.json({
      ok: true,
      state: "active",
      revalidation: RESTART_REVALIDATION,
      queued,
      warnings,
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
