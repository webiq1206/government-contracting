import { query, queryOne } from "@/lib/db";
import { storage } from "@/lib/integrations/storage";
import { ALLOWED_UPLOAD_MIME, MAX_UPLOAD_BYTES } from "@/lib/sub-compliance-store";

/**
 * Files on a compliance item.
 *
 * The item had a `doc_url` whose placeholder said "e.g. a Drive link". A
 * pointer to a file somewhere else stops working when somebody leaves, moves a
 * folder, or tightens a share setting, and it cannot be produced in an audit.
 * The subcontractor side has stored files with a verification trail; the
 * company's own registrations, certifications and insurance did not.
 *
 * Several files per item, because one obligation routinely has more than one:
 * a policy and its endorsement, a certificate and the letter correcting it.
 */

export interface ComplianceDocument {
  id: string;
  item_id: string;
  original_filename: string;
  mime_type: string;
  size_bytes: string | number | null;
  kind: string | null;
  note: string | null;
  uploaded_at: string;
  superseded_by: string | null;
  /** Who filed it, or null when the account they used is gone. */
  uploaded_by_name?: string | null;
}

export type UploadOutcome =
  | { ok: true; id: string }
  | { ok: false; error: string };

/**
 * What this accepts, and why.
 *
 * The same limits the subcontractor uploader uses, imported rather than
 * repeated: two lists that start identical drift, and the day they do,
 * a file the portal accepted is refused here with no explanation anybody
 * can act on.
 */
export function checkFile(file: File): string | null {
  if (file.size <= 0) return `"${file.name}" is empty.`;
  if (file.size > MAX_UPLOAD_BYTES) {
    return `"${file.name}" is over 12 MB. Send a smaller scan or a PDF.`;
  }
  const mime = file.type || "application/octet-stream";
  if (!ALLOWED_UPLOAD_MIME.has(mime) && !/\.(pdf|png|jpe?g|heic|docx?)$/i.test(file.name)) {
    return `"${file.name}" is not a PDF, a photo, or a Word document.`;
  }
  return null;
}

export async function attachDocument(input: {
  orgId: string;
  itemId: string;
  file: File;
  kind?: string | null;
  note?: string | null;
  actorId: string | null;
  /**
   * An earlier document this one replaces.
   *
   * The old row is marked superseded rather than deleted, because "what was on
   * file on the day we certified" is the question an audit asks, and a record
   * that only holds the current certificate cannot answer it.
   */
  replaces?: string | null;
}): Promise<UploadOutcome> {
  const bad = checkFile(input.file);
  if (bad) return { ok: false, error: bad };

  /*
   * The item is resolved before anything is stored, so a wrong id does not
   * leave an orphaned file in the bucket. It is checked again inside the
   * insert, because between here and there is a window.
   */
  const item = await queryOne<{ id: string; label: string }>(
    `select id, label from compliance_items where id = $1 and org_id = $2`,
    [input.itemId, input.orgId]
  );
  if (!item) return { ok: false, error: "No such compliance item." };

  const safeName =
    input.file.name.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 80) || "upload.bin";
  const key = `compliance/${input.orgId}/${input.itemId}/${Date.now()}-${safeName}`;
  const mime = input.file.type || "application/octet-stream";
  const bytes = Buffer.from(await input.file.arrayBuffer());

  const up = await storage.upload(key, bytes, mime).catch((e: unknown) => {
    console.warn("[compliance] upload failed:", e);
    return null;
  });
  if (!up) return { ok: false, error: "The file could not be stored. Nothing was changed." };

  const rows = await query<{ id: string }>(
    `insert into compliance_item_documents
       (org_id, item_id, storage_path, original_filename, mime_type, size_bytes,
        kind, note, uploaded_by)
     select ci.org_id, ci.id, $3, $4, $5, $6, $7, $8, $9::uuid
       from compliance_items ci
      where ci.id = $1 and ci.org_id = $2
     returning id`,
    [
      input.itemId, input.orgId, up.path, input.file.name.slice(0, 200), mime,
      input.file.size, input.kind?.trim() || null, input.note?.trim() || null, input.actorId,
    ]
  );
  if (rows.length === 0) return { ok: false, error: "No such compliance item." };

  /*
   * The document this one replaces, if the operator said. Scoped to the same
   * item and org so a superseding id cannot be pointed at another tenant's
   * file, and left alone when it names nothing.
   */
  if (input.replaces) {
    await query(
      `update compliance_item_documents
          set superseded_by = $1
        where id = $2 and item_id = $3 and org_id = $4 and id <> $1`,
      [rows[0].id, input.replaces, input.itemId, input.orgId]
    ).catch((e: unknown) => {
      /*
       * The upload itself succeeded, so this does not fail the request: the
       * certificate is on the record either way, and refusing it over a bad
       * supersede link would lose the file to save the footnote. Logged rather
       * than swallowed, because a malformed id here means the caller sent
       * something the list never rendered.
       */
      console.warn("[compliance] could not mark a document superseded:", e);
    });
  }

  /*
   * A document on file is evidence the obligation was met, so the item stops
   * reading as Incomplete. Not marked verified: storing a scan is not the same
   * as somebody having read it, and conflating the two is how a wrong
   * certificate sits on a record looking checked.
   */
  await query(
    `update compliance_items
        set satisfied_at = coalesce(satisfied_at, now()), updated_at = now()
      where id = $1 and org_id = $2`,
    [input.itemId, input.orgId]
  ).catch(() => {});

  await query(
    `insert into compliance_item_events (org_id, item_id, kind, summary, changes, actor_id)
     values ($1,$2,'document',$3,$4::jsonb,$5::uuid)`,
    [
      input.orgId, input.itemId,
      `Filed ${input.file.name}`,
      JSON.stringify({ document_id: rows[0].id }),
      input.actorId,
    ]
  ).catch(() => {});

  return { ok: true, id: rows[0].id };
}

/**
 * Take a file off an item.
 *
 * Deliberately separate from superseding. A replaced certificate is history
 * worth keeping; a file attached to the wrong item, or one carrying somebody
 * else's details, is not history, it is a mistake, and leaving it on the
 * record to satisfy a filing principle would be the wrong answer both for the
 * audit and for whoever is in the document.
 *
 * The bytes go too. A row removed while the blob stayed readable by anybody
 * holding the path would make deletion a display change.
 */
export async function removeDocument(
  orgId: string,
  documentId: string,
  actorId: string | null
): Promise<{ ok: boolean; error?: string }> {
  const doc = await queryOne<{ id: string; item_id: string; storage_path: string; original_filename: string }>(
    `select id, item_id::text as item_id, storage_path, original_filename
       from compliance_item_documents where id = $1 and org_id = $2`,
    [documentId, orgId]
  );
  if (!doc) return { ok: false, error: "That file is no longer on the record." };

  // Anything that pointed at it stops pointing at it, otherwise the row
  // vanishes and takes a later document's history with it.
  await query(
    `update compliance_item_documents set superseded_by = null
      where superseded_by = $1 and org_id = $2`,
    [documentId, orgId]
  ).catch(() => {});
  await query(`delete from compliance_item_documents where id = $1 and org_id = $2`, [
    documentId, orgId,
  ]);
  await query(`delete from file_blobs where path = $1`, [doc.storage_path]).catch(() => {});

  await query(
    `insert into compliance_item_events (org_id, item_id, kind, summary, changes, actor_id)
     values ($1,$2,'document',$3,$4::jsonb,$5::uuid)`,
    [
      orgId, doc.item_id,
      `Removed ${doc.original_filename}`,
      JSON.stringify({ document_id: documentId, removed: true }),
      actorId,
    ]
  ).catch(() => {});

  return { ok: true };
}

export async function documentsFor(
  orgId: string,
  itemIds: string[]
): Promise<Map<string, ComplianceDocument[]>> {
  if (itemIds.length === 0) return new Map();
  const rows = await query<ComplianceDocument>(
    `select d.id, d.item_id::text as item_id, d.original_filename, d.mime_type, d.size_bytes,
            d.kind, d.note, d.uploaded_at::text as uploaded_at,
            d.superseded_by::text as superseded_by,
            coalesce(u.name, u.email) as uploaded_by_name
       from compliance_item_documents d
       left join users u on u.id = d.uploaded_by
      where d.org_id = $1 and d.item_id = any($2::uuid[])
      -- Current files first, superseded ones after, each newest first: the
      -- question is nearly always "what is on file now".
      order by (d.superseded_by is not null), d.uploaded_at desc`,
    [orgId, itemIds]
  );
  const out = new Map<string, ComplianceDocument[]>();
  for (const r of rows) {
    const list = out.get(r.item_id) ?? [];
    list.push(r);
    out.set(r.item_id, list);
  }
  return out;
}

export async function documentPath(
  orgId: string,
  documentId: string
): Promise<{ storage_path: string; original_filename: string; mime_type: string } | null> {
  return queryOne(
    `select storage_path, original_filename, mime_type
       from compliance_item_documents where id = $1 and org_id = $2`,
    [documentId, orgId]
  );
}
