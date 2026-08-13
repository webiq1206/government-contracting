import { NextResponse } from "next/server";
import { requireOrgContext } from "@/lib/org-guard";
import { query, queryOne } from "@/lib/db";
import { logAgent } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Create an operator-owned compliance item (source = 'operator'). The Compliance
 * Monitor never touches these, so it will not overwrite or remove them. Category
 * is free text (the board groups by it); a due date is optional but enables the
 * countdown/alerts.
 */
export async function POST(req: Request) {
  const ctx = await requireOrgContext();
  if (ctx instanceof NextResponse) return ctx;
  const { user: auth, orgId } = ctx;

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const label = typeof body.label === "string" ? body.label.trim() : "";
  const category = typeof body.category === "string" ? body.category.trim() : "";
  if (!label) return NextResponse.json({ error: "A name is required." }, { status: 400 });
  if (!category) return NextResponse.json({ error: "Pick or type a category." }, { status: 400 });

  let dueAt: string | null = null;
  if (typeof body.due_at === "string" && body.due_at.trim() !== "") {
    const parsed = new Date(body.due_at);
    if (Number.isNaN(parsed.getTime())) {
      return NextResponse.json({ error: "That date is not valid." }, { status: 400 });
    }
    dueAt = parsed.toISOString();
  }

  const row = await queryOne<{ id: string }>(
    `insert into compliance_items (org_id, category, label, source, due_at, status, last_checked_at)
     values ($4, $1, $2, 'operator', $3, 'ok', now())
     returning id`,
    [category, label, dueAt, orgId]
  );

  await logAgent({
    agent: "operator",
    action: "compliance-add",
    level: "info",
    message: `${auth.email} added compliance item "${label}" (${category}).`,
  });

  return NextResponse.json({ ok: true, id: row?.id });
}
