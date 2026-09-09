import { NextResponse } from "next/server";
import { requireOrgContext } from "@/lib/org-guard";
import { queryOne, transaction } from "@/lib/db";
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
import {
  calculationHash,
  pricingRowsWithQuotes,
  pricingRowsWithQuotesInTransaction,
} from "@/lib/pricing-rows";
import { pricingSheet, type PricingSheet } from "@/lib/domain/pricing-row";
import { bidMath, explainBidMath } from "@/lib/domain/trade-pricing";
import type { Opportunity } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface BidApprovalFacts {
  id: string;
  human_flags: string[];
  qa_checklist: { ok: boolean }[] | null;
  package_ready: boolean;
  validation_json: { blockers?: string[] } | null;
  requirements_fingerprint: string | null;
  audit_findings: { severity: string; acknowledged?: boolean; finding: string }[] | null;
  bid_amount: string | null;
  submission_state: string;
  updated_at_token: string;
  compliance_matrix: unknown;
  package_manifest: unknown;
  documents_json: unknown;
}

interface LockedApprovalFacts extends BidApprovalFacts {
  opportunity_updated_at_token: string;
  stage: string;
  status: string;
  pursuit_state: string | null;
  deadline: string | null;
  past_perf_classification: string | null;
  solicitation_analysis: Opportunity["solicitation_analysis"];
}

function sourceRequirementsExist(opp: {
  solicitation_analysis?: Opportunity["solicitation_analysis"];
}): boolean {
  return (
    (opp.solicitation_analysis?.compliance_matrix?.length ?? 0) > 0 ||
    (opp.solicitation_analysis?.qa_addenda?.length ?? 0) > 0
  );
}

function requirementsState(
  built: string | null,
  opp: { solicitation_analysis?: Opportunity["solicitation_analysis"] }
): { current: string; valid: boolean } {
  const current = currentRequirementsFingerprint(opp);
  return {
    current,
    valid: sourceRequirementsExist(opp) ? Boolean(built && built === current) : !built || built === current,
  };
}

function packageFactsFingerprint(bid: BidApprovalFacts): string {
  return calculationHash({
    humanFlags: bid.human_flags,
    qaChecklist: bid.qa_checklist,
    packageReady: bid.package_ready,
    validation: bid.validation_json,
    auditFindings: bid.audit_findings,
    requirementsFingerprint: bid.requirements_fingerprint,
    bidAmount: bid.bid_amount,
    complianceMatrix: bid.compliance_matrix,
    manifest: bid.package_manifest,
    documents: bid.documents_json,
  });
}

function approvalCalculation(sheet: PricingSheet, rawBidAmount: string | null) {
  // Numeric arrives as a string. Null stays null: a bid nobody has set is not
  // a bid of zero, and Number(null) is exactly how it would become one.
  const bidAmount =
    rawBidAmount != null && Number.isFinite(Number(rawBidAmount))
      ? Number(rawBidAmount)
      : null;
  const math = bidMath({ cost: sheet.cost, bid: bidAmount, contingencyPct: null });
  return {
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
  };
}

function checkedPricingSheet(
  opp: { deadline: string | null; solicitation_analysis?: Opportunity["solicitation_analysis"] },
  rows: Awaited<ReturnType<typeof pricingRowsWithQuotes>>,
  checkedAt: Date
): PricingSheet {
  const required = (opp.solicitation_analysis?.required_trades ?? [])
    .map((trade) => String(trade).trim())
    .filter(Boolean);
  return pricingSheet(required, rows, {
    now: checkedAt,
    bidDueAt: opp.deadline ? new Date(opp.deadline) : null,
    quoteValidityRequired: (opp.solicitation_analysis?.compliance_matrix ?? []).some((requirement) =>
      /quote\s+validity|price\s+validity|prices?\s+(?:must\s+)?(?:remain|held|hold)/i.test(
        `${requirement?.title ?? ""} ${requirement?.instructions ?? ""} ${requirement?.format ?? ""}`
      )
    ),
  });
}

function requirementsChangedResponse() {
  return NextResponse.json(
    {
      error:
        "This solicitation's requirements changed after the package was assembled, or this package has no record of which requirements it used. Re-run the Bid Builder, review whatever it flags, then submit.",
      needsForce: false,
      blockers: ["The package is not tied to the current solicitation requirements"],
    },
    { status: 409 }
  );
}

/** Operator submits the reviewed bid package. Guards the submit-lead-hours rule + prime_only block. */
export async function POST(req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
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

  const opp = await queryOne<Opportunity & { updated_at_token: string }>(
    `select *, updated_at::text as updated_at_token
       from opportunities where id=$1 and org_id=$2`,
    [params.id, orgId]
  );
  if (!opp) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const bid = await queryOne<BidApprovalFacts>(
    `select id, human_flags, qa_checklist, package_ready, validation_json, audit_findings,
            requirements_fingerprint, bid_amount, submission_state,
            updated_at::text as updated_at_token, compliance_matrix,
            package_manifest, documents_json
       from bids where opportunity_id=$1 and org_id=$2 order by created_at desc limit 1`,
    [params.id, orgId]
  );
  if (!bid) return NextResponse.json({ error: "No bid package to submit." }, { status: 400 });
  if (bid.submission_state !== "package_ready") {
    return NextResponse.json(
      {
        error:
          bid.submission_state === "approved"
            ? "This package is already approved to send. Record the delivery evidence after it reaches the agency."
            : "This package has submission history and cannot be approved again from its current state.",
      },
      { status: 409 }
    );
  }
  if (
    opp.stage !== "bid_building" ||
    opp.status !== "open" ||
    (opp.pursuit_state ?? "active") !== "active"
  ) {
    return NextResponse.json(
      {
        error:
          opp.stage === "submitted"
            ? "This bid is already submitted. Record the agency outcome instead of approving it again."
            : "Only an active, open bid in the package review stage can be approved. Refresh the opportunity to see its current state.",
      },
      { status: 409 }
    );
  }

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
  const preflightRequirements = requirementsState(bid.requirements_fingerprint, opp);
  if (!preflightRequirements.valid) return requirementsChangedResponse();

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
  const approvalCheckedAt = new Date();
  let pricingRows: Awaited<ReturnType<typeof pricingRowsWithQuotes>>;
  try {
    pricingRows = await pricingRowsWithQuotes(params.id, orgId);
  } catch {
    return NextResponse.json(
      {
        error:
          "The pricing sheet could not be checked, so nothing was submitted. Reload the opportunity and try again after the database connection recovers.",
        needsForce: false,
      },
      { status: 503 }
    );
  }
  const sheet = checkedPricingSheet(opp, pricingRows, approvalCheckedAt);
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

  const rebuildBlocker = (bid.human_flags ?? []).find((flag) =>
    ["pricing_changed_rebuild_required", "restart_revalidation_pending"].includes(flag)
  );
  if (rebuildBlocker) {
    return NextResponse.json(
      {
        error:
          rebuildBlocker === "pricing_changed_rebuild_required"
            ? "Pricing changed after this package was assembled. Wait for Bid Builder to finish, then review the rebuilt package before approval."
            : "This pursuit was restarted, so its prior package is no longer cleared for use. Wait for revalidation and Bid Builder to finish, then review the rebuilt package before approval.",
        needsForce: false,
        blockers: [
          rebuildBlocker === "pricing_changed_rebuild_required"
            ? "Pricing changed after the package was built"
            : "Pursuit restart requires a revalidated package",
        ],
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
  const overrideAt = overrideOk ? new Date() : null;
  const preflightPricingFingerprint = calculationHash(pricingRows);
  const preflightPackageFingerprint = packageFactsFingerprint(bid);
  type ApprovalResult =
    | { ok: true }
    | { ok: false; reason: "stale" | "requirements" | "pricing"; blockers?: string[] };
  let approval: ApprovalResult;
  try {
    approval = await transaction(async (client): Promise<ApprovalResult> => {
      /*
       * Quote and pricing-row writes take ROW EXCLUSIVE table locks. Holding
       * SHARE locks until commit means none can slip between the second check
       * and the approval update. The bid and opportunity row locks do the same
       * for package and solicitation facts. SERIALIZABLE is the final guard
       * against a future pricing source being added without joining this lock.
       */
      await client.query("set transaction isolation level serializable");
      await client.query("set local lock_timeout = '10s'");
      await client.query("lock table trade_pricing_rows, quotes in share mode");
      const lockedRows = await client.query<LockedApprovalFacts>(
        `select b.id, b.human_flags, b.qa_checklist, b.package_ready,
                b.validation_json, b.requirements_fingerprint, b.audit_findings,
                b.bid_amount, b.submission_state,
                b.updated_at::text as updated_at_token,
                b.compliance_matrix, b.package_manifest, b.documents_json,
                o.updated_at::text as opportunity_updated_at_token,
                o.stage, o.status, o.pursuit_state, o.deadline,
                o.past_perf_classification, o.solicitation_analysis
           from bids b
           join opportunities o on o.id=b.opportunity_id and o.org_id=b.org_id
          where b.id=$1 and b.org_id=$2 and o.id=$3
          for update of b, o`,
        [bid.id, orgId, params.id]
      );
      const locked = lockedRows.rows[0];
      if (!locked) return { ok: false, reason: "stale" };

      const lockedRequirements = requirementsState(locked.requirements_fingerprint, locked);
      if (
        !lockedRequirements.valid ||
        lockedRequirements.current !== preflightRequirements.current
      ) {
        return { ok: false, reason: "requirements" };
      }
      if (
        locked.submission_state !== "package_ready" ||
        (!locked.package_ready && !force) ||
        locked.stage !== "bid_building" ||
        locked.status !== "open" ||
        (locked.pursuit_state ?? "active") !== "active" ||
        locked.past_perf_classification === "prime_only"
      ) {
        return { ok: false, reason: "stale" };
      }

      const transactionPricingRows = await pricingRowsWithQuotesInTransaction(
        client,
        params.id,
        orgId
      );
      const transactionSheet = checkedPricingSheet(
        locked,
        transactionPricingRows,
        approvalCheckedAt
      );
      if (transactionSheet.blockers.length > 0) {
        return {
          ok: false,
          reason: "pricing",
          blockers: transactionSheet.blockers.map((blocker) => blocker.message),
        };
      }

      const pricingFingerprint = calculationHash(transactionPricingRows);
      const packageFingerprint = packageFactsFingerprint(locked);
      if (
        locked.updated_at_token !== bid.updated_at_token ||
        locked.opportunity_updated_at_token !== opp.updated_at_token ||
        pricingFingerprint !== preflightPricingFingerprint ||
        packageFingerprint !== preflightPackageFingerprint
      ) {
        return { ok: false, reason: "stale" };
      }

      const calculation = approvalCalculation(transactionSheet, locked.bid_amount);
      const snapshotHash = calculationHash(calculation);
      const changed = await client.query<{ id: string }>(
        `update bids b
            set submission_state='approved', updated_at=now()
           from opportunities o
          where b.id=$1 and b.org_id=$2 and b.submission_state='package_ready'
            and b.updated_at=$3::timestamptz and b.package_ready=$4
            and o.id=b.opportunity_id and o.org_id=b.org_id
            and o.stage='bid_building' and o.status='open'
            and coalesce(o.pursuit_state, 'active')='active'
            and o.updated_at=$5::timestamptz
            and b.requirements_fingerprint is not distinct from $6
          returning b.id`,
        [
          bid.id,
          orgId,
          locked.updated_at_token,
          locked.package_ready,
          locked.opportunity_updated_at_token,
          locked.requirements_fingerprint,
        ]
      );
      if (changed.rows.length === 0) return { ok: false, reason: "stale" };

      if (overrideOk) {
        await client.query(
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
        );
      }
      await client.query(
        `insert into bid_calculation_snapshots
           (bid_id, org_id, opportunity_id, reason, actor, calculation, calculation_hash)
         values ($1,$2,$3,'approved',$4,$5::jsonb,$6)`,
        [
          bid.id,
          orgId,
          params.id,
          auth.email,
          JSON.stringify(calculation),
          snapshotHash,
        ]
      );
      const proof = [
        overrideOk
          ? `Cleared to send with a warning overridden by ${auth.email}: ${overrideReq.reason.trim()}`
          : "Every check passed and the package was cleared to send. Nothing has been sent yet.",
        `Requirements ${lockedRequirements.current}.`,
        `Pricing facts ${pricingFingerprint}.`,
        `Package facts ${packageFingerprint}.`,
        `Calculation ${snapshotHash}.`,
      ].join(" ");
      await client.query(
        `insert into bid_submission_events (bid_id, org_id, from_state, to_state, actor, proof)
         values ($1,$2,'package_ready','approved',$3,$4)`,
        [bid.id, orgId, auth.email, proof]
      );
      if (overrideOk && overrideAt) {
        await client.query(
          `insert into agent_logs
             (org_id, agent, action, opportunity_id, bid_id, level, status, message)
           values ($1,'operator','submit-override',$2,$3,'warn','ok',$4)`,
          [orgId, params.id, bid.id, overrideSummary(overrideReq, auth.email, overrideAt)]
        );
      }
      await client.query(
        `insert into agent_logs
           (org_id, agent, action, opportunity_id, bid_id, level, status, message, reasoning,
            output_json)
         values ($1,'operator','approve-bid',$2,$3,'success','ok',$4,$5,$6::jsonb)`,
        [
          orgId,
          params.id,
          bid.id,
          `Operator ${auth.email} approved the bid package to be sent.`,
          "The package is cleared. It counts as submitted only once somebody records how and when it reached the agency.",
          JSON.stringify({
            requirementsFingerprint: lockedRequirements.current,
            pricingFingerprint,
            packageFingerprint,
            calculationHash: snapshotHash,
          }),
        ]
      );
      return { ok: true };
    });
  } catch (error) {
    await logAgent({
      agent: "operator",
      action: "approve-bid-failed",
      opportunityId: params.id,
      bidId: bid.id,
      level: "error",
      status: "error",
      message: `The package approval transaction failed and was rolled back: ${(error as Error).message}`,
    }).catch(() => {});
    return NextResponse.json(
      {
        error:
          "The package approval could not be saved. Nothing was approved. Refresh, verify the package, and try again.",
      },
      { status: 500 }
    );
  }
  if (!approval.ok && approval.reason === "requirements") {
    return requirementsChangedResponse();
  }
  if (!approval.ok && approval.reason === "pricing") {
    const blockers = approval.blockers ?? [];
    return NextResponse.json(
      {
        error: `Bid cannot be submitted. The pricing changed and is not complete:\n\u2022 ${blockers.join("\n\u2022 ")}`,
        needsForce: false,
        blockers,
      },
      { status: 409 }
    );
  }
  if (!approval.ok) {
    return NextResponse.json(
      {
        error:
          "The package changed before approval completed. Refresh it and verify its current submission state.",
      },
      { status: 409 }
    );
  }

  return NextResponse.json({
    ok: true,
    state: "approved",
    warnings: [],
    // Said plainly so the UI cannot imply the package has gone.
    message:
      "Approved. Send it through the agency's portal, then record how and when you did.",
  });
}
