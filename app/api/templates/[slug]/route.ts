import { NextResponse } from "next/server";
import { requireOrgContext } from "@/lib/org-guard";
import { saveTemplateVersion } from "@/lib/domain/template-versions";
import { logAgent } from "@/lib/logger";
import { sendOutreachEmail } from "@/lib/integrations/email-transport";
import { renderTemplate, plainToHtml } from "@/lib/domain/template-render";
import { templateHistory } from "@/lib/domain/template-store";
import {
  TEMPLATE_TOKEN_SAMPLES,
  previewBriefSections,
} from "@/lib/domain/template-tokens";
import { renderOutreachBrief } from "@/lib/domain/outreach-email";
import { validateTemplate } from "@/lib/domain/outreach-validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Editable outreach template slugs (operators cannot create new slugs). */
const EDITABLE_SLUGS = [
  "template_1_outreach",
  "template_2_followup",
  // The fallback body, used only when the original thread cannot be replied
  // to. Editable for the same reason the others are: it is the email a
  // subcontractor reads.
  "template_2_followup_new_thread",
];

/**
 * Refuse a template that would break at send time.
 *
 * Applied on save, on publish and on test send, deliberately at all three. A
 * template with a bad variable in it is a defect that reaches a real
 * subcontractor when the follow-up scheduler runs at 3am, and by then nobody
 * is watching. Catching it while the operator is looking at the editor is the
 * only moment they can do anything about it.
 */
function templateProblemResponse(input: { subject?: string | null; body: string }) {
  const problems = validateTemplate(input);
  if (!problems.length) return null;
  return NextResponse.json(
    {
      error: problems.map((p) => p.message).join(" "),
      problems,
    },
    { status: 422 }
  );
}

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
  const ctx = await requireOrgContext();
  if (ctx instanceof NextResponse) return ctx;
  const { orgId } = ctx;

  const { slug } = params;
  if (!EDITABLE_SLUGS.includes(slug)) {
    return NextResponse.json({ error: "Template not found" }, { status: 404 });
  }

  const url = new URL(req.url);
  if (url.searchParams.get("history") !== "true") {
    return NextResponse.json({ error: "Use ?history=true" }, { status: 400 });
  }

  const rows = await templateHistory(slug, orgId);

  return NextResponse.json({ versions: rows });
}

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
  const ctx = await requireOrgContext();
  if (ctx instanceof NextResponse) return ctx;
  const { user: auth, orgId } = ctx;

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

  const invalid = templateProblemResponse({ subject: rawSubject, body: rawBody });
  if (invalid) return invalid;

  const renderedSubject = renderTemplate(rawSubject, TEMPLATE_TOKEN_SAMPLES);
  const renderedBodyPlain = renderTemplate(rawBody, TEMPLATE_TOKEN_SAMPLES);
  const details = renderOutreachBrief(previewBriefSections());
  const renderedBodyHtml = plainToHtml(renderedBodyPlain) + details.html;

  const result = await sendOutreachEmail({
    to: auth.email,
    subject: `[TEST] ${renderedSubject}`,
    html: renderedBodyHtml,
    text: renderedBodyPlain + details.plain,
  });

  if (result.disabled) {
    return NextResponse.json(
      { error: result.error ?? "No email transport available." },
      { status: 503 }
    );
  }
  if (result.blocked) {
    // The template itself would render badly — the operator can fix this here,
    // so report it as a content problem rather than a delivery failure.
    return NextResponse.json({ error: result.error }, { status: 422 });
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
  const ctx = await requireOrgContext();
  if (ctx instanceof NextResponse) return ctx;
  const { user: auth, orgId } = ctx;

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

  const invalid = templateProblemResponse({ subject, body: newBody });
  if (invalid) return invalid;

  try {
    const inserted = await saveTemplateVersion(slug, subject, newBody, orgId);

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
