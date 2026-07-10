import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api-auth";
import { query, queryOne } from "@/lib/db";
import { logAgent } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Edit the operator-owned fields on a compliance item: the renewal date, a
 * status override, a reference/renewal link, a link to the proof document, and
 * notes. The Compliance Monitor never writes these, so an edit survives its
 * daily run.
 */

const STATUSES = new Set(["ok", "warning", "critical", "blocked", "resolved"]);

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  const item = await queryOne<{ id: string; label: string }>(
    `select id, label from compliance_items where id=$1`,
    [params.id]
  );
  if (!item) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const sets: string[] = [];
  const values: unknown[] = [];
  let i = 1;

  if ("due_at_override" in body) {
    const raw = body.due_at_override;
    let dt: string | null = null;
    if (typeof raw === "string" && raw.trim() !== "") {
      const parsed = new Date(raw);
      if (Number.isNaN(parsed.getTime())) {
        return NextResponse.json({ error: "That date is not valid." }, { status: 400 });
      }
      dt = parsed.toISOString();
    }
    sets.push(`due_at_override=$${i++}`);
    values.push(dt);
  }

  if ("status_override" in body) {
    const raw = typeof body.status_override === "string" ? body.status_override.trim() : "";
    if (raw !== "" && !STATUSES.has(raw)) {
      return NextResponse.json({ error: "Unknown status." }, { status: 400 });
    }
    sets.push(`status_override=$${i++}`);
    values.push(raw === "" ? null : raw);
  }

  for (const col of ["notes", "link_url", "doc_url"] as const) {
    if (col in body) {
      const v = typeof body[col] === "string" ? (body[col] as string).trim() : "";
      sets.push(`${col}=$${i++}`);
      values.push(v === "" ? null : v);
    }
  }

  if (sets.length === 0) {
    return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
  }

  values.push(params.id);
  await query(
    `update compliance_items set ${sets.join(", ")}, updated_at=now() where id=$${i}`,
    values
  );

  await logAgent({
    agent: "operator",
    action: "compliance-edit",
    level: "info",
    message: `Operator ${auth.email} edited compliance item "${item.label}".`,
  });

  return NextResponse.json({ ok: true });
}

/** Delete an operator-created item. Monitor-managed items can't be deleted here
 *  (the monitor would just recreate them), so this only removes source='operator'. */
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;

  const item = await queryOne<{ id: string; label: string; source: string }>(
    `select id, label, coalesce(source,'monitor') as source from compliance_items where id=$1`,
    [params.id]
  );
  if (!item) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (item.source !== "operator") {
    return NextResponse.json(
      { error: "This item is tracked automatically and can't be deleted." },
      { status: 400 }
    );
  }

  await query(`delete from compliance_items where id=$1`, [params.id]);
  await logAgent({
    agent: "operator",
    action: "compliance-delete",
    level: "info",
    message: `${auth.email} deleted compliance item "${item.label}".`,
  });
  return NextResponse.json({ ok: true });
}
