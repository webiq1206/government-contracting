import { NextResponse } from "next/server";
import { requireOrgContext } from "@/lib/org-guard";
import { query, queryOne } from "@/lib/db";
import { getProfileJson } from "@/lib/ai/companyProfile";
import { logAgent } from "@/lib/logger";
import { currentRequirementsFingerprint } from "@/lib/bid-package-state";
import {
  mayOverride,
  overrideProblem,
  overrideRisk,
  overrideSummary,
  OVERRIDE_PROBLEM_MESSAGE,
} from "@/lib/domain/override";
import { pricingRowsWithQuotes, freezeCalculation } from "@/lib/pricing-rows";
import { pricingSheet } from "@/lib/domain/pricing-row";
import { bidMath, explainBidMath } from "@/lib/domain/trade-pricing";
import type { Opportunity } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Operator submits the reviewed bid package. Guards the submit-lead-hours rule + prime_only block. */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const ctx = await requireOrgContext({ capability: "submit" });
  if (ctx instanceof NextResponse) return ctx;
  const { user: auth, orgId } = ctx;
  /*
   * An override is a decision with a name against it, not a boolean.
   *
   * `force: true` used to be enough. It got a package past the lead-hours rule
   * and past a package not marked ready, and left a log line saying somebody
   * submitted; nothing recorded which warning was overridden, why, or what the
   * person believed at the time. A contracting officer asking six weeks later
   * why a bid went out ninety minutes before close has a fair question, and
   * "somebody passed force" is not an answer.
   *
   * The old shape is still accepted at the type level and rejected at the
   * gate: a request carrying `force` with no reason gets told what is missing
   * rather than silently doing nothing.
   */
  const body = (await req.json().catch(() => ({}))) as {
    force?: boolean;
    override?: { requirement?: string; reason?: string };
  };
  const overrideReq = {
    requirement: body.override?.requirement ?? "",
    reason: body.override?.reason ?? "",
  };
  const wantsOverride = Boolean(body.force) || Boolean(body.override);
  const overrideOk = wantsOverride && mayOverride(overrideReq);
  const force = overrideOk;

  const opp = await queryOne<Opportunity>(`select * from opportunities where id=$1 and org_id=$2`, [params.id, orgId]);
  if (!opp) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const bid = await queryOne<{
    id: string;
    human_flags: string[];
    qa_checklist: { ok: boolean }[] | null;
    package_ready: boolean;
    validation_json: { blockers?: string[] } | null;
    requirements_fingerprint: string | null;
    audit_findings: { severity: string; acknowledged?: boolean; finding: string }[] | null;
    bid_amount: string | null;
  }>(
    `select id, human_flags, qa_checklist, package_ready, validation_json, audit_findings,
            requirements_fingerprint, bid_amount
       from bids where opportunity_id=$1 order by created_at desc limit 1`,
    [params.id]
  );
  if (!bid) return NextResponse.json({ error: "No bid package to submit." }, { status: 400 });

  /**
   * The requirements must not have moved since the package was assembled.
   *
   * `package_ready` is a stored verdict. Re-running the analyst after an
   * amendment rewrites the compliance matrix on the opportunity and never
   * touches the bid, so nothing recomputed that verdict: the package stayed
   * "ready" while the requirements underneath it changed, and submitting sent
   * a package built against superseded instructions. Checked here rather than
   * only in validation because this is the last gate before it goes out, and
   * force must NOT override it: forcing past a known-outdated package is not
   * a judgement call an operator can make from this screen.
   */
  const built = bid.requirements_fingerprint;
  const current = currentRequirementsFingerprint(opp);
  if (built && built !== current) {
    return NextResponse.json(
      {
        error:
          "This solicitation's requirements changed after the package was assembled, so the package no longer matches what is being asked for. Re-run the Bid Builder, review whatever it flags, then submit.",
        needsForce: false,
        blockers: ["Requirements changed after the package was built"],
      },
      { status: 409 }
    );
  }

  // Block prime_only per past-performance policy.
  if (opp.past_perf_classification === "prime_only") {
    return NextResponse.json(
      { error: "Blocked: past performance is prime_only. Requires human resolution before submission." },
      { status: 409 }
    );
  }

  /*
   * Hard gate: the pricing sheet has to hold together. Force cannot bypass it.
   *
   * This used to ask one question, "does every required trade have a positive
   * quote row", and a bid could pass it while being unpriceable in three other
   * ways: a subcontractor excluded work nobody picked up, an alternate went
   * into the bid with no price on it, or three firms quoted the same trade and
   * nobody chose between them. Each of those produces a number that looks like
   * a cost and is not one.
   *
   * The sheet answers all of them from one model, and it is the same model the
   * Pricing tab renders, so the screen and the gate cannot disagree.
   */
  const required = (opp.solicitation_analysis?.required_trades ?? [])
    .map((t) => String(t).trim())
    .filter(Boolean);
  const pricingRows = await pricingRowsWithQuotes(params.id, orgId).catch(() => []);
  const sheet = pricingSheet(required, pricingRows, {
    now: new Date(),
    bidDueAt: opp.deadline ? new Date(opp.deadline) : null,
    quoteValidityRequired: (opp.solicitation_analysis?.compliance_matrix ?? []).some((r) =>
      /quote\s+validity|price\s+validity|prices?\s+(?:must\s+)?(?:remain|held|hold)/i.test(
        `${r?.title ?? ""} ${r?.instructions ?? ""} ${r?.format ?? ""}`
      )
    ),
  });
  if (sheet.blockers.length > 0) {
    const messages = sheet.blockers.map((b) => b.message);
    return NextResponse.json(
      {
        error: `Bid cannot be submitted. The pricing is not complete:\n\u2022 ${messages.join("\n\u2022 ")}`,
        needsForce: false,
        blockers: messages,
      },
      { status: 409 }
    );
  }

  /*
   * The compliance package, and what force may and may not get past.
   *
   * `force` used to skip this check entirely, which meant it skipped
   * validation_json.blockers with it. Those are not soft findings: the list is
   * a missing mandatory form, an unsigned prefilled document, a required item
   * the operator never provided, a generated artifact missing from storage, a
   * missing bid PDF, or requirements that were never extracted at all.
   * Optional items and a pricing total that does not reconcile are already
   * kept separate as `warnings`, and warnings never blocked anything.
   *
   * So the split the instructions ask for already existed in the data. What
   * was missing was that force respected it. Submitting without a mandatory
   * form is not a judgement an operator can make from this screen: the agency
   * finds the package non-responsive and the bid is gone, and nothing on the
   * screen at the moment of forcing says so.
   *
   * Audit blockers keep their own route, which is acknowledgement. An
   * `acknowledged` finding is a person recording that they considered it and
   * disagreed, against their name; force is the same act with no record of
   * who or why.
   */
  const validationBlockers = bid.validation_json?.blockers ?? [];
  const auditBlockers = (bid.audit_findings ?? [])
    .filter((f) => f.severity === "blocker" && !f.acknowledged)
    .map((f) => f.finding);
  const hardBlockers = [...validationBlockers, ...auditBlockers];
  if (hardBlockers.length > 0) {
    return NextResponse.json(
      {
        error: `The submission package is not complete yet:\n• ${hardBlockers.join("\n• ")}`,
        needsForce: false,
        blockers: hardBlockers,
      },
      { status: 409 }
    );
  }

  /*
   * Package not marked ready, but nothing enumerated why.
   *
   * This is the compliance audit having not run rather than having failed:
   * out of credit, unreachable, or skipped. The instructions call for a human
   * gate here rather than an unqualified block, which is what force is.
   */
  /*
   * Validate the override here, and not a line earlier.
   *
   * Every hard blocker above refuses regardless of `force`, so an operator who
   * sent one should be told the blocker is not overridable, not asked to write
   * a reason they will never be allowed to use. Asking first would be a form
   * that wastes somebody's time and then refuses them anyway.
   */
  if (wantsOverride && !overrideOk) {
    const problem = overrideProblem(overrideReq)!;
    return NextResponse.json(
      { error: OVERRIDE_PROBLEM_MESSAGE[problem], overrideProblem: problem },
      { status: 400 }
    );
  }

  if (!bid.package_ready && !force) {
    return NextResponse.json(
      {
        error:
          "The mechanical checks have passed and nothing is outstanding, but the compliance audit has not confirmed this package. " +
          "That usually means the audit could not run rather than that it failed. Review the package yourself and submit again to confirm.",
        needsForce: true,
        // Deliberately empty, and true: everything enumerable was refused
        // above. Returning a list here would invent a reason.
        blockers: [],
      },
      { status: 409 }
    );
  }

  // Enforce submit-lead-hours unless the operator explicitly forces.
  const profile = await getProfileJson();
  const leadHours = profile?.decision_thresholds.submit_lead_hours ?? 2;
  if (opp.deadline) {
    const hoursLeft = (new Date(opp.deadline).getTime() - Date.now()) / 3_600_000;
    if (hoursLeft < leadHours && !force) {
      return NextResponse.json(
        {
          error: `Deadline is ${hoursLeft.toFixed(1)}h away; policy requires submitting at least ${leadHours}h before. To go ahead, say which warning you are overriding and why.`,
          needsForce: true,
          // Named so the UI can prefill the requirement and the operator is
          // writing about a specific thing rather than "the checks".
          requirement: `Submitting ${hoursLeft.toFixed(1)}h before the deadline, inside the ${leadHours}h policy`,
        },
        { status: 409 }
      );
    }
  }

  /*
   * This clears the package to go. It does not claim it went.
   *
   * The line here used to be `update bids set submitted_at=now()`, and it was
   * a lie in the ordinary case: for almost every solicitation this product
   * handles, Brost Co does not submit anything. A person opens a government
   * portal, uploads the files themselves, and comes back. Pressing this button
   * approved a package; it did not deliver one, and a bid recorded as
   * submitted with no evidence is worse than one recorded as ready, because
   * the first stops anybody checking.
   *
   * `submitted_at` is now set only by the mark-as-sent endpoint, which
   * requires the evidence, and a check constraint refuses the column without
   * it either way.
   */
  await query(
    `update bids set submission_state='approved' where id=$1 and submission_state='package_ready'`,
    [bid.id]
  );
  if (overrideOk) {
    /*
     * Written before the approval event, so an override can never end up
     * without the approval it justified, and so the two read in the order
     * they happened.
     */
    const at = new Date();
    await query(
      `insert into bid_overrides (bid_id, org_id, requirement, reason, risk, actor)
       values ($1,$2,$3,$4,$5,$6)`,
      [
        bid.id,
        orgId,
        overrideReq.requirement.trim(),
        overrideReq.reason.trim(),
        overrideRisk(overrideReq.requirement),
        auth.email,
      ]
    ).catch(() => {});
    await logAgent({
      agent: "operator",
      action: "submit-override",
      opportunityId: params.id,
      bidId: bid.id,
      level: "warn",
      message: overrideSummary(overrideReq, auth.email, at),
    });
  }
  /*
   * Freeze the arithmetic this approval was given against.
   *
   * A package approved against particular numbers is approved against those
   * numbers. If the pricing rows can move afterwards then the sign-off is a
   * record of nothing: the screen shows today's total beside a decision made
   * for yesterday's, and there is no way from inside the product to tell that
   * they differ. The snapshot row cannot be edited once written.
   *
   * Not fatal if it fails. Losing the frozen copy is bad; refusing an approval
   * that passed every gate because a second insert failed is worse, and the
   * approval event below is still written either way.
   */
  // numeric arrives as a string. Null stays null: a bid nobody has set is not
  // a bid of zero, and Number(null) is exactly how it would become one.
  const bidAmount =
    bid.bid_amount != null && Number.isFinite(Number(bid.bid_amount))
      ? Number(bid.bid_amount)
      : null;
  const math = bidMath({ cost: sheet.cost, bid: bidAmount, contingencyPct: null });
  await freezeCalculation({
    bidId: bid.id,
    orgId,
    opportunityId: params.id,
    reason: "approved",
    actor: auth.email,
    calculation: {
      cost: sheet.cost,
      bid: bidAmount,
      grossProfit: math.grossProfit,
      marginPct: math.marginPct,
      markupPct: math.markupPct,
      unknown: math.unknown,
      formula: explainBidMath(math),
      weakestConfidence: sheet.weakestConfidence,
      rows: sheet.rows.map((p) => ({
        trade: p.row.trade,
        scopeKey: p.row.scopeKey,
        selectedSub: p.row.selectedSubName ?? null,
        backupSub: p.row.backupSubName ?? null,
        baseQuote: p.row.baseQuote,
        total: p.total,
        confidence: p.row.confidence,
        quoteExpiresOn: p.row.quoteExpiresOn,
        exclusions: p.row.exclusions,
        alternates: p.row.alternates,
        problems: p.problems.map((x) => x.message),
      })),
    },
  }).catch(() => {});
  await query(
    `insert into bid_submission_events (bid_id, org_id, from_state, to_state, actor, proof)
     values ($1,$2,'package_ready','approved',$3,$4)`,
    [
      bid.id,
      orgId,
      auth.email,
      overrideOk
        ? `Cleared to send with a warning overridden by ${auth.email}: ${overrideReq.reason.trim()}`
        : "Every check passed and the package was cleared to send. Nothing has been sent yet.",
    ]
  ).catch(() => {});
  await logAgent({
    agent: "operator",
    action: "approve-bid",
    opportunityId: params.id,
    bidId: bid.id,
    level: "success",
    message: `Operator ${auth.email} approved the bid package to be sent.`,
    reasoning:
      "The package is cleared. It counts as submitted only once somebody records how and when it reached the agency.",
  });

  return NextResponse.json({
    ok: true,
    state: "approved",
    // Said plainly so the UI cannot imply the package has gone.
    message:
      "Approved. Send it through the agency's portal, then record how and when you did.",
  });
}
