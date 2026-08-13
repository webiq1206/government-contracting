import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api-auth";
import { loadSubForOperator } from "@/lib/sub-access";
import { parseComplianceUpload, recordUploadedDocument } from "@/lib/sub-compliance-store";
import { logAgent } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Staff filing a document a subcontractor sent some other way, which in this
 * trade is most of them: a certificate faxed by the sub's broker, a W-9
 * scanned off a clipboard.
 *
 * Note what this route can and cannot do. It files documents, including a W-9
 * the subcontractor already signed on paper. It cannot create a signature.
 * There is no operator path to /api/vendor/[token]/w9, and the row it writes
 * is marked source 'operator' so the difference between "they signed it here"
 * and "we filed their paper" survives into the audit trail.
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;

  const sub = await loadSubForOperator(params.id);
  if (!sub) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const form = await req.formData().catch(() => null);
  if (!form) {
    return NextResponse.json({ error: "Expected multipart form data." }, { status: 400 });
  }

  const parsed = await parseComplianceUpload(form);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const result = await recordUploadedDocument(sub, { ...parsed.value, source: "operator" });

  await logAgent({
    agent: "operator",
    action: "compliance-upload",
    subcontractorId: sub.id,
    level: "info",
    message: `Operator ${auth.email} filed a ${parsed.value.docType} for ${sub.company_name}.`,
  });

  return NextResponse.json({ ok: true, id: result.id });
}
