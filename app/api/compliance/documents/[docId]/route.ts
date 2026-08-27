import { NextResponse } from "next/server";
import { requireOrgContext } from "@/lib/org-guard";
import { documentPath, removeDocument } from "@/lib/compliance-documents";
import { storage } from "@/lib/integrations/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Open a filed compliance document.
 *
 * By id rather than by storage path, for the same reason the documents
 * inventory does it: a path threaded through every component that lists a
 * file spreads one tenant check across a dozen call sites, and the check is
 * the whole reason this route exists.
 */
export async function GET(_req: Request, { params }: { params: { docId: string } }) {
  const ctx = await requireOrgContext();
  if (ctx instanceof NextResponse) return ctx;

  const doc = await documentPath(ctx.orgId, params.docId);
  // One 404 for both "no such file" and "another organization's file".
  // Telling them apart would confirm that an id exists and belongs to
  // somebody else, which is the fact worth hiding.
  if (!doc) return NextResponse.json({ error: "Not found" }, { status: 404 });

  /*
   * Served here rather than redirected to /api/files.
   *
   * That route names the download from the last segment of the storage key,
   * which carries the timestamp prefix that keeps keys unique: somebody who
   * saved their certificate got "1787817652651-gl-policy.pdf". This route
   * knows the name the file was uploaded under, and the org check it just
   * made is the same one the redirect would have repeated.
   */
  let bytes: Buffer;
  try {
    bytes = await storage.download(doc.storage_path);
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": doc.mime_type || "application/octet-stream",
      "Content-Disposition": `inline; filename="${doc.original_filename.replace(/["\\\r\n]/g, "")}"`,
      // The stored type is whatever a browser reported at upload, so it is
      // not to be trusted into a sniffing decision.
      "X-Content-Type-Options": "nosniff",
    },
  });
}

/**
 * Take a mis-filed document off the record.
 *
 * Distinct from replacing one. A superseded certificate is history worth
 * keeping; a file attached to the wrong item, or one carrying somebody's
 * personal details that should never have been here, is a mistake, and
 * keeping it to satisfy a filing principle serves nobody in it.
 */
export async function DELETE(_req: Request, { params }: { params: { docId: string } }) {
  const ctx = await requireOrgContext({ capability: "manage_compliance" });
  if (ctx instanceof NextResponse) return ctx;

  const result = await removeDocument(ctx.orgId, params.docId, ctx.user.id);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 404 });
  return NextResponse.json({ ok: true });
}
