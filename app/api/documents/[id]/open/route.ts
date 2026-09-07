import { NextResponse } from "next/server";
import { requireOrgContext } from "@/lib/org-guard";
import { queryOne } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Open a document by its inventory id, at a page.
 *
 * Requirements carry a document id, not a storage path. Threading paths
 * through every component that shows a requirement would spread one tenant
 * check across a dozen call sites, and the check is the entire reason this
 * route exists: a document id is a UUID somebody can put in a URL.
 *
 * `#page=N` is the PDF fragment convention, understood by Chrome, Firefox,
 * Safari and Acrobat. A viewer that does not understand it opens page one,
 * which is the right way for this to degrade.
 */
export async function GET(req: Request, { params }: { params: { id: string } }) {
  const ctx = await requireOrgContext();
  if (ctx instanceof NextResponse) return ctx;

  const doc = await queryOne<{ storage_path: string | null }>(
    `select storage_path from documents where id = $1 and org_id = $2`,
    [params.id, ctx.orgId]
  );

  /*
   * One 404 for every failure: no such document, another tenant's document, a
   * row whose bytes were never stored. Distinguishing them would confirm that
   * a document id exists and belongs to somebody else, which is the fact worth
   * hiding.
   *
   * Rows without an owner are unavailable until an operator repairs them from
   * auditable evidence. Missing ownership never becomes an access rule.
   */
  if (!doc?.storage_path) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const page = Number(new URL(req.url).searchParams.get("page"));
  const fragment = Number.isInteger(page) && page > 0 ? `#page=${page}` : "";
  return NextResponse.redirect(
    new URL(`/api/files/${doc.storage_path}${fragment}`, req.url)
  );
}
