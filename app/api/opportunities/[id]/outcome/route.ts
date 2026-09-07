import { NextResponse } from "next/server";
import { requireOrgContext } from "@/lib/org-guard";
import { queryOne, transaction } from "@/lib/db";
import { enqueue } from "@/lib/queue";
import { logAgent } from "@/lib/logger";
import { stopOpportunityAutomation } from "@/lib/close-opportunity-work";
import {
  outcomeDetailsProblem,
  outcomeProblem,
  type OutcomeDetails,
} from "@/lib/domain/opportunity-lifecycle";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Outcome = OutcomeDetails["outcome"];

interface OutcomeRow {
  id: string;
  stage: string;
  status: string;
  pursuit_state: string | null;
  bid_id: string;
  bid_outcome: string | null;
  submission_state: string;
}

class OutcomeConflict extends Error {}

/** Record an agency outcome only for a bid whose delivery was already proven. */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const ctx = await requireOrgContext({ capability: "manage_contracts" });
  if (ctx instanceof NextResponse) return ctx;
  const { orgId, user } = ctx;

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const outcome = String(body.outcome ?? "") as Outcome;
  if (!["won", "lost", "no_award"].includes(outcome)) {
    return NextResponse.json({ error: "Choose Won, Lost, or No award." }, { status: 400 });
  }

  const details: OutcomeDetails = {
    outcome,
    awardAmount: money(body.award_amount),
    contractNumber: text(body.contract_number),
    startDate: text(body.start_date),
    endDate: text(body.end_date),
    lossReason: text(body.loss_reason),
  };
  const detailProblem = outcomeDetailsProblem(details);
  if (detailProblem) return NextResponse.json({ error: detailProblem }, { status: 400 });

  const initial = await queryOne<OutcomeRow>(
    `select o.id, o.stage, o.status, o.pursuit_state,
            b.id as bid_id, b.outcome as bid_outcome, b.submission_state
       from opportunities o
       join bids b on b.opportunity_id=o.id and b.org_id=o.org_id
      where o.id=$1 and o.org_id=$2
      order by b.created_at desc limit 1`,
    [params.id, orgId]
  );
  if (!initial) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (sameRecordedOutcome(initial, outcome)) {
    return NextResponse.json({ ok: true, outcome, alreadyRecorded: true });
  }
  const firstProblem = outcomeProblem(
    {
      stage: initial.stage,
      status: initial.status,
      pursuitState: initial.pursuit_state,
      submissionState: initial.submission_state,
    },
    outcome
  );
  if (firstProblem) return NextResponse.json({ error: firstProblem }, { status: 409 });

  let newContractId: string | null = null;
  let alreadyRecorded = false;
  try {
    await transaction(async (client) => {
      const locked = await client.query<OutcomeRow>(
        `select o.id, o.stage, o.status, o.pursuit_state,
                b.id as bid_id, b.outcome as bid_outcome, b.submission_state
           from opportunities o
           join bids b on b.opportunity_id=o.id and b.org_id=o.org_id
          where o.id=$1 and o.org_id=$2
          order by b.created_at desc limit 1
          for update of o, b`,
        [params.id, orgId]
      );
      const current = locked.rows[0];
      if (!current) throw new OutcomeConflict("The opportunity no longer exists.");
      if (sameRecordedOutcome(current, outcome)) {
        alreadyRecorded = true;
        return;
      }

      const currentProblem = outcomeProblem(
        {
          stage: current.stage,
          status: current.status,
          pursuitState: current.pursuit_state,
          submissionState: current.submission_state,
        },
        outcome
      );
      if (currentProblem) throw new OutcomeConflict(currentProblem);

      const bidChanged = await client.query<{ id: string }>(
        `update bids
            set outcome=$3, award_amount=$4, loss_reason=$5, updated_at=now()
          where id=$1 and org_id=$2
            and coalesce(outcome, 'pending')='pending'
            and submission_state=$6
          returning id`,
        [
          current.bid_id,
          orgId,
          outcome,
          outcome === "won" ? details.awardAmount : null,
          outcome === "won" ? null : details.lossReason,
          current.submission_state,
        ]
      );
      if (bidChanged.rows.length === 0) {
        throw new OutcomeConflict(
          "The bid changed before the outcome was recorded. Refresh it and check the current result."
        );
      }

      const finalStage = outcome === "won" ? "won" : "lost";
      const opportunityChanged = await client.query<{ id: string }>(
        `update opportunities
            set stage=$3, status='closed', human_action_required=false
          where id=$1 and org_id=$2 and stage='submitted' and status='open'
          returning id`,
        [params.id, orgId, finalStage]
      );
      if (opportunityChanged.rows.length === 0) {
        throw new OutcomeConflict(
          "The opportunity changed before the outcome was recorded. Refresh it and check the current result."
        );
      }

      if (outcome === "won") {
        const created = await client.query<{ id: string }>(
          `insert into contracts
             (org_id, bid_id, opportunity_id, contract_number, award_amount,
              start_date, end_date, cpars_due_at, cpars_status, status)
           values ($1,$2,$3,$4,$5,$6::date,$7::date,$7::date + 7,'pending','active')
           returning id`,
          [
            orgId,
            current.bid_id,
            params.id,
            details.contractNumber!.trim(),
            details.awardAmount,
            details.startDate,
            details.endDate,
          ]
        );
        newContractId = created.rows[0]?.id ?? null;
        if (!newContractId) throw new OutcomeConflict("The contract record could not be created.");
      }
    });
  } catch (error) {
    if (error instanceof OutcomeConflict) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    await logAgent({
      agent: "operator",
      action: "award-outcome-failed",
      opportunityId: params.id,
      bidId: initial.bid_id,
      level: "error",
      status: "error",
      message: `The outcome transaction was rolled back: ${(error as Error).message}`,
    }).catch(() => {});
    return NextResponse.json(
      {
        error:
          "The agency outcome could not be saved. No outcome or contract was recorded. Refresh the opportunity and try again after the database connection recovers.",
      },
      { status: 503 }
    );
  }

  if (alreadyRecorded) {
    return NextResponse.json({ ok: true, outcome, alreadyRecorded: true });
  }

  const warnings: string[] = [];
  await stopOpportunityAutomation(orgId, [params.id], outcome === "won" ? "won" : "lost").catch(
    async (error: unknown) => {
      const warning =
        "The outcome was recorded, but scheduled bid follow-ups could not be cleared. Pause automation and contact support.";
      warnings.push(warning);
      await logAgent({
        agent: "operator",
        action: "outcome-cleanup-failed",
        opportunityId: params.id,
        level: "error",
        status: "error",
        message: `${warning} ${(error as Error).message}`,
      }).catch(() => {});
    }
  );

  if (newContractId) {
    const { seedContractStartup } = await import("@/lib/contract-record");
    await seedContractStartup({ orgId, contractId: newContractId }).catch(
      async (error: unknown) => {
        const warning =
          "The win and contract were recorded, but the startup checklist could not be created. Open the contract and add the missing milestones.";
        warnings.push(warning);
        await logAgent({
          agent: "operator",
          action: "contract-startup-failed",
          opportunityId: params.id,
          level: "error",
          status: "error",
          message: `${warning} ${(error as Error).message}`,
        }).catch(() => {});
      }
    );
  }

  const jobs =
    outcome === "won"
      ? ([
          ["analytics-engine", {}],
          ["sub-onboarding", { opportunityId: params.id }],
        ] as const)
      : ([
          ["learning-loop", {}],
          ["analytics-engine", {}],
        ] as const);
  for (const [agent, payload] of jobs) {
    const queued = await enqueue(agent, payload, {
      orgId,
      ...(agent === "sub-onboarding"
        ? {
            allowClosedOpportunity: true,
            singletonKey: `won-sub-onboarding:${params.id}`,
            singletonSeconds: 24 * 60 * 60,
          }
        : {}),
    }).catch(() => null);
    if (!queued) {
      warnings.push(
        `${agent.replace(/-/g, " ")} was not queued. The outcome is safe, but automation may be paused and should be resumed.`
      );
    }
  }

  await logAgent({
    agent: "operator",
    action: `award-${outcome}`,
    opportunityId: params.id,
    bidId: initial.bid_id,
    level: outcome === "won" ? "success" : "info",
    message:
      outcome === "won"
        ? `WON. ${user.email} recorded contract ${details.contractNumber}, ${details.startDate} through ${details.endDate}.`
        : `${outcome === "lost" ? "LOST" : "NO AWARD"}: ${details.lossReason}`,
  }).catch(() => {
    warnings.push(
      "The outcome was recorded, but its activity log entry could not be written. The bid and contract records are still intact."
    );
  });

  return NextResponse.json({ ok: true, outcome, contractId: newContractId, warnings });
}

function sameRecordedOutcome(row: OutcomeRow, outcome: Outcome): boolean {
  const expectedStage = outcome === "won" ? "won" : "lost";
  return row.status === "closed" && row.stage === expectedStage && row.bid_outcome === outcome;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function money(value: unknown): number | null {
  if (value == null || value === "") return null;
  const parsed = Number(String(value).replace(/[$,\s]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}
