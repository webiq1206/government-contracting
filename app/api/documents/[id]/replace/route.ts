import { NextResponse } from "next/server";
import { requireOrgContext } from "@/lib/org-guard";
import { query, queryOne } from "@/lib/db";
import { storage } from "@/lib/integrations/storage";
import { logAgent } from "@/lib/logger";
import { enqueue } from "@/lib/queue";
import { LEGACY_ORG_ID } from "@/lib/tenant-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 12 * 1024 * 1024;

/**
 * Upload a working copy of a document the platform could not read.
 *
 * The commonest unreadable file in a federal solicitation is a scan with no
 * text layer, and the commonest fix is that somebody already has a clean copy:
 * the agency emailed it, or the portal offers a second format, or a colleague
 * downloaded it before it was corrupted. Until now there was nowhere to put
 * that copy. "Read it again" re-runs the analysis over the same bytes, which
 * fail again for the same reason, and an ordinary upload creates a second
 * document sitting beside the broken one with nothing to say which is which.
 *
 * So this supersedes: the old row stays, marked, pointing at the new one. The
 * inventory keeps a complete account of what arrived and what happened to it,
 * which is the point of an inventory, and the new copy carries the version
 * after it rather than starting again at one.
 *
 * Re-analysis is queued, because a corrected copy that nobody reads is a file
 * on a screen rather than requirements in a brief.
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const ctx = await requireOrgContext({ capability: "decide" });
  if (ctx instanceof NextResponse) return ctx;
  const { orgId } = ctx;

  const doc = await queryOne<{
    id: string;
    org_id: string | null;
    opportunity_id: string | null;
    kind: string;
    name: string;
    version: number;
    document_class: string | null;
    amendment_number: number | null;
    requirement_id: string | null;
    superseded_by: string | null;
  }>(
    `select id, org_id, opportunity_id, kind, name, version, document_class,
            amendment_number, requirement_id, superseded_by
       from documents where id = $1`,
    [params.id]
  );

  /*
   * One 404 for every failure, the same as the open route: no such document,
   * another tenant's, or one with no opportunity behind it. Distinguishing
   * them would confirm that a document id exists and belongs to somebody else.
   *
   * The founding organization's legacy rows predate org_id, so a null org is
   * theirs and nobody else's.
   */
  const owned =
    doc != null &&
    (doc.org_id === orgId || (doc.org_id === null && orgId === LEGACY_ORG_ID));
  if (!owned || !doc?.opportunity_id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (doc.superseded_by) {
    return NextResponse.json(
      {
        error:
          "This copy has already been replaced. Correct the copy that replaced it instead, so the chain stays readable.",
      },
      { status: 409 }
    );
  }

  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "Expected multipart form data." }, { status: 400 });
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "file is required." }, { status: 400 });
  }
  if (file.size <= 0 || file.size > MAX_BYTES) {
    return NextResponse.json({ error: "File must be between 1 byte and 12 MB." }, { status: 400 });
  }

  const mime = file.type || "application/octet-stream";
  if (!file.name.toLowerCase().match(/\.(pdf|png|jpe?g|docx?|txt)$/)) {
    return NextResponse.json(
      { error: "Upload a PDF, Word doc, PNG, JPEG or text file." },
      { status: 400 }
    );
  }

  const note =
    typeof form.get("note") === "string" ? String(form.get("note")).trim().slice(0, 500) : "";
  if (!note) {
    return NextResponse.json(
      {
        error:
          "Say where this copy came from. A replacement with no provenance is a file nobody can vouch for later.",
      },
      { status: 400 }
    );
  }

  const buf = Buffer.from(await file.arrayBuffer());
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 80) || "upload.bin";
  const key = `opportunities/${doc.opportunity_id}/corrected/${Date.now()}-${safeName}`;
  const up = await storage.upload(key, buf, mime);

  /*
   * The replacement inherits the classification of what it replaces. It is the
   * same document: same amendment number, same requirement, same class. Losing
   * that would take an Amendment 3 and file the corrected copy as an
   * unclassified attachment, which is how a bid ends up priced against
   * Amendment 2.
   */
  const fresh = await queryOne<{ id: string }>(
    `insert into documents
       (org_id, opportunity_id, kind, name, storage_path, storage_backend, mime,
        version, document_class, amendment_number, requirement_id,
        source_system, review_note, extraction_state, disposition, access_state)
     /*
      * access_state 'available': the bytes are in hand. The other values in
      * that vocabulary describe a source that could not be fetched, and an
      * operator-supplied file that reads as "source could not be reached"
      * would put a blocker on the inventory for a document that is fine.
      */
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'operator_replacement',$12,'pending','blocked','available')
     returning id`,
    [
      doc.org_id ?? orgId,
      doc.opportunity_id,
      doc.kind,
      doc.name,
      up.path,
      up.backend,
      mime,
      doc.version + 1,
      doc.document_class,
      doc.amendment_number,
      doc.requirement_id,
      note,
    ]
  );
  if (!fresh) {
    return NextResponse.json({ error: "Could not store the replacement." }, { status: 500 });
  }

  /*
   * The old row is marked, not deleted, and its excluded_reason says what
   * happened in words rather than leaving a superseded pointer for somebody to
   * follow. The check constraint requires that reason, which is the schema
   * making the same point.
   */
  await query(
    `update documents
        set superseded_by = $2,
            disposition = 'excluded',
            excluded_reason = $3,
            excluded_by = $4,
            excluded_at = now()
      where id = $1`,
    [
      doc.id,
      fresh.id,
      `Replaced by a corrected copy: ${note}`,
      ctx.user.email,
    ]
  );

  await enqueue("solicitation-analyst", { opportunityId: doc.opportunity_id });
  await logAgent({
    agent: "operator",
    action: "document-replaced",
    opportunityId: doc.opportunity_id,
    level: "info",
    message: `${doc.name} replaced with a corrected copy (version ${doc.version + 1}): ${note}`,
  });

  return NextResponse.json({
    ok: true,
    documentId: fresh.id,
    // Queued, not read. The requirements in this file are not in the brief
    // until the analyst has run, and saying otherwise would have an operator
    // trusting a checklist that has not seen the document.
    message:
      "Stored as the current copy, and the solicitation is queued for re-analysis. Anything inside it reaches the checklist once that finishes.",
  });
}
