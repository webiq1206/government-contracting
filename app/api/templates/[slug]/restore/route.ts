import { NextResponse } from "next/server";
import { requireOrgContext } from "@/lib/org-guard";
import { saveTemplateVersion } from "@/lib/domain/template-versions";
import { logAgent } from "@/lib/logger";
import { query } from "@/lib/db";
import { LEGACY_ORG_ID } from "@/lib/tenant-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EDITABLE_SLUGS = ["template_1_outreach", "template_2_followup"];

/**
 * Restore a previous template version.
 *
 * Body: { version: number }
 *
 * Reads the requested version row and saves its subject/body as a new version
 * (version N+1), making it the new active version. The editor fields are NOT
 * automatically overwritten — the operator chooses to restore after comparing.
 */
export async function POST(
  req: Request,
  { params }: { params: { slug: string } }
) {
  const ctx = await requireOrgContext({ capability: "manage_content" });
  if (ctx instanceof NextResponse) return ctx;
  const { user: auth, orgId } = ctx;

  const { slug } = params;
  if (!EDITABLE_SLUGS.includes(slug)) {
    return NextResponse.json({ error: "Template not found" }, { status: 404 });
  }

  const body = (await req.json().catch(() => null)) as {
    version?: number;
  } | null;

  if (!body || typeof body.version !== "number") {
    return NextResponse.json({ error: "version is required" }, { status: 400 });
  }

  // Look up the requested historical version.
  // Restore from the same lineage the history endpoint showed: the org's own
  // versions once any exist, else the platform default lineage.
  const rows = await query<{ subject: string | null; body: string }>(
    `SELECT subject, body FROM templates
      WHERE slug = $1 AND version = $2 AND org_id in ($3, $4)
      ORDER BY (org_id = $3) DESC LIMIT 1`,
    [slug, body.version, orgId, LEGACY_ORG_ID]
  );

  if (rows.length === 0) {
    return NextResponse.json(
      { error: `Version ${body.version} not found for ${slug}` },
      { status: 404 }
    );
  }

  const source = rows[0];

  try {
    const inserted = await saveTemplateVersion(slug, source.subject, source.body, orgId);

    await logAgent({
      agent: "operator",
      action: "template-restore",
      level: "info",
      message: `${auth.email} restored ${slug} v${body.version} → new v${inserted.version}.`,
    });

    return NextResponse.json({
      ok: true,
      version: inserted.version,
      subject: source.subject,
      body: source.body,
    });
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status === 404) {
      return NextResponse.json({ error: "Template not found" }, { status: 404 });
    }
    throw err;
  }
}
