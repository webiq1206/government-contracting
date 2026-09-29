import { NextResponse } from "next/server";
import { requireOrgContext } from "@/lib/org-guard";
import { saveTemplateVersion } from "@/lib/domain/template-versions";
import { logAgent } from "@/lib/logger";
import { sendOutreachEmail } from "@/lib/integrations/email-transport";
import { templateHistory } from "@/lib/domain/template-store";
import { validateTemplate } from "@/lib/domain/outreach-validation";
import { isEditableTemplateSlug } from "@/lib/domain/template-slugs";
import { buildOutreachTest } from "@/lib/outreach-test";
import { consume } from "@/lib/rate-limit";
import { runWithOrg } from "@/lib/tenant-context";
import { can } from "@/lib/domain/roles";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
export async function GET(req: Request, props: { params: Promise<{ slug: string }> }) {
  const params = await props.params;
  const ctx = await requireOrgContext();
  if (ctx instanceof NextResponse) return ctx;
  const { orgId } = ctx;

  const { slug } = params;
  if (!isEditableTemplateSlug(slug)) {
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
 * Send one controlled copy through the account's ordinary outreach transport.
 * An optional recipient permits testing inbox placement in another mailbox.
 * Real bid context uses the same packet and content checks as outreach.
 *
 * Body: { subject?: string; body: string }
 *
 * No original contact is changed and no automated follow-up is scheduled.
 */
export async function POST(req: Request, props: { params: Promise<{ slug: string }> }) {
  const params = await props.params;
  const ctx = await requireOrgContext({ capability: "manage_content" });
  if (ctx instanceof NextResponse) return ctx;
  const { user: auth, orgId } = ctx;
  if (!can(auth.orgRole, "outreach")) {
    return NextResponse.json({ error: "You do not have permission to send outreach." }, { status: 403 });
  }

  const { slug } = params;
  if (!isEditableTemplateSlug(slug)) {
    return NextResponse.json({ error: "Template not found" }, { status: 404 });
  }

  const parsed = z.object({
    subject: z.string().max(500).optional(),
    body: z.string().trim().min(1).max(20000),
    recipient: z.string().trim().email().max(254).optional(),
    pair: z.object({ opportunityId: z.string().uuid(), subcontractorId: z.string().uuid(), trade: z.string().max(300) }).optional(),
  }).safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Enter a valid template and one test email address." }, { status: 400 });
  }
  const body = parsed.data;
  const recipient = body.recipient ?? auth.email;

  const rawSubject = (typeof body.subject === "string" ? body.subject.trim() : "") || "(no subject)";
  const rawBody = body.body.trim();

  const invalid = templateProblemResponse({ subject: rawSubject, body: rawBody });
  if (invalid) return invalid;

  const limit = consume("outreach-template-test", orgId, { limit: 5, windowMs: 60 * 60_000 });
  if (!limit.ok) return NextResponse.json({ error: "This account has reached five test sends per hour. Try again later." },
    { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } });
  let packet: Awaited<ReturnType<typeof buildOutreachTest>>;
  try {
    packet = await runWithOrg(orgId, () => buildOutreachTest(orgId, { subject: rawSubject, body: rawBody }, body.pair));
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 422 });
  }

  const result = await sendOutreachEmail({
    to: recipient,
    subject: packet.subject,
    html: packet.html,
    text: packet.text,
    attachments: packet.attachments,
    orgId,
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
  if (!result.messageId) {
    return NextResponse.json({ error: "Gmail did not return a message receipt. Delivery is unconfirmed. Check Sent before retrying." }, { status: 502 });
  }

  await runWithOrg(orgId, () => logAgent({
    agent: "operator",
    action: "template-test-send",
    level: "info",
    message: `${auth.email} sent a controlled ${packet.mode} test for ${slug} to ${recipient}. Gmail accepted message ${result.messageId}; inbox placement is not yet verified.`,
    output: { recipient, mode: packet.mode, messageId: result.messageId, threadId: result.threadId,
      attachmentCount: packet.attachments.length },
  })).catch(error => console.error("[template-test] Gmail accepted the message, but the audit write failed", error));

  return NextResponse.json({ ok: true, sentTo: recipient, messageId: result.messageId,
    mode: packet.mode, attachmentCount: packet.attachments.length, delivery: "provider_accepted" });
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
export async function PATCH(req: Request, props: { params: Promise<{ slug: string }> }) {
  const params = await props.params;
  const ctx = await requireOrgContext({ capability: "manage_content" });
  if (ctx instanceof NextResponse) return ctx;
  const { user: auth, orgId } = ctx;

  const { slug } = params;
  if (!isEditableTemplateSlug(slug)) {
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
    const inserted = await saveTemplateVersion(slug, subject, newBody, orgId, auth.email);

    await logAgent({
      agent: "operator",
      action: "template-update",
      level: "info",
      message: `${auth.email} saved ${slug} v${inserted.version} as a draft.`,
    });

    return NextResponse.json({
      ok: true,
      version: inserted.version,
      // The saved draft, echoed back so the editor can say plainly what is
      // waiting and what is still going out. Without it the page would have
      // to guess its own timestamp and would report "just now" for a save
      // the database stamped a second earlier.
      draft: {
        version: inserted.version,
        subject,
        body: newBody,
        draftedAt: inserted.draftedAt,
        draftedBy: auth.email,
      },
    });
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status === 404) {
      return NextResponse.json({ error: "Template not found" }, { status: 404 });
    }
    throw err;
  }
}
