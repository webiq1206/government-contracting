import { NextResponse } from "next/server";
import { requireOrgContext } from "@/lib/org-guard";
import { queryOne, transaction } from "@/lib/db";
import { storage } from "@/lib/integrations/storage";
import { logAgent } from "@/lib/logger";
import { enqueue } from "@/lib/queue";
import { attachmentIdentity, canonicalAttachmentUrl } from "@/lib/domain/attachment-identity";
import { createHash } from "node:crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 12 * 1024 * 1024;

class ReplacementConflictError extends Error {}

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
    source_url: string | null;
    original_filename: string | null;
    meta: Record<string, unknown> | null;
  }>(
    `select id, org_id, opportunity_id, kind, name, version, document_class,
            amendment_number, requirement_id, superseded_by, source_url,
            original_filename, meta
       from documents where id = $1 and org_id = $2`,
    [params.id, orgId]
  );

  /*
   * One 404 for every failure, the same as the open route: no such document,
   * another tenant's, or one with no opportunity behind it. Distinguishing
   * them would confirm that a document id exists and belongs to somebody else.
   *
   * Rows with missing ownership stay unavailable until explicitly repaired.
   * A null owner is never treated as belonging to a default tenant.
   */
  if (!doc?.opportunity_id) {
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
  const sourceKey =
    (typeof doc.meta?.source_key === "string" && doc.meta.source_key) ||
    attachmentIdentity({ name: doc.original_filename ?? doc.name, url: doc.source_url ?? undefined });
  const replacementMeta = {
    ...(doc.meta ?? {}),
    source_key: sourceKey,
    canonical_source_url: canonicalAttachmentUrl(doc.source_url),
    replaces_document_id: doc.id,
  };

  /*
   * The replacement inherits the classification of what it replaces. It is the
   * same document: same amendment number, same requirement, same class. Losing
   * that would take an Amendment 3 and file the corrected copy as an
   * unclassified attachment, which is how a bid ends up priced against
   * Amendment 2.
   */
  let fresh: { id: string } | null;
  try {
    fresh = await transaction(async (client) => {
      const locked = await client.query<{ superseded_by: string | null }>(
        `select superseded_by from documents where id=$1 and org_id=$2 for update`,
        [doc.id, orgId]
      );
      if (!locked.rows[0] || locked.rows[0].superseded_by) {
        throw new ReplacementConflictError("The source document was replaced concurrently.");
      }
      const inserted = await client.query<{ id: string }>(
        `insert into documents
           (org_id, opportunity_id, kind, name, storage_path, storage_backend, mime,
            version, document_class, amendment_number, requirement_id,
            source_system, source_url, original_filename, meta,
            content_hash, byte_size, review_note, extraction_state, disposition, access_state)
         /*
          * access_state 'available': the bytes are in hand. The other values in
          * that vocabulary describe a source that could not be fetched, and an
          * operator-supplied file that reads as "source could not be reached"
          * would put a blocker on the inventory for a document that is fine.
          */
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'operator_replacement',$12,$13,$14,$15,$16,$17,'pending','blocked','available')
         returning id::text as id`,
        [
          orgId,
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
          doc.source_url,
          doc.original_filename ?? doc.name,
          JSON.stringify(replacementMeta),
          createHash("sha256").update(buf).digest("hex"),
          buf.byteLength,
          note,
        ]
      );
      const insertedRow = inserted.rows[0];
      if (!insertedRow) throw new Error("Could not store the replacement inventory row.");

      const superseded = await client.query(
        `update documents
            set superseded_by = $3,
                disposition = 'excluded',
                excluded_reason = $4,
                excluded_by = $5,
                excluded_at = now()
          where id = $1 and org_id = $2 and superseded_by is null`,
        [
          doc.id,
          orgId,
          insertedRow.id,
          `Replaced by a corrected copy: ${note}`,
          ctx.user.email,
        ]
      );
      if (superseded.rowCount !== 1) {
        throw new ReplacementConflictError("The source document was replaced concurrently.");
      }
      await client.query(
        `update opportunities
            set analysis_input_hash=null,
                risk_flags=(select array(select distinct unnest(coalesce(risk_flags,'{}') || array['awaiting_document_analysis']))),
                updated_at=now()
          where id=$1 and org_id=$2`,
        [doc.opportunity_id, orgId]
      );
      return insertedRow;
    });
  } catch (err) {
    if (err instanceof ReplacementConflictError) {
      return NextResponse.json(
        {
          error:
            "This copy was replaced while your upload was in progress. Refresh the document list and correct the current copy instead.",
        },
        { status: 409 }
      );
    }
    throw err;
  }
  if (!fresh) {
    return NextResponse.json({ error: "Could not store the replacement." }, { status: 500 });
  }

  const jobId = await enqueue(
    "solicitation-analyst",
    {
      opportunityId: doc.opportunity_id,
      force: "always",
      rescoreAfterAnalysis: true,
      replacementDocumentId: fresh.id,
    },
    {
      singletonKey: `analyze-replacement:${doc.opportunity_id}:${fresh.id}`,
      singletonSeconds: 3600,
    }
  );
  await logAgent({
    agent: "operator",
    action: "document-replaced",
    opportunityId: doc.opportunity_id,
    level: "info",
    message: `${doc.name} replaced with a corrected copy (version ${doc.version + 1}): ${note}`,
  });

  if (!jobId) {
    return NextResponse.json(
      {
        error:
          "The corrected copy was stored, but analysis was not queued because automation is paused or this pursuit is stopped. Restart it, then retry this document before relying on the brief.",
        stored: true,
        documentId: fresh.id,
      },
      { status: 409 }
    );
  }

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
