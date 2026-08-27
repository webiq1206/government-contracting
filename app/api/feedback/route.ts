import { NextResponse } from "next/server";
import { requireOrgContext } from "@/lib/org-guard";
import { submitFeedback, feedbackFor } from "@/lib/feedback";
import { logAgent } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Send feedback about the product.
 *
 * Deliberately ungated: every role may say the product is wrong, including
 * the read-only ones. A viewer looking at a number that does not add up is
 * exactly the person who should be able to report it, and a permission check
 * here would only teach them that reporting it is somebody else's job.
 *
 * Still tenant-scoped. The report belongs to the organization the sender is
 * signed in to, and nothing about another one can be reached from here.
 */
export async function POST(req: Request) {
  const ctx = await requireOrgContext({ requireBilling: false });
  if (ctx instanceof NextResponse) return ctx;
  const { user: auth, orgId } = ctx;

  const form = await req.formData().catch(() => null);
  if (!form) {
    return NextResponse.json({ error: "Send the report as a form." }, { status: 400 });
  }

  const screenshot = form.get("screenshot");
  const rawDiagnostics = form.get("diagnostics");
  let diagnostics: unknown = null;
  if (typeof rawDiagnostics === "string" && rawDiagnostics.length > 0) {
    try {
      diagnostics = JSON.parse(rawDiagnostics);
    } catch {
      // Unparseable context is dropped rather than stored as a string. The
      // report is the point; this is decoration on it.
      diagnostics = null;
    }
  }

  const result = await submitFeedback({
    orgId,
    userId: auth.id === "env-operator" ? null : auth.id,
    userEmail: auth.email ?? null,
    category: String(form.get("category") ?? ""),
    message: String(form.get("message") ?? ""),
    page: typeof form.get("page") === "string" ? String(form.get("page")) : null,
    userAgent: req.headers.get("user-agent"),
    diagnostics,
    diagnosticsConsented: form.get("consent") === "true",
    screenshot: screenshot instanceof File ? screenshot : null,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  await logAgent({
    agent: "operator",
    action: "feedback",
    level: "info",
    message: `${auth.email} sent feedback about ${String(form.get("category") ?? "the product")}.`,
  });

  return NextResponse.json({
    ok: true,
    id: result.id,
    screenshotStored: result.screenshotStored,
    note: result.screenshotProblem ?? null,
  });
}

/** This organization's own reports, so somebody can see what was already said. */
export async function GET() {
  const ctx = await requireOrgContext({ requireBilling: false });
  if (ctx instanceof NextResponse) return ctx;
  return NextResponse.json({ reports: await feedbackFor(ctx.orgId) });
}
