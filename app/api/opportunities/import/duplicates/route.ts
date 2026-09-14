import { NextResponse } from "next/server";
import { requireOrgContext } from "@/lib/org-guard";
import { findSolicitationDuplicates } from "@/lib/solicitation-import";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Records that look like the one being typed in, before it is saved. */
export async function POST(req: Request) {
  const ctx = await requireOrgContext({ capability: "decide" });
  if (ctx instanceof NextResponse) return ctx;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const s = (k: string) => (typeof body[k] === "string" ? (body[k] as string).trim().slice(0, 500) : null);
  const duplicates = await findSolicitationDuplicates(ctx.orgId, {
    title: s("title"),
    solicitation_number: s("solicitation_number"),
    source_url: s("url"),
  });
  return NextResponse.json({ duplicates });
}
