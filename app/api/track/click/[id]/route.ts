import { NextResponse } from "next/server";
import { query } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Email click tracking: records the click, then redirects to the real URL. */
export async function GET(req: Request, { params }: { params: { id: string } }) {
  const url = new URL(req.url);
  const target = url.searchParams.get("u");
  await query(
    `update communications set clicked_at = coalesce(clicked_at, now()) where tracking_id = $1`,
    [params.id]
  ).catch(() => {});

  // Only redirect to well-formed absolute http(s) URLs (open-redirect guard).
  if (target && /^https?:\/\//i.test(target)) {
    try {
      return NextResponse.redirect(new URL(target).toString(), 302);
    } catch {
      /* fall through */
    }
  }
  return NextResponse.json({ ok: true });
}
