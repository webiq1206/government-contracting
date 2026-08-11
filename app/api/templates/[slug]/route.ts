import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api-auth";
import { saveTemplateVersion } from "@/lib/domain/template-versions";
import { logAgent } from "@/lib/logger";
import { sendOutreachEmail } from "@/lib/integrations/email-transport";
import { renderTemplate, plainToHtml } from "@/lib/domain/template-render";
import { query } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Editable outreach template slugs (operators cannot create new slugs). */
const EDITABLE_SLUGS = ["template_1_outreach", "template_2_followup"];

/**
 * Return version history for a template slug.
 *
 * GET /api/templates/[slug]?history=true
 *
 * Returns the last 5 saved versions (newest first) with id, version, subject,
 * body, is_active, and created_at. The active version is flagged so the UI can
 * label it as "current".
 */
export async function GET(
  req: Request,
  { params }: { params: { slug: string } }
) {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;

  const { slug } = params;
  if (!EDITABLE_SLUGS.includes(slug)) {
    return NextResponse.json({ error: "Template not found" }, { status: 404 });
  }

  const url = new URL(req.url);
  if (url.searchParams.get("history") !== "true") {
    return NextResponse.json({ error: "Use ?history=true" }, { status: 400 });
  }

  const rows = await query<{
    id: string;
    version: number;
    subject: string | null;
    body: string;
    is_active: boolean;
    created_at: string;
  }>(
    `SELECT id, version, subject, body, is_active, created_at
       FROM templates
      WHERE slug = $1
      ORDER BY version DESC
      LIMIT 5`,
    [slug]
  );

  return NextResponse.json({ versions: rows });
}

/** Sample values used in the preview modal — kept in sync with the editor UI. */
const SAMPLE: Record<string, string> = {
  owner_name: "Marcus",
  company_name: "BROSTCO Holdings LLC",
  opportunity_title: "HVAC Maintenance Services, Building 36C",
  location_state: "Virginia",
  deadline: "Aug 25, 2026",
  trade: "HVAC",
  scope_summary:
    "replace HVAC units in 4 buildings, approximately 120,000 sq ft total",
  questions:
    "- Do you have experience with federal facilities in Virginia?\n- Can you provide bonding and insurance certificates within 48 hours?",
  sender_name: "Jared",
  phone: "(800) 555-0199",
  solicitation_number: "W912DR-26-R-0042",
  agency: "US Army Corps of Engineers",
};

/**
 * Send a test copy of the current (unsaved) template to the logged-in
 * operator's email address.
 *
 * Body: { subject?: string; body: string }
 *
 * Renders with the same sample values shown in the preview modal, prefixes
 * the subject with "[TEST]", and fires through the existing outreach transport.
 * Does NOT mutate the database.
 */
export async function POST(
  req: Request,
  { params }: { params: { slug: string } }
) {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;

  const { slug } = params;
  if (!EDITABLE_SLUGS.includes(slug)) {
    return NextResponse.json({ error: "Template not found" }, { status: 404 });
  }

  const body = (await req.json().catch(() => null)) as {
    subject?: string;
    body?: string;
  } | null;

  if (!body || typeof body.body !== "string" || !body.body.trim()) {
    return NextResponse.json({ error: "body is required" }, { status: 400 });
  }

  const rawSubject = (typeof body.subject === "string" ? body.subject.trim() : "") || "(no subject)";
  const rawBody = body.body.trim();

  const renderedSubject = renderTemplate(rawSubject, SAMPLE);
  const renderedBodyPlain = renderTemplate(rawBody, SAMPLE);
  const renderedBodyHtml = plainToHtml(renderedBodyPlain);

  const result = await sendOutreachEmail({
    to: auth.email,
    subject: `[TEST] ${renderedSubject}`,
    html: renderedBodyHtml,
    text: renderedBodyPlain,
  });

  if (result.disabled) {
    return NextResponse.json(
      { error: result.error ?? "No email transport available." },
      { status: 503 }
    );
  }
  if (result.error) {
    return NextResponse.json({ error: result.error }, { status: 502 });
  }

  await logAgent({
    agent: "operator",
    action: "template-test-send",
    level: "info",
    message: `${auth.email} sent a test email for ${slug}.`,
  });

  return NextResponse.json({ ok: true, sentTo: auth.email });
}

/**
 * Save a new version of an outreach template.
 *
 * Body: { subject?: string; body: string }
 *
 * Delegates to saveTemplateVersion(), which serialises concurrent saves with a
 * transaction-scoped advisory lock so (slug, version) uniqueness is never
 * violated even under simultaneous PATCH requests.
 */
export async function PATCH(
  req: Request,
  { params }: { params: { slug: string } }
) {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;

  const { slug } = params;
  if (!EDITABLE_SLUGS.includes(slug)) {
    return NextResponse.json({ error: "Template not found" }, { status: 404 });
  }

  const body = (await req.json().catch(() => null)) as {
    subject?: string;
    body?: string;
  } | null;

  if (!body || typeof body.body !== "string" || !body.body.trim()) {
    return NextResponse.json({ error: "body is required" }, { status: 400 });
  }

  const subject =
    typeof body.subject === "string" ? body.subject.trim() || null : null;
  const newBody = body.body.trim();

  try {
    const inserted = await saveTemplateVersion(slug, subject, newBody);

    await logAgent({
      agent: "operator",
      action: "template-update",
      level: "info",
      message: `${auth.email} saved ${slug} v${inserted.version}.`,
    });

    return NextResponse.json({ ok: true, version: inserted.version });
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status === 404) {
      return NextResponse.json({ error: "Template not found" }, { status: 404 });
    }
    throw err;
  }
}
