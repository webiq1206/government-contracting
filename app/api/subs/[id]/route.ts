import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api-auth";
import { query, queryOne } from "@/lib/db";
import { logAgent } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Manually edit a subcontractor record. Only the business-facing fields an
 * operator would correct are writable; the machine-maintained scores and
 * verification results are left alone. Columns are whitelisted so the update is
 * safe to build dynamically.
 */

// column -> how to coerce the incoming value
const TEXT_FIELDS = [
  "company_name",
  "owner_name",
  "email",
  "phone",
  "website",
  "license_number",
  "license_status",
  "address",
  "city",
  "state",
] as const;

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  const sub = await queryOne<{ id: string }>(
    `select id from subcontractors where id=$1`,
    [params.id]
  );
  if (!sub) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const sets: string[] = [];
  const values: unknown[] = [];
  let i = 1;

  for (const col of TEXT_FIELDS) {
    if (col in body) {
      const raw = body[col];
      const v = typeof raw === "string" ? raw.trim() : "";
      if (col === "company_name" && v === "") {
        return NextResponse.json(
          { error: "Company name can't be empty." },
          { status: 400 }
        );
      }
      sets.push(`${col}=$${i++}`);
      values.push(v === "" ? null : v);
    }
  }

  if ("trade_categories" in body) {
    const raw = body.trade_categories;
    const arr = Array.isArray(raw)
      ? raw.map((x) => String(x).trim()).filter(Boolean)
      : typeof raw === "string"
        ? raw.split(",").map((x) => x.trim()).filter(Boolean)
        : [];
    sets.push(`trade_categories=$${i++}`);
    values.push(arr);
  }

  if ("is_preferred" in body) {
    sets.push(`is_preferred=$${i++}`);
    values.push(Boolean(body.is_preferred));
  }

  if (sets.length === 0) {
    return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
  }

  values.push(params.id);
  await query(
    `update subcontractors set ${sets.join(", ")} where id=$${i}`,
    values
  );

  await logAgent({
    agent: "operator",
    action: "sub-edit",
    subcontractorId: params.id,
    level: "info",
    message: `Operator ${auth.email} edited subcontractor ${params.id} (${sets.length} field${sets.length === 1 ? "" : "s"}).`,
  });

  return NextResponse.json({ ok: true });
}
