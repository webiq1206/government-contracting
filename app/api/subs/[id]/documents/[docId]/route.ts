import { NextResponse } from "next/server";
import { requireOrgContext } from "@/lib/org-guard";
import { loadSubForOperator } from "@/lib/sub-access";
import { setDocumentDecision } from "@/lib/sub-compliance-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Verify or reject a document.
 *
 * This is the step assessCompliance is waiting on. An upload proves somebody
 * sent a file; it does not prove the policy is real, names the right insured,
 * or carries the limits the solicitation asks for. Somebody has to look, and
 * until they do the subcontractor stays blocked.
 */
export async function POST(
  req: Request,
  { params }: { params: { id: string; docId: string } }
) {
  const ctx = await requireOrgContext();
  if (ctx instanceof NextResponse) return ctx;
  const { user: auth } = ctx;

  const sub = await loadSubForOperator(params.id);
  if (!sub) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = (await req.json().catch(() => ({}))) as { action?: string; reason?: string };
  const action = body.action === "reject" ? "reject" : body.action === "verify" ? "verify" : null;
  if (!action) {
    return NextResponse.json({ error: "Choose verify or reject." }, { status: 400 });
  }
  // A rejection the subcontractor cannot act on is a wasted round trip: they
  // resend the same certificate and it gets rejected again.
  if (action === "reject" && !body.reason?.trim()) {
    return NextResponse.json(
      { error: "Say what is wrong with it, so the sub knows what to send instead." },
      { status: 400 }
    );
  }

  const updated = await setDocumentDecision(sub.id, params.docId, {
    action,
    userId: auth.id,
    reason: body.reason,
  });
  if (!updated) {
    return NextResponse.json({ error: "That document is no longer on file." }, { status: 404 });
  }

  return NextResponse.json({ ok: true, document: updated });
}
