import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api-auth";
import { loadGuideBundle } from "@/lib/guide/load";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Context-aware guidance for the Guide Me panel. The facts come from
 * loadGuideBundle, which the Q&A endpoint calls too, so an answer and the
 * panel it is answering about cannot describe different accounts.
 */
export async function GET(req: Request) {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;

  const url = new URL(req.url);
  const pathname = url.searchParams.get("path") || "/today";

  return NextResponse.json(await loadGuideBundle(auth, pathname));
}
