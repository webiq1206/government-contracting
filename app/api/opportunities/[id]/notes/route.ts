import { NextResponse } from "next/server";
import { requireOrgContext } from "@/lib/org-guard";
import { query, queryOne } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Save the operator's free-form notes on an opportunity. */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const ctx = await requireOrgContext();
  if (ctx instanceof NextResponse) return ctx;
  const { orgId } = ctx;

  const body = await req.json().catch(() => ({}));
  const notes = typeof body.notes === "string" ? body.notes : "";

  const opp = await queryOne<{ id: string }>(`select id from opportunities where id=$1 and org_id=$2`, [
    params.id,
    orgId,
  ]);
  if (!opp) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await query(`update opportunities set notes=$2 where id=$1`, [params.id, notes]);
  return NextResponse.json({ ok: true });
}
