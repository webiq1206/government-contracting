/**
 * One-time backfill: recover real filenames for documents stored before
 * filenameFromResponse existed.
 *
 * Every SAM attachment ingested before that fix is named "attachment" (with
 * whatever extension byte-sniffing added), because SAM's notice JSON carries
 * no filename and nothing read the download response's Content-Disposition.
 * Document names drive trade prioritisation, official-form linking, and what
 * a subcontractor sees, so the old rows are worth repairing rather than
 * waiting for each opportunity to be force re-analysed.
 *
 * For each generically-named solicitation document that still knows its
 * source URL, this re-requests the URL, reads only the headers, and renames
 * the row when the server states a better name. Bytes are not re-downloaded
 * and storage is untouched: the file content was always right, only the label
 * was lost.
 *
 * Safe to re-run: rows it has fixed no longer match the generic-name filter,
 * and failures leave the row exactly as it was.
 *
 *   npm run backfill:doc-names
 */
import { query } from "../lib/db";
import { closePool } from "../lib/db";
import {
  filenameFromResponse,
  normalizeAttachmentMeta,
} from "../lib/domain/attachment-meta";

/** "attachment", "attachment.pdf", "attachment-3.pdf", "attachment_2" ... */
const GENERIC_NAME = /^attachment([-_ ]?\d+)?(\.[a-z0-9]{2,5})?$/i;

async function main() {
  const rows = await query<{
    id: string;
    name: string;
    mime: string | null;
    source_url: string | null;
  }>(
    `select id, name, mime, meta->>'source_url' as source_url
       from documents
      where kind = 'solicitation'
        and meta->>'source_url' is not null`
  );

  const generic = rows.filter((r) => GENERIC_NAME.test(r.name.trim()));
  console.log(
    `${rows.length} solicitation document(s) with a source URL; ${generic.length} generically named.`
  );

  let renamed = 0;
  let unchanged = 0;
  let failed = 0;

  for (const row of generic) {
    try {
      const res = await fetch(row.source_url!, { method: "GET" });
      // Headers are all we need; drop the body without reading it.
      await res.body?.cancel().catch(() => undefined);
      if (!res.ok) {
        failed++;
        console.log(`  ! ${row.id}: HTTP ${res.status}, kept "${row.name}"`);
        continue;
      }
      const recovered = filenameFromResponse({
        contentDisposition: res.headers.get("content-disposition"),
        url: row.source_url,
        fallback: row.name,
      });
      if (recovered === row.name || GENERIC_NAME.test(recovered)) {
        unchanged++;
        continue;
      }
      // Keep the extension consistent with the stored MIME (the bytes were
      // sniffed at ingest, so documents.mime is trustworthy).
      const meta = normalizeAttachmentMeta({ filename: recovered, mime: row.mime });
      await query(`update documents set name = $2 where id = $1`, [row.id, meta.filename]);
      renamed++;
      console.log(`  + ${row.id}: "${row.name}" -> "${meta.filename}"`);
    } catch (err) {
      failed++;
      console.log(`  ! ${row.id}: ${(err as Error).message}, kept "${row.name}"`);
    }
  }

  console.log(
    `Done. Renamed ${renamed}, unchanged ${unchanged}, failed ${failed} (failures keep their old name and can be retried).`
  );
}

main()
  .then(() => closePool())
  .catch(async (err) => {
    console.error(err);
    await closePool().catch(() => undefined);
    process.exit(1);
  });
