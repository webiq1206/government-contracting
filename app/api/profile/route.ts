import { NextResponse } from "next/server";
import { requireOrgContext } from "@/lib/org-guard";
import {
  publishProfile,
  renderProfileText,
  getActiveProfile,
  withProfileDefaults,
} from "@/lib/ai/companyProfile";
import type { CompanyProfileJson } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Save a new active Company Profile version. All agents immediately use it.
 *
 * The body is MERGED over the current profile rather than replacing it. The
 * settings editor sends a complete object, for which merge and replace are the
 * same thing; the SAM.gov import sends only the fields SAM actually returned.
 * Replacing on a partial body would have quietly wiped every field the import
 * did not mention, which on this record means scoring thresholds and pricing
 * rules.
 *
 * A key set to an explicit empty value (an empty certifications array, say)
 * still overwrites, so clearing a field from the editor works. Only keys the
 * caller omits entirely are preserved.
 */
export async function POST(req: Request) {
  const ctx = await requireOrgContext({ capability: "manage_profile" });
  if (ctx instanceof NextResponse) return ctx;

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Invalid profile JSON." }, { status: 400 });
  }

  const current = await getActiveProfile({ fresh: true });
  const merged = withProfileDefaults({
    ...((current?.profile_json as Partial<CompanyProfileJson>) ?? {}),
    ...(body as Partial<CompanyProfileJson>),
  });

  if (!merged.legal_name?.trim()) {
    return NextResponse.json({ error: "legal_name is required." }, { status: 400 });
  }

  const text = renderProfileText(merged);
  const profile = await publishProfile(merged, text, ctx.user.email);
  return NextResponse.json({ ok: true, version: profile.version });
}

export async function GET() {
  const ctx = await requireOrgContext();
  if (ctx instanceof NextResponse) return ctx;
  const profile = await getActiveProfile({ fresh: true });
  return NextResponse.json({ profile });
}
