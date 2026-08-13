import { NextResponse } from "next/server";
import { requireOrgContext } from "@/lib/org-guard";
import { query, queryOne } from "@/lib/db";
import { logAgent } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Save permanent notes for a subcontractor (editable after every call). */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const ctx = await requireOrgContext();
  if (ctx instanceof NextResponse) return ctx;
  const { user: auth, orgId } = ctx;

  const body = await req.json().catch(() => ({}));
  const notes = typeof body.notes === "string" ? body.notes : "";

  const sub = await queryOne<{ id: string }>(
    `select id from subcontractors where id=$1 and org_id=$2`,
    [params.id, orgId]
  );
  if (!sub) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await query(`update subcontractors set notes=$2 where id=$1`, [params.id, notes]);

  await logAgent({
    agent: "operator",
    action: "sub-notes",
    subcontractorId: params.id,
    level: "info",
    message: `Operator ${auth.email} updated notes for sub ${params.id}.`,
  });

  return NextResponse.json({ ok: true });
}
