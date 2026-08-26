import { NextResponse } from "next/server";
import { requireOrgContext } from "@/lib/org-guard";
import { query, queryOne } from "@/lib/db";
import { logAgent } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
 * Three, not two. A contract that was lost or ended early is not "completed",
 * and filing it that way makes every win-rate and margin figure quietly wrong
 * -- the kind of wrong nobody goes looking for, because the number still
 * looks like a number.
 */
const ALLOWED = new Set(["active", "completed", "terminated"]);

/** Move a contract between active, completed and terminated. */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const ctx = await requireOrgContext({ capability: "manage_contracts" });
  if (ctx instanceof NextResponse) return ctx;
  const { user: auth, orgId } = ctx;

  const body = await req.json().catch(() => ({}));
  const status = typeof body.status === "string" ? body.status : "";
  if (!ALLOWED.has(status)) {
    return NextResponse.json({ error: "Invalid status." }, { status: 400 });
  }

  const contract = await queryOne<{ id: string }>(`select id from contracts where id=$1 and org_id=$2`, [
    params.id,
    orgId,
  ]);
  if (!contract) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await query(`update contracts set status=$2, updated_at=now() where id=$1`, [
    params.id,
    status,
  ]);

  await logAgent({
    agent: "operator",
    action: "contract-status",
    level: "info",
    message: `${auth.email} marked contract ${params.id} ${status}.`,
  });

  return NextResponse.json({ ok: true });
}
