import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api-auth";
import { query } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Editable outreach template slugs (operators cannot add new slugs). */
const EDITABLE_SLUGS = ["template_1_outreach", "template_2_followup"] as const;

/** Return the active version of each editable outreach template. */
export async function GET() {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;

  const templates = await query<{
    id: string;
    slug: string;
    version: number;
    subject: string | null;
    body: string;
    description: string | null;
  }>(
    `SELECT DISTINCT ON (slug) id, slug, version, subject, body, description
       FROM templates
      WHERE slug = ANY($1) AND is_active = true
      ORDER BY slug, version DESC`,
    [EDITABLE_SLUGS]
  );

  return NextResponse.json({ templates });
}
