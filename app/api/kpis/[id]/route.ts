import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api-auth";
import { query, queryOne } from "@/lib/db";
import { logAgent } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Remove an operator-defined KPI. */
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;

  const kpi = await queryOne<{ id: string; label: string }>(
    `select id, label from custom_kpis where id=$1`,
    [params.id]
  );
  if (!kpi) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await query(`delete from custom_kpis where id=$1`, [params.id]);
  await logAgent({
    agent: "operator",
    action: "kpi-delete",
    level: "info",
    message: `${auth.email} removed KPI "${kpi.label}".`,
  });
  return NextResponse.json({ ok: true });
}
