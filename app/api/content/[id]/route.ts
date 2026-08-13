import { NextResponse } from "next/server";
import { requireOrgContext } from "@/lib/org-guard";
import { query, queryOne } from "@/lib/db";
import { logAgent } from "@/lib/logger";
import { parseContentBody } from "@/lib/domain/content";
import type { ContentLibraryItem } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Update a snippet. A body with only `{ is_active }` toggles active state
 * (used by the list's enable/disable control); any other update must pass the
 * full title/category/body validation.
 */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const ctx = await requireOrgContext();
  if (ctx instanceof NextResponse) return ctx;
  const { user: auth, orgId } = ctx;

  const existing = await queryOne<{ id: string }>(
    `select id from content_library where id=$1 and org_id=$2`,
    [params.id, orgId]
  );
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  // Toggle-only update: just flip is_active.
  const keys = Object.keys(body);
  if (keys.length === 1 && keys[0] === "is_active") {
    await query(`update content_library set is_active=$2, updated_at=now() where id=$1`, [
      params.id,
      Boolean(body.is_active),
    ]);
    return NextResponse.json({ ok: true });
  }

  const parsed = parseContentBody(body);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const { title, category, content, tags } = parsed.value;

  const isActive = typeof body.is_active === "boolean" ? body.is_active : true;
  const row = await queryOne<ContentLibraryItem>(
    `update content_library
        set title=$2, category=$3, body=$4, tags=$5, is_active=$6, updated_at=now()
      where id=$1
      returning *`,
    [params.id, title, category, content, tags, isActive]
  );

  await logAgent({
    agent: "operator",
    action: "content-update",
    level: "info",
    message: `${auth.email} updated content-library item "${title}".`,
  });

  return NextResponse.json({ ok: true, item: row });
}

/** Delete a snippet. */
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const ctx = await requireOrgContext();
  if (ctx instanceof NextResponse) return ctx;
  const { user: auth, orgId } = ctx;

  const existing = await queryOne<{ id: string }>(
    `select id from content_library where id=$1 and org_id=$2`,
    [params.id, orgId]
  );
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await query(`delete from content_library where id=$1`, [params.id]);

  await logAgent({
    agent: "operator",
    action: "content-delete",
    level: "info",
    message: `${auth.email} deleted content-library item ${params.id}.`,
  });

  return NextResponse.json({ ok: true });
}
