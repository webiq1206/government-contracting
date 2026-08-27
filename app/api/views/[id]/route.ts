import { NextResponse } from "next/server";
import { requireOrgContext } from "@/lib/org-guard";
import { can } from "@/lib/domain/roles";
import { deleteView } from "@/lib/saved-views";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Remove a saved view.
 *
 * 404 rather than 403 when it is somebody else's: whether a colleague has a
 * personal view called "Mine" is not something another member should be able
 * to learn from a status code.
 */
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const ctx = await requireOrgContext({ capability: "view" });
  if (ctx instanceof NextResponse) return ctx;
  const ok = await deleteView(
    ctx.orgId,
    { id: ctx.user.id, canManageTeam: can(ctx.user.orgRole, "manage_team") },
    params.id
  );
  if (!ok) return NextResponse.json({ error: "No such view." }, { status: 404 });
  return NextResponse.json({ ok: true });
}
