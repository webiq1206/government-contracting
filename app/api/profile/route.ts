import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api-auth";
import { publishProfile, renderProfileText, getActiveProfile } from "@/lib/ai/companyProfile";
import type { CompanyProfileJson } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Save a new active Company Profile version. All agents immediately use it. */
export async function POST(req: Request) {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid profile JSON." }, { status: 400 });
  }
  const json = body as CompanyProfileJson;
  if (!json.legal_name) {
    return NextResponse.json({ error: "legal_name is required." }, { status: 400 });
  }

  const text = renderProfileText(json);
  const profile = await publishProfile(json, text, auth.email);
  return NextResponse.json({ ok: true, version: profile.version });
}

export async function GET() {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;
  const profile = await getActiveProfile({ fresh: true });
  return NextResponse.json({ profile });
}
