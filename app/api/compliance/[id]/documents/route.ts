import { NextResponse } from "next/server";
import { requireOrgContext } from "@/lib/org-guard";
import { attachDocument } from "@/lib/compliance-documents";
import { logAgent } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * File the actual certificate against a compliance item.
 *
 * Until now the only place to put one was a `doc_url` text box whose
 * placeholder suggested a Drive link. A link is not evidence: it breaks when
 * somebody leaves or a folder moves, and it cannot be produced in an audit.
 *
 * Several files in one post, because that is how they arrive: the broker sends
 * the policy and the endorsement together, and making somebody upload them one
 * at a time is how the second one never gets uploaded.
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const ctx = await requireOrgContext({ capability: "manage_compliance" });
  if (ctx instanceof NextResponse) return ctx;
  const { user: auth, orgId } = ctx;

  const form = await req.formData().catch(() => null);
  if (!form) {
    return NextResponse.json({ error: "Expected multipart form data." }, { status: 400 });
  }

  const files = form.getAll("file").filter((f): f is File => f instanceof File);
  if (files.length === 0) {
    return NextResponse.json({ error: "Attach at least one file." }, { status: 400 });
  }

  const kind = typeof form.get("kind") === "string" ? String(form.get("kind")) : null;
  const note = typeof form.get("note") === "string" ? String(form.get("note")) : null;
  const replaces =
    typeof form.get("replaces") === "string" && String(form.get("replaces")).trim()
      ? String(form.get("replaces")).trim()
      : null;

  /*
   * Every file gets its own answer, and one bad file does not throw away the
   * good ones. A batch that fails as a unit means somebody who attached four
   * certificates and one 40 MB scan has to work out which was which and start
   * again, and the usual outcome is that they attach the one they remember.
   */
  const stored: string[] = [];
  const failed: { name: string; error: string }[] = [];
  for (const file of files) {
    const outcome = await attachDocument({
      orgId,
      itemId: params.id,
      file,
      kind,
      note,
      actorId: auth.id,
      // Only the first file can replace a named one. Pointing several new
      // files at one superseded row would leave the record unable to say
      // which of them replaced it.
      replaces: stored.length === 0 ? replaces : null,
    });
    if (outcome.ok) stored.push(outcome.id);
    else failed.push({ name: file.name, error: outcome.error });
  }

  if (stored.length > 0) {
    await logAgent({
      agent: "operator",
      action: "compliance-document",
      level: "info",
      message: `${auth.email} filed ${stored.length} document${stored.length === 1 ? "" : "s"} against a compliance item.`,
    });
  }

  // A post where nothing landed is a failure, whatever the per-file detail
  // says, and returning 200 for it would let the form clear itself.
  const status = stored.length === 0 ? 400 : 200;
  return NextResponse.json(
    {
      ok: stored.length > 0,
      stored: stored.length,
      failed,
      error: stored.length === 0 ? failed[0]?.error ?? "Nothing was stored." : undefined,
    },
    { status }
  );
}
