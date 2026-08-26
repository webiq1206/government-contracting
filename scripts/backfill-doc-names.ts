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
import { guardedFetch } from "../lib/integrations/guarded-fetch";
import { closePool } from "../lib/db";
import {
  filenameFromPdfHeading,
  filenameFromPdfTitle,
  filenameFromResponse,
  filenameFromSolicitation,
  normalizeAttachmentMeta,
} from "../lib/domain/attachment-meta";
import { extractPdfText, extractPdfTitle } from "../lib/integrations/pdf";
import { storage } from "../lib/integrations/storage";

/** "attachment", "attachment.pdf", "attachment-3.pdf", "attachment_2" ... */
const GENERIC_NAME = /^attachment([-_ ]?\d+)?(\.[a-z0-9]{2,5})?$/i;

async function main() {
  const rows = await query<{
    id: string;
    name: string;
    mime: string | null;
    source_url: string | null;
    storage_path: string | null;
    storage_backend: string | null;
    opportunity_id: string | null;
    solicitation_number: string | null;
    opportunity_title: string | null;
  }>(
    `select d.id, d.name, d.mime, d.meta->>'source_url' as source_url,
            d.storage_path, d.storage_backend, d.opportunity_id,
            o.solicitation_number, o.title as opportunity_title
       from documents d
       left join opportunities o on o.id = d.opportunity_id
      where d.kind = 'solicitation'
        and d.meta->>'source_url' is not null`
  );

  const generic = rows.filter((r) => GENERIC_NAME.test(r.name.trim()));
  console.log(
    `${rows.length} solicitation document(s) with a source URL; ${generic.length} generically named.`
  );

  // Position within its own opportunity, so two unnamed files on one bid do
  // not both become "...attachment 1".
  const perOpportunity = new Map<string, number>();
  let renamed = 0;
  let unchanged = 0;
  let failed = 0;

  for (const row of generic) {
    try {
      let recovered = row.name;
      let via = "";
      /*
       * source_url is a link copied out of a SAM.gov notice, so it goes
       * through the guard like every other outside URL, even here: this
       * script runs with the same credentials the server has.
       *
       * Only the headers are wanted. The cap stops the download a long way
       * short of the file rather than pulling a 25MB PDF to read its name.
       */
      let res: Awaited<ReturnType<typeof guardedFetch>> | null = null;
      // The guard throws rather than handing back a failed response, so the
      // reason is captured here: "HTTP 404" and "refused: the host resolves to
      // loopback" are different problems and the log should say which.
      let fetchProblem: string | null = null;
      try {
        res = await guardedFetch(row.source_url!, {
          maxBytes: 64 * 1024,
          timeoutMs: 20_000,
          onOversize: "truncate",
        });
      } catch (err) {
        fetchProblem = (err as Error).message;
      }
      if (res) {
        recovered = filenameFromResponse({
          contentDisposition: res.contentDisposition,
          url: row.source_url,
          fallback: row.name,
        });
        via = "header";
      }

      // The URL is dead or told us nothing: SAM download links expire. The
      // bytes are still ours, and a PDF usually knows its own title.
      if (
        (recovered === row.name || GENERIC_NAME.test(recovered)) &&
        row.storage_path &&
        (row.mime ?? "").includes("pdf")
      ) {
        try {
          const bytes = await storage.download(
            row.storage_path,
            (row.storage_backend as "supabase" | "db" | "local" | null) ?? undefined
          );
          const fromTitle = filenameFromPdfTitle(await extractPdfTitle(bytes));
          if (fromTitle) {
            recovered = fromTitle;
            via = "pdf title";
          } else {
            // No Title metadata, which is normal for a scanned or exported
            // attachment. The page itself usually announces what it is.
            const { text } = await extractPdfText(bytes, 4000);
            const fromHeading = filenameFromPdfHeading(text);
            if (fromHeading) {
              recovered = fromHeading;
              via = "page heading";
            }
          }
        } catch {
          /* storage read failed; fall through to the ordinary skip */
        }
      }

      // Nothing will say what this document is called. A name built from the
      // solicitation is not a recovered name, but it beats leaving every
      // unnamed file on a bid looking identical.
      if (recovered === row.name || GENERIC_NAME.test(recovered)) {
        const key = row.opportunity_id ?? "none";
        const next = (perOpportunity.get(key) ?? 0) + 1;
        perOpportunity.set(key, next);
        const fromSolicitation = filenameFromSolicitation({
          solicitationNumber: row.solicitation_number,
          opportunityTitle: row.opportunity_title,
          index: next,
          mime: row.mime,
        });
        if (fromSolicitation) {
          recovered = fromSolicitation;
          via = "solicitation";
        }
      }

      if (recovered === row.name || GENERIC_NAME.test(recovered)) {
        if (res) {
          unchanged++;
        } else {
          failed++;
          console.log(
            `  ! ${row.id}: ${fetchProblem ?? "unreachable"} and no usable PDF title, kept "${row.name}"`
          );
        }
        continue;
      }
      // Keep the extension consistent with the stored MIME (the bytes were
      // sniffed at ingest, so documents.mime is trustworthy).
      const meta = normalizeAttachmentMeta({ filename: recovered, mime: row.mime });
      await query(`update documents set name = $2 where id = $1`, [row.id, meta.filename]);
      renamed++;
      console.log(`  + ${row.id}: "${row.name}" -> "${meta.filename}"${via ? ` (via ${via})` : ""}`);
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
