import { randomUUID } from "node:crypto";
import { query, queryOne, tenantTransaction } from "@/lib/db";
import {
  storage,
  type StorageBackend,
  type UploadResult,
} from "@/lib/integrations/storage";
import { runWithOrg } from "@/lib/tenant-context";
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
  storage_backend?: StorageBackend | null;
  /** Who filed it, or null when the account they used is gone. */
  uploaded_by_name?: string | null;
}

export type UploadOutcome =
  | { ok: true; id: string }
  | {
      ok: false;
      error: string;
      status: 400 | 404 | 409 | 503;
      retryable?: boolean;
      cleanupRequired?: boolean;
    };

export type RemoveOutcome =
  | { ok: true }
  | { ok: false; error: string; status: 404 | 503; retryable?: boolean };

class ComplianceDocumentMutationError extends Error {
  constructor(
    readonly userMessage: string,
    readonly status: 404 | 409
  ) {
    super(userMessage);
    this.name = "ComplianceDocumentMutationError";
  }
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Remove bytes from an upload whose database record could not be committed.
 *
 * The logical key contains a random UUID, so it cannot be shared with another
 * upload. The reference predicates remain anyway: old data can be surprising,
 * and cleanup must never turn a failed write into somebody else's missing
 * document.
 */
async function discardUnattachedUpload(
  orgId: string,
  uploaded: UploadResult
): Promise<void> {
  await runWithOrg(orgId, () => storage.removeExternal(uploaded.path, uploaded.backend));
  await tenantTransaction(orgId, async (client) => {
    await client.query(
      `delete from file_blobs b
        where b.path = $1
          and (b.org_id = $2 or b.org_id is null)
          and not exists (select 1 from documents d where d.storage_path = b.path)
          and not exists (
            select 1 from subcontractor_documents d where d.storage_path = b.path
          )
          and not exists (
            select 1 from compliance_item_documents d where d.storage_path = b.path
          )
          and not exists (select 1 from feedback_reports d where d.storage_path = b.path)`,
      [uploaded.path, orgId]
    );
  });
}

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
  actorLabel?: string | null;
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
  if (bad) return { ok: false, error: bad, status: 400 };

  /*
   * The item is resolved before anything is stored, so a wrong id does not
   * leave an orphaned file in the bucket. It is checked again inside the
   * filing transaction, because between here and there is a window.
   */
  try {
    const preflight = await tenantTransaction(input.orgId, async (client) => {
      const item = await client.query<{ id: string }>(
        `select id from compliance_items where id = $1 and org_id = $2`,
        [input.itemId, input.orgId]
      );
      if (item.rows.length === 0) {
        return {
          error: "No such compliance item. Nothing was filed.",
          status: 404 as const,
        };
      }
      if (!input.replaces) return null;
      const prior = await client.query<{ id: string }>(
        `select id
           from compliance_item_documents
          where id = $1 and item_id = $2 and org_id = $3`,
        [input.replaces, input.itemId, input.orgId]
      );
      return prior.rows.length === 0
        ? {
            error:
              "The file selected for replacement is no longer on this item. Refresh and try again.",
            status: 409 as const,
          }
        : null;
    });
    if (preflight) {
      return {
        ok: false,
        error: preflight.error,
        status: preflight.status,
        retryable: preflight.status === 409,
      };
    }
  } catch (error) {
    console.error(`[compliance] document preflight failed: ${errorText(error)}`);
    return {
      ok: false,
      error:
        "The compliance item could not be checked before storage. Nothing was changed. Try again.",
      status: 503,
      retryable: true,
    };
  }

  const safeName =
    input.file.name.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 80) || "upload.bin";
  const key = `compliance/${input.itemId}/${randomUUID()}-${safeName}`;
  const mime = input.file.type || "application/octet-stream";
  let bytes: Buffer;
  try {
    bytes = Buffer.from(await input.file.arrayBuffer());
  } catch (error) {
    console.warn(`[compliance] selected file could not be read: ${errorText(error)}`);
    return {
      ok: false,
      error: `"${input.file.name}" could not be read. Select the file again and retry.`,
      status: 400,
      retryable: true,
    };
  }

  let uploaded: UploadResult;
  try {
    // Storage derives its namespace from tenant context. Supplying that
    // context here makes this library safe outside an HTTP request too.
    uploaded = await runWithOrg(input.orgId, () => storage.upload(key, bytes, mime));
  } catch (error) {
    console.warn("[compliance] upload failed:", error);
    return {
      ok: false,
      error: "The file could not be stored. Nothing was changed. Check storage and try again.",
      status: 503,
      retryable: true,
    };
  }

  try {
    const id = await tenantTransaction(input.orgId, async (client) => {
      const item = await client.query<{ id: string }>(
        `select id
           from compliance_items
          where id = $1 and org_id = $2
          for update`,
        [input.itemId, input.orgId]
      );
      if (item.rows.length === 0) {
        throw new ComplianceDocumentMutationError(
          "No such compliance item. Nothing was filed.",
          404
        );
      }

      /*
       * Validate and lock the document being replaced before writing the new
       * row. A stale or cross-tenant id is a visible conflict, not a successful
       * upload whose history silently says nothing was replaced.
       */
      if (input.replaces) {
        const prior = await client.query<{ id: string }>(
          `select id
             from compliance_item_documents
            where id = $1 and item_id = $2 and org_id = $3
            for update`,
          [input.replaces, input.itemId, input.orgId]
        );
        if (prior.rows.length === 0) {
          throw new ComplianceDocumentMutationError(
            "The file selected for replacement is no longer on this item. Refresh and try again.",
            409
          );
        }
      }

      const inserted = await client.query<{ id: string }>(
        `insert into compliance_item_documents
           (org_id, item_id, storage_path, storage_backend, original_filename, mime_type,
            size_bytes, kind, note, uploaded_by)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::uuid)
         returning id`,
        [
          input.orgId,
          input.itemId,
          uploaded.path,
          uploaded.backend,
          input.file.name.slice(0, 200),
          mime,
          input.file.size,
          input.kind?.trim() || null,
          input.note?.trim() || null,
          input.actorId,
        ]
      );
      const documentId = inserted.rows[0]?.id;
      if (!documentId) {
        throw new Error("The document row was not returned after insertion.");
      }

      if (input.replaces) {
        const superseded = await client.query<{ id: string }>(
          `update compliance_item_documents
              set superseded_by = $1
            where id = $2 and item_id = $3 and org_id = $4 and id <> $1
            returning id`,
          [documentId, input.replaces, input.itemId, input.orgId]
        );
        if (superseded.rows.length !== 1) {
          throw new ComplianceDocumentMutationError(
            "The file selected for replacement changed while this upload was finishing. Refresh and try again.",
            409
          );
        }
      }

      /*
       * The document row, its effect on compliance state, and its immutable
       * history are one commit. A missing event must never look like a filed
       * certificate, and an event must never describe a rolled-back file.
       */
      const satisfied = await client.query<{ id: string }>(
        `update compliance_items
            set satisfied_at = coalesce(satisfied_at, now()), updated_at = now()
          where id = $1 and org_id = $2
          returning id`,
        [input.itemId, input.orgId]
      );
      if (satisfied.rows.length !== 1) {
        throw new Error("The compliance item disappeared while the document was being filed.");
      }

      await client.query(
        `insert into compliance_item_events
           (org_id, item_id, kind, summary, changes, actor_id, actor_label)
         values ($1,$2,'document',$3,$4::jsonb,$5::uuid,$6)`,
        [
          input.orgId,
          input.itemId,
          `Filed ${input.file.name}`,
          JSON.stringify({ document_id: documentId }),
          input.actorId,
          input.actorLabel?.trim() || null,
        ]
      );

      return documentId;
    });

    return { ok: true, id };
  } catch (error) {
    let cleanupError: unknown = null;
    try {
      await discardUnattachedUpload(input.orgId, uploaded);
    } catch (cleanupFailure) {
      cleanupError = cleanupFailure;
      console.error(
        `[compliance] database write failed and temporary storage cleanup failed for ${uploaded.path}:`,
        cleanupFailure
      );
    }

    const cause =
      error instanceof ComplianceDocumentMutationError
        ? error.userMessage
        : "The document record and its history could not be saved.";
    if (cleanupError) {
      return {
        ok: false,
        error:
          `${cause} Its temporary stored copy also could not be removed. ` +
          "Do not assume the file is attached. Try again, and contact support if this message repeats.",
        status: error instanceof ComplianceDocumentMutationError ? error.status : 503,
        retryable: true,
        cleanupRequired: true,
      };
    }
    console.warn(`[compliance] filing rolled back: ${errorText(error)}`);
    return {
      ok: false,
      error: `${cause} The temporary copy was removed. Try again.`,
      status: error instanceof ComplianceDocumentMutationError ? error.status : 503,
      retryable: true,
    };
  }
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
  actorId: string | null,
  actorLabel?: string | null
): Promise<RemoveOutcome> {
  try {
    return await tenantTransaction(orgId, async (client): Promise<RemoveOutcome> => {
      /*
       * Lock in the same parent-then-document order used by filing and item
       * deletion. Otherwise a replacement can hold the item while waiting on
       * this document, while this removal holds the document and waits on the
       * item's foreign-key lock to write its event.
       */
      const owner = await client.query<{ item_id: string }>(
        `select item_id::text as item_id
           from compliance_item_documents
          where id = $1 and org_id = $2`,
        [documentId, orgId]
      );
      if (!owner.rows[0]) {
        return {
          ok: false,
          error: "That file is no longer on the record.",
          status: 404,
        };
      }
      const item = await client.query<{ id: string }>(
        `select id
           from compliance_items
          where id = $1 and org_id = $2
          for update`,
        [owner.rows[0].item_id, orgId]
      );
      if (!item.rows[0]) {
        throw new Error("The compliance item disappeared while its document was being removed.");
      }

      const selected = await client.query<{
        id: string;
        item_id: string;
        storage_path: string;
        storage_backend: string | null;
        original_filename: string;
      }>(
        `select id, item_id::text as item_id, storage_path, storage_backend, original_filename
           from compliance_item_documents
          where id = $1 and org_id = $2
          for update`,
        [documentId, orgId]
      );
      const doc = selected.rows[0];
      if (!doc) {
        return {
          ok: false,
          error: "That file is no longer on the record.",
          status: 404,
        };
      }

      const blob = await client.query<{ org_id: string | null }>(
        `select org_id::text as org_id from file_blobs where path = $1`,
        [doc.storage_path]
      );
      if (blob.rows[0]?.org_id && blob.rows[0].org_id !== orgId) {
        throw new Error("The stored file owner does not match the compliance item owner.");
      }

      /*
       * Most duplicate references are inside the same organization. Check
       * those first so an ordinary deletion never has to inspect another
       * tenant's rows. The document being removed is excluded explicitly.
       */
      const tenantShared = await client.query<{ shared: boolean }>(
        `select exists (
           select 1
             from documents d
            where d.storage_path = $1 and d.org_id = $3
           union all
           select 1
             from subcontractor_documents d
            where d.storage_path = $1 and d.org_id = $3
           union all
           select 1
             from feedback_reports d
            where d.storage_path = $1 and d.org_id = $3
           union all
           select 1
             from compliance_item_documents d
            where d.storage_path = $1 and d.id <> $2 and d.org_id = $3
         ) as shared`,
        [doc.storage_path, documentId, orgId]
      );

      let shared = tenantShared.rows[0]?.shared === true;
      if (!shared) {
        /*
         * Legacy data can point more than one organization at the same
         * physical object. An exact-path existence check is therefore still
         * required before deleting bytes. It returns only a boolean and uses
         * IS DISTINCT FROM so old unowned rows protect the object too.
         */
        const outsideTenantShared = await client.query<{ shared: boolean }>(
          `select exists (
             select 1
               from documents d
              where d.storage_path = $1 and d.org_id is distinct from $3
             union all
             select 1
               from subcontractor_documents d
              where d.storage_path = $1 and d.org_id is distinct from $3
             union all
             select 1
               from feedback_reports d
              where d.storage_path = $1 and d.org_id is distinct from $3
             union all
             select 1
               from compliance_item_documents d
              where d.storage_path = $1
                and d.id <> $2
                and d.org_id is distinct from $3
           ) as shared`,
          [doc.storage_path, documentId, orgId]
        );
        shared = outsideTenantShared.rows[0]?.shared === true;
      }

      const recordedBackend: StorageBackend | undefined =
        doc.storage_backend === "supabase" ||
        doc.storage_backend === "db" ||
        doc.storage_backend === "local"
          ? doc.storage_backend
          : blob.rows.length > 0
            ? "db"
            : undefined;

      /*
       * Keep the metadata row locked and present until physical deletion has
       * succeeded. A provider failure therefore rolls back and leaves a clear
       * retry target. If a later database statement fails, the next delete is
       * still safe because provider deletes are idempotent.
       */
      if (!shared) {
        await storage.removeExternal(doc.storage_path, recordedBackend);
      }

      await client.query(
        `update compliance_item_documents
            set superseded_by = null
          where superseded_by = $1 and org_id = $2`,
        [documentId, orgId]
      );
      const removed = await client.query<{ id: string }>(
        `delete from compliance_item_documents
          where id = $1 and org_id = $2
          returning id`,
        [documentId, orgId]
      );
      if (removed.rows.length !== 1) {
        throw new Error("The document changed while it was being removed.");
      }

      if (!shared) {
        await client.query(
          `delete from file_blobs
            where path = $1 and (org_id = $2 or org_id is null)`,
          [doc.storage_path, orgId]
        );
      }

      await client.query(
        `insert into compliance_item_events
           (org_id, item_id, kind, summary, changes, actor_id, actor_label)
         values ($1,$2,'document',$3,$4::jsonb,$5::uuid,$6)`,
        [
          orgId,
          doc.item_id,
          `Removed ${doc.original_filename}`,
          JSON.stringify({ document_id: documentId, removed: true }),
          actorId,
          actorLabel?.trim() || null,
        ]
      );

      return { ok: true };
    });
  } catch (error) {
    console.error(`[compliance] document removal did not finish: ${errorText(error)}`);
    return {
      ok: false,
      error:
        "The file could not be fully removed from storage and its audit history. " +
        "Nothing is confirmed removed. Check storage and try again.",
      status: 503,
      retryable: true,
    };
  }
}

export async function documentsFor(
  orgId: string,
  itemIds: string[]
): Promise<Map<string, ComplianceDocument[]>> {
  if (itemIds.length === 0) return new Map();
  const rows = await query<ComplianceDocument>(
    `select d.id, d.item_id::text as item_id, d.original_filename, d.mime_type, d.size_bytes,
            d.kind, d.note, d.uploaded_at::text as uploaded_at,
            d.superseded_by::text as superseded_by, d.storage_backend,
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
): Promise<{
  storage_path: string;
  storage_backend: StorageBackend | null;
  original_filename: string;
  mime_type: string;
} | null> {
  return queryOne(
    `select storage_path, storage_backend, original_filename, mime_type
       from compliance_item_documents where id = $1 and org_id = $2`,
    [documentId, orgId]
  );
}
