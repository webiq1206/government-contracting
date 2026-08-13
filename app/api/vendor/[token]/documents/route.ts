import { NextResponse } from "next/server";
import { decodePortalToken } from "@/lib/domain/sub-portal-link";
import {
  loadPortalSubject,
  parseComplianceUpload,
  recordUploadedDocument,
} from "@/lib/sub-compliance-store";
import { guardRejectedToken, guardWrite } from "@/lib/vendor-throttle";
import { logAgent } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * A subcontractor sends us a certificate of insurance, a license, or a W-9
 * they already have signed on paper.
 *
 * Token-scoped like the signing route: the subcontractor id comes from the
 * token and never from the form, so a valid link cannot be pointed at someone
 * else's record by editing a hidden field.
 */
export async function POST(req: Request, { params }: { params: { token: string } }) {
  const pointer = decodePortalToken(params.token);
  if (!pointer) {
    return (
      guardRejectedToken(req) ??
      NextResponse.json(
        {
          error:
            "This link has expired. Reply to the email you received and we will send a new one.",
        },
        { status: 403 }
      )
    );
  }

  // Ahead of formData(), which is what actually buffers the upload. Checking
  // after it would mean a rejected request had already cost us the full 12 MB.
  const throttled = guardWrite(req, pointer.s, "upload");
  if (throttled) return throttled;

  const sub = await loadPortalSubject(pointer.s);
  if (!sub) {
    return NextResponse.json({ error: "This link is no longer valid." }, { status: 404 });
  }

  const form = await req.formData().catch(() => null);
  if (!form) {
    return NextResponse.json({ error: "We could not read that upload." }, { status: 400 });
  }

  const parsed = await parseComplianceUpload(form);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  try {
    const result = await recordUploadedDocument(sub, { ...parsed.value, source: "subcontractor" });
    return NextResponse.json({
      ok: true,
      id: result.id,
      message: "Got it. Brost Co will check it over, and we will be in touch if anything is missing.",
    });
  } catch (err) {
    await logAgent({
      agent: "compliance",
      action: "document-upload-failed",
      subcontractorId: sub.id,
      level: "error",
      status: "error",
      message: `An upload from ${sub.company_name} could not be saved: ${(err as Error).message}`,
    });
    return NextResponse.json(
      {
        error:
          "We could not save that, and it is our end rather than yours. Reply to the email you received and we will sort it out.",
      },
      { status: 500 }
    );
  }
}
