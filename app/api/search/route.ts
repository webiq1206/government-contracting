import { NextResponse } from "next/server";
import { requireOrgContext } from "@/lib/org-guard";
import { searchEverything } from "@/lib/search";
import type { SearchResult } from "@/lib/domain/search-results";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export type { SearchResult };

/**
 * The overlay's data source.
 *
 * The queries themselves live in lib/search so the full results page runs the
 * same ones: two copies would drift, and the way anybody would find out is a
 * record appearing in one surface and not the other, which reads as data loss
 * rather than as a bug.
 */
export async function GET(req: Request) {
  const ctx = await requireOrgContext();
  if (ctx instanceof NextResponse) return ctx;

  const q = new URL(req.url).searchParams.get("q")?.trim() ?? "";
  const results = await searchEverything(q, ctx.orgId);
  return NextResponse.json({ results });
}
