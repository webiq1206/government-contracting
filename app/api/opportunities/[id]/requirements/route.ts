import { NextResponse } from "next/server";
import { requireOrgContext } from "@/lib/org-guard";
import { logAgent } from "@/lib/logger";
import { applyPackageChange } from "@/lib/bid-package-state";
import type { ResolvedRequirement } from "@/lib/types";

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

  const result = await applyPackageChange(params.id, orgId, ({ matrix, findings }) => {
    if (body.requirement_id) {
      let found = false;
      matrix = matrix.map((r) => {
        if (r.id !== body.requirement_id) return r;
        found = true;
        if (confirmed) return { ...r, operator_confirmed: true, status: "satisfied" };
        // Un-confirming also detaches the uploaded file: leaving it attached
        // would keep the document in the manifest for an item the operator
        // just said is not done.
        const { operator_doc: _dropped, ...rest } = r;
        const status: ResolvedRequirement["status"] = r.official_form
          ? "needs_operator"
          : r.satisfied_by === "operator_signature"
            ? "needs_signature"
            : r.satisfied_by === "operator_provided"
              ? "needs_operator"
              : "satisfied";
        return { ...rest, operator_confirmed: false, status };
      });
      if (!found) return null;
      label = `requirement ${body.requirement_id}`;
    }

    if (body.finding_id) {
      let found = false;
      findings = findings.map((f) => {
        if (f.id !== body.finding_id) return f;
        found = true;
        return { ...f, acknowledged: confirmed };
      });
      if (!found) return null;
      label = `audit finding ${body.finding_id}`;
    }

    return { matrix, findings };
  });

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
