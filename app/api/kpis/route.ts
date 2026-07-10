import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api-auth";
import { query, queryOne } from "@/lib/db";
import { logAgent } from "@/lib/logger";
import { parseKpiInput } from "@/lib/domain/kpi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Create an operator-defined KPI (metric from the fixed catalog + params). */
export async function POST(req: Request) {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;

  const parsed = parseKpiInput(await req.json().catch(() => null));
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const order = await queryOne<{ next: number }>(
    `select coalesce(max(sort_order), 0) + 1 as next from custom_kpis`
  );

  const row = await queryOne<{ id: string }>(
    `insert into custom_kpis (label, metric, params, sort_order)
     values ($1, $2, $3, $4)
     returning id`,
    [parsed.label, parsed.metric, JSON.stringify(parsed.params), order?.next ?? 1]
  );

  await logAgent({
    agent: "operator",
    action: "kpi-add",
    level: "info",
    message: `${auth.email} added KPI "${parsed.label}" (${parsed.metric}).`,
  });

  return NextResponse.json({ ok: true, id: row?.id });
}
