/**
 * Gather an opportunity's solicitation/SOW documents for outreach emails.
 *
 * Three jobs, in order:
 *
 *   1. SELECT — only the documents this subcontractor's trade actually needs
 *      (lib/domain/attachment-selection). What was left out, and why, is
 *      reported in `omitted` so the operator can argue with it; nothing is
 *      dropped silently.
 *   2. RENAME — every filename is rewritten to a clear, professional one
 *      (lib/domain/attachment-naming) before it goes near an email, so a
 *      recipient never sees "Attachment_2._Wage_Determination.pdf".
 *   3. FIT — trade scoring ranks which files consume the MIME size budget
 *      first; the oversized remainder become one signed package link.
 */
import { query } from "./db";
import { storage } from "./integrations/storage";
import type { OutreachAttachment } from "./integrations/email-transport";
import { normalizeAttachmentMeta } from "./domain/attachment-meta";
import {
  selectDocumentsForTrade,
  type SelectableDocument,
} from "./domain/attachment-selection";
import { professionalStem, uniqueFilename } from "./domain/attachment-naming";
import { amendmentNumber, classifyDocumentName } from "./domain/document-inventory";
import { packageDocUrl, isAllowedUpstream } from "./domain/doc-link";

/** Keep total attachment payload comfortably under Gmail's 25MB raw limit. */
const MAX_TOTAL_BYTES = 15 * 1024 * 1024;

export interface GatheredAttachments {
  files: OutreachAttachment[];
  /**
   * Documents that could not ride along, offered as links.
   *
   * At most one entry: everything that did not fit is gathered into a single
   * package link rather than a URL per file, because a solicitation with a
   * full drawing set otherwise puts a wall of links in a quote request.
   *
   * `reachable` records whether the underlying files were read back
   * successfully before the send. False stops the email.
   */
  links: { name: string; url: string; reachable?: boolean }[];
  /** True when documents THIS SUBCONTRACTOR needs existed to try. */
  expected: boolean;
  /**
   * Documents we know about that reached the recipient in no form at all.
   *
   * A link still counts as delivery, so these are only the ones that failed to
   * download AND could not be linked. They matter because a subcontractor
   * cannot tell a document that was not sent from one that does not exist:
   * they price what they can see and dispute the rest later.
   */
  undelivered: { name: string; reason: string }[];
  /**
   * Documents deliberately left out of this packet, each with its reason.
   *
   * Distinct from undelivered: these are judgements, not failures. Another
   * trade's specifications, or the agency's offer-submission material for the
   * prime. They go to the agent log, never to the recipient.
   */
  omitted: { name: string; reason: string }[];
}

type AttachmentJsonEntry = { name?: string; url?: string; storage_path?: string; mime?: string };

type DocRow = {
  name: string;
  storage_path: string | null;
  storage_backend: string;
  mime: string | null;
  document_class: string | null;
  amendment_number: number | null;
  trade_relevance: unknown;
  relevant_to_all: boolean | null;
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
    `select name, storage_path, storage_backend, mime,
            document_class, amendment_number, trade_relevance, relevant_to_all
       from documents
      where opportunity_id = $1 and kind in ('solicitation','sow')
      order by created_at asc limit 40`,
    [oppId]
  );
}

function asSelectable(d: DocRow): SelectableDocument & DocRow {
  const tags = Array.isArray(d.trade_relevance)
    ? d.trade_relevance.filter((t): t is string => typeof t === "string")
    : null;
  return {
    ...d,
    documentClass: d.document_class,
    tradeRelevance: tags,
    relevantToAll: d.relevant_to_all,
  };
}

type GatherableOpp = {
  id: string;
  title?: string | null;
  solicitation_number?: string | null;
  attachments_json?: unknown;
};

async function materializeDocs(
  docs: DocRow[],
  opp: GatherableOpp,
  trade: string | null | undefined
): Promise<GatheredAttachments> {
  const files: OutreachAttachment[] = [];
  const links: { name: string; url: string; reachable?: boolean }[] = [];
  const undelivered: { name: string; reason: string }[] = [];
  const omitted: { name: string; reason: string }[] = [];
  /** Files that did not fit, gathered into one link rather than many. */
  const overflow: { k: "s" | "u"; v: string; n: string }[] = [];
  const seen = new Set<string>();
  /** Renamed filenames already used, so two sources never share a name. */
  const takenNames = new Set<string>();
  let total = 0;

  /*
   * Selection before anything is downloaded. What this subcontractor does not
   * need is not fetched, not attached, not linked — but it IS recorded, with
   * its reason, because an omission nobody can see is indistinguishable from
   * a file that got lost.
   */
  const selection = selectDocumentsForTrade(docs.map(asSelectable), trade);
  for (const o of selection.omitted) {
    omitted.push({ name: o.doc.name, reason: o.reason });
  }

  /** The name the recipient sees: cleaned, deduplicated, correctly extended. */
  const presentName = (
    raw: string,
    meta: { documentClass?: string | null; amendmentNumber?: number | null },
    content: Buffer | Uint8Array | null,
    mime: string | null | undefined,
    index: number
  ): { filename: string; mime: string } => {
    const stem = professionalStem(raw, {
      documentClass: meta.documentClass ?? classifyDocumentName(raw, mime),
      amendmentNumber: meta.amendmentNumber ?? amendmentNumber(raw),
      solicitationNumber: opp.solicitation_number ?? null,
      index,
    });
    const normalized = normalizeAttachmentMeta({ filename: stem, mime, content });
    return {
      filename: uniqueFilename(normalized.filename, takenNames),
      mime: normalized.mime,
    };
  };

  let position = 0;
  for (const d of selection.included) {
    if (!d.storage_path || seen.has(d.storage_path)) continue;
    seen.add(d.storage_path);
    position += 1;
    try {
      const bytes = await storage.download(
        d.storage_path,
        d.storage_backend === "supabase" ? "supabase" : undefined
      );
      if (!bytes.length) {
        undelivered.push({ name: d.name, reason: "the stored file is empty" });
        continue;
      }
      const meta = presentName(
        d.name,
        { documentClass: d.document_class, amendmentNumber: d.amendment_number },
        bytes,
        d.mime,
        position
      );
      if (total + bytes.length > MAX_TOTAL_BYTES) {
        /*
         * Too big to attach. Held for the package link rather than linked on
         * its own: a solicitation with a full drawing set produced a wall of
         * URLs, one per file, in the middle of a quote request.
         */
        overflow.push({ k: "s", v: d.storage_path, n: meta.filename });
        continue;
      }
      total += bytes.length;
      files.push({
        filename: meta.filename,
        content: bytes,
        mime: meta.mime,
      });
    } catch (err) {
      // Degraded, not dropped: the sub still gets a link. But a storage
      // outage silently converting every packet to links is worth a trace.
      console.error(
        `[attachments] could not download "${d.name}" (${d.storage_path}): ${(err as Error).message}; sending as a link instead`
      );
      const meta = presentName(
        d.name,
        { documentClass: d.document_class, amendmentNumber: d.amendment_number },
        null,
        d.mime,
        position
      );
      overflow.push({ k: "s", v: d.storage_path, n: meta.filename });
    }
  }

  const raw = Array.isArray(opp.attachments_json)
    ? (opp.attachments_json as AttachmentJsonEntry[])
    : [];
  /*
   * The notice's own attachment list rides through the same selection as the
   * stored documents: same trades, same prime-only material, same reasons.
   */
  const jsonSelection = selectDocumentsForTrade(
    raw.map((a) => ({ name: a.name ?? "Attachment", mime: a.mime, entry: a })),
    trade
  );
  for (const o of jsonSelection.omitted) {
    const already =
      (o.doc.entry.storage_path && seen.has(o.doc.entry.storage_path)) ||
      omitted.some((x) => x.name === o.doc.name);
    if (!already) omitted.push({ name: o.doc.name, reason: o.reason });
  }
  for (const sel of jsonSelection.included) {
    const a = sel.entry;
    const name = sel.name;
    if (a.storage_path && !seen.has(a.storage_path)) {
      seen.add(a.storage_path);
      position += 1;
      try {
        const bytes = await storage.download(a.storage_path);
        if (!bytes.length) {
          undelivered.push({ name, reason: "the stored file is empty" });
          continue;
        }
        const meta = presentName(name, {}, bytes, a.mime, position);
        if (total + bytes.length <= MAX_TOTAL_BYTES) {
          total += bytes.length;
          files.push({ filename: meta.filename, content: bytes, mime: meta.mime });
          continue;
        }
        overflow.push({ k: "s", v: a.storage_path, n: meta.filename });
        continue;
      } catch (err) {
        console.error(
          `[attachments] could not download "${name}" (${a.storage_path}): ${(err as Error).message}; sending as a link instead`
        );
        const meta = presentName(name, {}, null, a.mime, position);
        overflow.push({ k: "s", v: a.storage_path, n: meta.filename });
        continue;
      }
    }
    if (a.url && !seen.has(a.url)) {
      seen.add(a.url);
      position += 1;
      const meta = presentName(name, {}, null, a.mime, position);
      // Never hand a subcontractor a SAM.gov URL. We proxy the file through
      // our own domain so the email only ever shows a brostco.com link, and
      // the recipient is not invited to go bid the job themselves.
      if (isAllowedUpstream(a.url)) {
        overflow.push({ k: "u", v: a.url, n: meta.filename });
      }
    }
  }

  /*
   * "Expected" is measured after selection, against what this subcontractor
   * should receive. A solicitation whose every document was deliberately
   * omitted for this trade (all of it another trade's, or all of it the
   * prime's offer material) has nothing this packet is missing, and holding
   * the send over it would punish the filtering for working. The omissions
   * still reach the agent log through `omitted`.
   */
  const expected =
    selection.included.length > 0 ||
    jsonSelection.included.some((s) => Boolean(s.entry.url || s.entry.storage_path));

  /*
   * Everything that could not ride along becomes ONE link.
   *
   * A solicitation with a full drawing set used to put a separate URL in the
   * email for every file that did not fit, which is a wall of links in the
   * middle of a quote request. The recipient now gets a single address listing
   * them all, on our own domain, opening without an account.
   *
   * The most important documents are still attached directly: the gatherer
   * ranks trade-relevant files first, so they consume the byte budget before
   * anything overflows.
   */
  if (overflow.length) {
    /*
     * Prove the link works before promising it.
     *
     * This is the one thing in the email nobody checks before it is sent, and
     * it is the only route to the documents that did not fit. A dead link is
     * worse than no link: the recipient believes the drawings were provided
     * and blames themselves for not finding them.
     *
     * Checked by reading back the stored objects the package points at, which
     * is the part that actually fails: storage evicted the file, the path was
     * wrong, the bucket moved. Upstream entries are not fetched here, because
     * that would mean pulling megabytes from SAM on every send to learn what
     * the send itself will discover.
     */
    const stored = overflow.filter((o) => o.k === "s");
    let reachable = true;
    for (const entry of stored) {
      const ok = await storage
        .download(entry.v)
        .then((b) => b.length > 0)
        .catch(() => false);
      if (!ok) {
        reachable = false;
        console.error(
          `[attachments] package link would be dead: "${entry.n}" (${entry.v}) could not be read back`
        );
        break;
      }
    }

    links.push({
      reachable,
      name:
        overflow.length === 1
          ? overflow[0].n
          : `All ${overflow.length} bid documents`,
      url: packageDocUrl({
        opportunityId: opp.id,
        title: opp.title?.trim() || "Bid documents",
        documents: overflow,
      }),
    });
  }

  return { files, links, expected, undelivered, omitted };
}

/** All solicitation/SOW docs (legacy helper). */
export async function gatherOpportunityAttachments(
  opp: GatherableOpp
): Promise<GatheredAttachments> {
  const docs = await loadDocs(opp.id);
  return materializeDocs(docs, opp, null);
}

/**
 * The document packet for one subcontractor: only this trade's documents,
 * renamed for the recipient, ranked so the most relevant consume the MIME
 * size budget first; the rest become one signed package link.
 */
export async function gatherTradeAttachments(
  opp: GatherableOpp,
  trade: string | null | undefined
): Promise<GatheredAttachments> {
  const docs = await loadDocs(opp.id);
  return materializeDocs(prioritizeDocsForAttach(docs, trade), opp, trade);
}
