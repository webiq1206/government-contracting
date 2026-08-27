import { NextResponse } from "next/server";
import { requireOrgContext } from "@/lib/org-guard";
import { logAgent } from "@/lib/logger";
import {
  applyPackageChange,
  setRequirementConfirmed,
  type PackageChangeResult,
} from "@/lib/bid-package-state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Mark an operator item complete. Either a compliance requirement (signature /
 * provided doc) or an audit finding (acknowledge). Re-runs validation +
 * combined readiness so the Submit gate reflects reality immediately.
 * Body: { requirement_id?: string, finding_id?: string, confirmed: boolean }
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const ctx = await requireOrgContext({ capability: "decide" });
  if (ctx instanceof NextResponse) return ctx;
  const { orgId } = ctx;
  const body = (await req.json().catch(() => ({}))) as {
    requirement_id?: string;
    finding_id?: string;
    confirmed?: boolean;
  };
  if (!body.requirement_id && !body.finding_id) {
    return NextResponse.json(
      { error: "requirement_id or finding_id is required." },
      { status: 400 }
    );
  }

  const confirmed = body.confirmed !== false;
  let label = "";

  /*
   * Two different changes, and each goes through the one function that owns
   * it. The requirement branch used to hold its own copy of the confirm and
   * reopen logic; the checklist on the opportunity workspace now writes the
   * same fact, so that copy moved into bid-package-state and both callers
   * share it. Two implementations of "this requirement is done" is how the
   * submission gate and the checklist end up disagreeing in front of the
   * operator.
   */
  let result: PackageChangeResult;
  if (body.requirement_id) {
    label = `requirement ${body.requirement_id}`;
    result = await setRequirementConfirmed(params.id, orgId, body.requirement_id, confirmed);
  } else {
    label = `audit finding ${body.finding_id}`;
    result = await applyPackageChange(params.id, orgId, ({ matrix, findings }) => {
      let found = false;
      const next = findings.map((f) => {
        if (f.id !== body.finding_id) return f;
        found = true;
        return { ...f, acknowledged: confirmed };
      });
      if (!found) return null;
      return { matrix, findings: next };
    });
  }

  if (!result.ok) {
    return NextResponse.json(
      { error: result.error ?? "Could not update the package." },
      { status: result.error === "No package to update." ? 400 : 404 }
    );
  }
  const validation = result.validation!;
  const ready = result.ready!;

  await logAgent({
    agent: "operator",
    action: "requirement-confirm",
    opportunityId: params.id,
    bidId: result.bidId,
    level: "info",
    message: `${confirmed ? "Marked complete" : "Reopened"}: ${label}. Package ${
      ready ? "ready" : "not ready"
    }.`,
  });

  return NextResponse.json({ ok: true, package_ready: ready, validation });
}
