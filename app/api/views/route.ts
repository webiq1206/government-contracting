import { NextResponse } from "next/server";
import { requireOrgContext } from "@/lib/org-guard";
import { can } from "@/lib/domain/roles";
import { checkViewName, NAME_PROBLEM_MESSAGE, parseScope } from "@/lib/domain/saved-views";
import { savedViewsFor, saveView } from "@/lib/saved-views";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Saved views for one list page.
 *
 * GET  ?page=opportunities  -> the team's views plus this reader's own
 * POST { page, name, query, scope } -> save one
 *
 * The capability is `view`, not an administrative one: naming a filter is how
 * an office agrees what "the work" means this month, and requiring an
 * administrator to write one down means nobody writes one down.
 */
export async function GET(req: Request) {
  const ctx = await requireOrgContext({ capability: "view" });
  if (ctx instanceof NextResponse) return ctx;
  const pageKey = new URL(req.url).searchParams.get("page")?.trim();
  if (!pageKey) return NextResponse.json({ error: "page is required." }, { status: 400 });
  const views = await savedViewsFor(
    ctx.orgId,
    { id: ctx.user.id, canManageTeam: can(ctx.user.orgRole, "manage_team") },
    pageKey
  );
  return NextResponse.json({ views });
}

export async function POST(req: Request) {
  const ctx = await requireOrgContext({ capability: "view" });
  if (ctx instanceof NextResponse) return ctx;
  const body = (await req.json().catch(() => ({}))) as {
    page?: string;
    name?: string;
    query?: string;
    scope?: string;
  };
  const pageKey = body.page?.trim();
  if (!pageKey) return NextResponse.json({ error: "page is required." }, { status: 400 });

  const checked = checkViewName(String(body.name ?? ""));
  if (!checked.ok) {
    return NextResponse.json({ error: NAME_PROBLEM_MESSAGE[checked.problem] }, { status: 400 });
  }

  const result = await saveView({
    orgId: ctx.orgId,
    userId: ctx.user.id,
    pageKey,
    name: checked.name,
    // A view is a query string and nothing more, so a saved view can only ever
    // be something this page can already render.
    query: String(body.query ?? "").slice(0, 2000),
    scope: parseScope(body.scope),
  });
  if (!result.ok) {
    return NextResponse.json(
      {
        error:
          result.reason === "duplicate"
            ? "A view with that name already exists here. Two views with one name is how a shared filter stops being shared."
            : NAME_PROBLEM_MESSAGE.empty,
      },
      { status: 409 }
    );
  }
  return NextResponse.json({ ok: true, id: result.id });
}
