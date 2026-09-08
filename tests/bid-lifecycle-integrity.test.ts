import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = (path: string) => readFileSync(path, "utf8");

describe("bid lifecycle integration points", () => {
  it("approves a package atomically without claiming it was delivered", () => {
    const route = source("app/api/opportunities/[id]/submit/route.ts");
    expect(route).toContain("transaction(async (client)");
    expect(route).toContain("set transaction isolation level serializable");
    expect(route).toContain("lock table trade_pricing_rows, quotes in share mode");
    expect(route).toContain("pricingRowsWithQuotesInTransaction");
    expect(route).toContain("sourceRequirementsExist(opp)");
    expect(route).toContain("insert into bid_calculation_snapshots");
    expect(route).toContain("insert into agent_logs");
    expect(route).toContain("submission_state='approved'");
    expect(route).toContain("b.updated_at=$3::timestamptz");
    expect(route).toContain("o.stage='bid_building'");
    const approvalUpdate = route.match(/`update bids b[\s\S]*?returning b\.id`/)?.[0];
    expect(approvalUpdate).toBeDefined();
    expect(approvalUpdate).not.toContain("submitted_at");
    expect(route).not.toContain("approval-pricing-snapshot-failed");
  });

  it("moves to submitted only in the evidence-backed sent transaction", () => {
    const route = source("app/api/opportunities/[id]/sent/route.ts");
    expect(route).toContain("submissionPackageHash");
    expect(route).toContain("sentEvidenceGaps");
    expect(route).toContain("transaction(async (client)");
    expect(route).toContain("set stage='submitted'");
    expect(route).toContain("insert into bid_submission_events");
    expect(route).toContain('method === "connector"');
    expect(route).toContain("d.kind in ('submission_proof','operator_upload')");
    expect(route).toContain("isIanaTimezone");
    expect(route).toContain("Date.now() + 5 * 60_000");
  });

  it("records outcomes under contract permission and locks the bid and opportunity", () => {
    const route = source("app/api/opportunities/[id]/outcome/route.ts");
    expect(route).toContain('capability: "manage_contracts"');
    expect(route).toContain("outcomeDetailsProblem");
    expect(route).toContain("for update of o, b");
    expect(route).toContain("and submission_state=$6");
    expect(route).toContain("insert into contracts");
    expect(route).toContain("and stage='submitted' and status='open'");
  });

  it("enforces artifact and terminal lifecycle rules in the database", () => {
    const migration = source("db/migrations/105_bid_artifact_immutability.sql");
    expect(migration).toContain("approved and submitted bid artifacts are immutable");
    expect(migration).toContain("quotes_invalidate_draft_bid");
    expect(migration).toContain("trade_pricing_invalidate_draft_bid");
    expect(migration).toContain("pricing_changed_rebuild_required");
    expect(migration).toContain("confirmed bid delivery evidence before submission");
    expect(migration).toContain("a terminal opportunity outcome cannot be reopened");
    expect(migration).toContain("before update of stage, status on public.opportunities");
    for (const fn of [
      "lock_bid_artifacts_after_approval",
      "invalidate_draft_bid_for_pricing_change",
      "guard_opportunity_submission_lifecycle",
    ]) {
      expect(migration).toMatch(
        new RegExp(
          `function public\\.${fn}\\(\\)[\\s\\S]*?language plpgsql set search_path = pg_catalog`,
          "i"
        )
      );
      expect(migration).toContain(`revoke all on function public.${fn}() from public`);
      expect(migration).toContain(`revoke all on function public.${fn}() from anon`);
      expect(migration).toContain(`revoke all on function public.${fn}() from authenticated`);
    }
    expect(migration).toContain("update public.bids");
    expect(migration).toContain("from public.bids b");
  });

  it("writes generated files under immutable build versions with content hashes", () => {
    const builder = source("lib/agents/package-builder.ts");
    const bidBuilder = source("lib/agents/bid-builder.ts");
    expect(builder).toContain("/${buildToken}/${kind}.pdf");
    expect(builder).toContain('createHash("sha256")');
    expect(bidBuilder).toContain("publishGeneratedDocuments");
    expect(bidBuilder).toContain("for update");
    expect(bidBuilder).toContain("submission_state='package_ready'");
  });

  it("stamps and checks pursuit versions around queued work", () => {
    const queue = source("lib/queue/index.ts");
    const runner = source("lib/agents/runner.ts");
    const guard = source("lib/pursuit-guard.ts");
    expect(queue).toContain('PURSUIT_VERSION_KEY = "pursuitVersionAtEnqueue"');
    expect(queue).toContain("[PURSUIT_VERSION_KEY]: pursuit.version");
    expect(runner).toContain('action: "stale-pursuit-job"');
    expect(runner).toContain("runWithPursuitVersion");
    expect(guard).toContain("expectedPursuitVersion(opportunityId)");
  });

  it("keeps pursuit transitions from racing past a submitted or terminal state", () => {
    const route = source("app/api/opportunities/[id]/pursuit/route.ts");
    expect(route).toContain("and stage = $10 and status = $11");
    expect(route).toContain("currentStage");
    expect(route).toContain("currentStatus");
  });

  it("runs only the trusted post-award onboarding job after opportunity closure", () => {
    const route = source("app/api/opportunities/[id]/outcome/route.ts");
    const queue = source("lib/queue/index.ts");
    const runner = source("lib/agents/runner.ts");
    expect(route).toContain("allowClosedOpportunity: true");
    expect(route).toContain("won-sub-onboarding:");
    expect(queue).toContain('name === "sub-onboarding"');
    expect(queue).toContain("opts?.allowClosedOpportunity === true");
    expect(runner).toContain("payload[CLOSED_OPPORTUNITY_JOB_KEY] === true");
  });

  it("settles recovery claims from a queue-owned worker marker", () => {
    const queue = source("lib/queue/index.ts");
    const runner = source("lib/agents/runner.ts");
    expect(queue).toContain('RECOVERY_REQUEUE_KEY = "recoveryRequeueId"');
    expect(queue).toContain("_untrustedRecovery");
    expect(runner).toContain("update incident_requeues");
    expect(runner).toContain("handlerRan && result.ok ? \"succeeded\" : \"failed\"");
  });
});
