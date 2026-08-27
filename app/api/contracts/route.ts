import { NextResponse } from "next/server";
import { requireOrgContext } from "@/lib/org-guard";
import { logAgent } from "@/lib/logger";
import { createContract, seedContractStartup } from "@/lib/contract-record";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Record a contract that did not come from a won bid.
 *
 * There was no route to create a contract at all. One could only exist as the
 * output of a win, and the win path hard-refuses an award with no bid record,
 * so a contract signed before this account existed, or one that arrived by a
 * route the platform never saw, could not be tracked here in any form.
 */
export async function POST(req: Request) {
  const ctx = await requireOrgContext({ capability: "manage_contracts" });
  if (ctx instanceof NextResponse) return ctx;

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const s = (k: string) => (typeof body[k] === "string" ? (body[k] as string) : "");
  const award = body.award_amount;
  const awardNum =
    award == null || award === "" ? null : Number(String(award).replace(/[$,\s]/g, ""));

  const res = await createContract({
    orgId: ctx.orgId,
    actorId: ctx.user.id,
    contractNumber: s("contract_number"),
    awardAmount: awardNum,
    startDate: s("start_date") || null,
    endDate: s("end_date") || null,
    opportunityId: s("opportunity_id") || null,
  });
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status });

  /*
   * The same obligations a won contract gets. A contract entered by hand has
   * the same duties as one this account bid; only the bid history differs.
   */
  if (res.id) {
    await seedContractStartup({ orgId: ctx.orgId, contractId: res.id }).catch((e: unknown) => {
      console.warn("[contracts] could not seed contract startup:", e);
      return null;
    });
  }

  await logAgent({
    agent: "operator",
    action: "contract-created",
    level: "info",
    // Says it was entered by hand, because several figures on the record are
    // absent for that reason rather than by oversight.
    message: `Recorded contract ${s("contract_number")} by hand, with no bid behind it.`,
  });
  return NextResponse.json({ ok: true, id: res.id, message: "Contract recorded." });
}
