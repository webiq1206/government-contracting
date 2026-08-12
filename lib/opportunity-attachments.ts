/**
 * Gather an opportunity's solicitation/SOW documents for outreach emails.
 * Attach the full stored set. Trade scoring only ranks which files consume
 * the MIME size budget first; oversized remainder become signed links.
 */
import { query } from "./db";
import { storage } from "./integrations/storage";
import type { OutreachAttachment } from "./integrations/email-transport";
import { normalizeAttachmentMeta } from "./domain/attachment-meta";

/** Keep total attachment payload comfortably under Gmail's 25MB raw limit. */
const MAX_TOTAL_BYTES = 15 * 1024 * 1024;

export interface GatheredAttachments {
  files: OutreachAttachment[];
  /** Documents we couldn't (or shouldn't) attach; include as links. */
  links: { name: string; url: string }[];
  /** True when stored docs or attachment URLs existed to try. */
  expected: boolean;
}

type AttachmentJsonEntry = { name?: string; url?: string; storage_path?: string; mime?: string };

type DocRow = {
  name: string;
  storage_path: string | null;
  storage_backend: string;
  mime: string | null;
};

/** Keyword hints that a document is useful for a given trade. */
export function tradeAttachmentKeywords(trade: string | null | undefined): string[] {
  const t = (trade ?? "").toLowerCase();
  const base = [
    "sow",
    "pws",
    "statement of work",
    "scope",
    "spec",
    "exhibit",
    "wage",
    "davis",
    "bid schedule",
    "pricing",
    "amendment",
    "addendum",
  ];
  if (!t) return base;
  const tradeHints: string[] = [t];
  if (/electr/.test(t)) tradeHints.push("electrical", "power", "panel", "lighting");
  if (/plumb/.test(t)) tradeHints.push("plumbing", "pipe", "fixture");
  if (/hvac|mechanical/.test(t)) tradeHints.push("hvac", "mechanical", "duct", "air");
  if (/roof/.test(t)) tradeHints.push("roof", "membrane");
  if (/floor|carpet|tile/.test(t)) tradeHints.push("floor", "flooring", "tile");
  if (/paint/.test(t)) tradeHints.push("paint", "coating");
  if (/concrete|mason/.test(t)) tradeHints.push("concrete", "masonry", "slab");
  if (/landscap|ground/.test(t)) tradeHints.push("landscape", "grounds", "mow");
  if (/janitor|custod|clean/.test(t)) tradeHints.push("janitorial", "custodial", "clean");
  if (/water|treatment/.test(t)) tradeHints.push("water", "treatment", "chemical");
  return [...base, ...tradeHints];
}

export function scoreDocForTrade(name: string, trade: string | null | undefined): number {
  const n = name.toLowerCase();
  let score = 0;
  for (const kw of tradeAttachmentKeywords(trade)) {
    if (n.includes(kw.toLowerCase())) score += kw === (trade ?? "").toLowerCase() ? 5 : 2;
  }
  // Generic notice PDFs still useful as a light fallback.
  if (/solicitation|rfq|rfp|notice/.test(n)) score += 1;
  return score;
}

/** Trade-relevant files first so they consume the MIME size budget. */
export function prioritizeDocsForAttach<T extends { name: string }>(
  docs: T[],
  trade: string | null | undefined
): T[] {
  return [...docs].sort(
    (a, b) => scoreDocForTrade(b.name, trade) - scoreDocForTrade(a.name, trade)
  );
}

async function loadDocs(oppId: string): Promise<DocRow[]> {
  return query<DocRow>(
    `select name, storage_path, storage_backend, mime from documents
      where opportunity_id = $1 and kind in ('solicitation','sow')
      order by created_at asc limit 40`,
    [oppId]
  );
}

async function materializeDocs(
  docs: DocRow[],
  opp: { id: string; attachments_json?: unknown }
): Promise<GatheredAttachments> {
  const files: OutreachAttachment[] = [];
  const links: { name: string; url: string }[] = [];
  const seen = new Set<string>();
  let total = 0;

  for (const d of docs) {
    if (!d.storage_path || seen.has(d.storage_path)) continue;
    seen.add(d.storage_path);
    try {
      const bytes = await storage.download(
        d.storage_path,
        d.storage_backend === "supabase" ? "supabase" : undefined
      );
      if (!bytes.length) continue;
      const meta = normalizeAttachmentMeta({
        filename: d.name,
        mime: d.mime,
        content: bytes,
      });
      if (total + bytes.length > MAX_TOTAL_BYTES) {
        const url = await storage.signedUrl(d.storage_path, 7 * 24 * 3600);
        if (url) links.push({ name: meta.filename, url });
        continue;
      }
      total += bytes.length;
      files.push({
        filename: meta.filename,
        content: bytes,
        mime: meta.mime,
      });
    } catch {
      const url = await storage.signedUrl(d.storage_path, 7 * 24 * 3600).catch(() => null);
      if (url) {
        const meta = normalizeAttachmentMeta({ filename: d.name, mime: d.mime });
        links.push({ name: meta.filename, url });
      }
    }
  }

  const raw = Array.isArray(opp.attachments_json)
    ? (opp.attachments_json as AttachmentJsonEntry[])
    : [];
  for (const a of raw) {
    const name = a.name ?? "Attachment";
    if (a.storage_path && !seen.has(a.storage_path)) {
      seen.add(a.storage_path);
      try {
        const bytes = await storage.download(a.storage_path);
        if (!bytes.length) continue;
        const meta = normalizeAttachmentMeta({
          filename: name,
          mime: a.mime,
          content: bytes,
        });
        if (total + bytes.length <= MAX_TOTAL_BYTES) {
          total += bytes.length;
          files.push({ filename: meta.filename, content: bytes, mime: meta.mime });
          continue;
        }
        const url = await storage.signedUrl(a.storage_path, 7 * 24 * 3600).catch(() => null);
        if (url) {
          links.push({ name: meta.filename, url });
          continue;
        }
      } catch {
        const url = await storage.signedUrl(a.storage_path, 7 * 24 * 3600).catch(() => null);
        if (url) {
          const meta = normalizeAttachmentMeta({ filename: name, mime: a.mime });
          links.push({ name: meta.filename, url });
          continue;
        }
      }
    }
    if (a.url && !seen.has(a.url)) {
      seen.add(a.url);
      const meta = normalizeAttachmentMeta({ filename: name, mime: a.mime });
      links.push({ name: meta.filename, url: a.url });
    }
  }

  const json = Array.isArray(opp.attachments_json) ? opp.attachments_json : [];
  const expected =
    docs.length > 0 ||
    json.some((a) => {
      if (!a || typeof a !== "object") return false;
      const row = a as AttachmentJsonEntry;
      return Boolean(row.url || row.storage_path);
    });

  return { files, links, expected };
}

/** All solicitation/SOW docs (legacy helper). */
export async function gatherOpportunityAttachments(opp: {
  id: string;
  attachments_json?: unknown;
}): Promise<GatheredAttachments> {
  const docs = await loadDocs(opp.id);
  return materializeDocs(docs, opp);
}

/**
 * All solicitation/SOW docs for outreach. Trade scoring only ranks which
 * files consume the MIME size budget first; the rest become signed links.
 */
export async function gatherTradeAttachments(
  opp: { id: string; attachments_json?: unknown },
  trade: string | null | undefined
): Promise<GatheredAttachments> {
  const docs = await loadDocs(opp.id);
  return materializeDocs(prioritizeDocsForAttach(docs, trade), opp);
}
