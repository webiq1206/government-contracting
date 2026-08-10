/**
 * Gather an opportunity's solicitation/SOW documents for outreach emails.
 * Files come from the documents table (bytes via storage: Supabase, Postgres
 * file_blobs, or local disk), with opportunities.attachments_json as a
 * fallback source of links. Oversized files are returned as links instead of
 * attachments so the email always goes through.
 */
import { query } from "./db";
import { storage } from "./integrations/storage";
import type { OutreachAttachment } from "./integrations/email-transport";

/** Keep total attachment payload comfortably under Gmail's 25MB raw limit. */
const MAX_TOTAL_BYTES = 15 * 1024 * 1024;

export interface GatheredAttachments {
  files: OutreachAttachment[];
  /** Documents we couldn't (or shouldn't) attach; include as links. */
  links: { name: string; url: string }[];
}

type AttachmentJsonEntry = { name?: string; url?: string; storage_path?: string; mime?: string };

export async function gatherOpportunityAttachments(opp: {
  id: string;
  attachments_json?: unknown;
}): Promise<GatheredAttachments> {
  const files: OutreachAttachment[] = [];
  const links: { name: string; url: string }[] = [];
  const seen = new Set<string>();
  let total = 0;

  const docs = await query<{
    name: string;
    storage_path: string | null;
    storage_backend: string;
    mime: string | null;
  }>(
    `select name, storage_path, storage_backend, mime from documents
      where opportunity_id = $1 and kind in ('solicitation','sow')
      order by created_at asc limit 10`,
    [opp.id]
  );

  for (const d of docs) {
    if (!d.storage_path || seen.has(d.storage_path)) continue;
    seen.add(d.storage_path);
    try {
      const bytes = await storage.download(
        d.storage_path,
        d.storage_backend === "supabase" ? "supabase" : undefined
      );
      if (total + bytes.length > MAX_TOTAL_BYTES) {
        const url = await storage.signedUrl(d.storage_path, 7 * 24 * 3600);
        if (url) links.push({ name: d.name, url });
        continue;
      }
      total += bytes.length;
      files.push({
        filename: d.name,
        content: bytes,
        mime: d.mime ?? "application/octet-stream",
      });
    } catch {
      const url = await storage.signedUrl(d.storage_path, 7 * 24 * 3600).catch(() => null);
      if (url) links.push({ name: d.name, url });
    }
  }

  // Fallback: attachments captured on the opportunity record itself.
  const raw = Array.isArray(opp.attachments_json)
    ? (opp.attachments_json as AttachmentJsonEntry[])
    : [];
  for (const a of raw) {
    const name = a.name ?? "Attachment";
    if (a.storage_path && !seen.has(a.storage_path)) {
      seen.add(a.storage_path);
      try {
        const bytes = await storage.download(a.storage_path);
        if (total + bytes.length <= MAX_TOTAL_BYTES) {
          total += bytes.length;
          files.push({ filename: name, content: bytes, mime: a.mime });
          continue;
        }
        // Oversized: deliver as a signed link instead of dropping it.
        const url = await storage.signedUrl(a.storage_path, 7 * 24 * 3600).catch(() => null);
        if (url) {
          links.push({ name, url });
          continue;
        }
      } catch {
        const url = await storage.signedUrl(a.storage_path, 7 * 24 * 3600).catch(() => null);
        if (url) {
          links.push({ name, url });
          continue;
        }
      }
    }
    if (a.url && !seen.has(a.url)) {
      seen.add(a.url);
      links.push({ name, url: a.url });
    }
  }

  return { files, links };
}
