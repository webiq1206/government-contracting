/**
 * Pure helpers for adding a solicitation a person found themselves.
 *
 * Everything here is deterministic and network-free so the parsing, the
 * provenance rules and the duplicate scoring can be pinned by tests. The
 * server-side flow (fetching, AI extraction, database) lives in
 * lib/solicitation-import.ts and composes these.
 */

export type ImportMethod = "url" | "upload" | "manual";

/** Where a field's value came from. Shown beside every retrieved field. */
export type FieldProvenance = "retrieved" | "inferred" | "entered";

export const PROVENANCE_LABEL: Record<FieldProvenance, string> = {
  retrieved: "From the source",
  inferred: "Suggested by AI",
  entered: "Entered by you",
};

export interface ImportedFields {
  title: string | null;
  agency: string | null;
  solicitation_number: string | null;
  description: string | null;
  deadline: string | null;
  posted_at: string | null;
  naics_code: string | null;
  set_aside_type: string | null;
  location_text: string | null;
  attachments: { name: string; url: string }[];
}

export type ImportedFieldKey = Exclude<keyof ImportedFields, "attachments">;

export const IMPORTED_FIELD_KEYS: ImportedFieldKey[] = [
  "title",
  "agency",
  "solicitation_number",
  "description",
  "deadline",
  "posted_at",
  "naics_code",
  "set_aside_type",
  "location_text",
];

export type ParsedSolicitationUrl =
  | { kind: "sam_notice"; noticeId: string; url: string }
  | { kind: "web"; url: string }
  | { kind: "invalid"; reason: string };

/**
 * Recognise a SAM.gov notice link in the forms people actually paste:
 *   https://sam.gov/opp/<noticeId>/view
 *   https://sam.gov/workspace/contract/opp/<noticeId>/view
 *   https://api.sam.gov/prod/opportunities/v1/noticedesc?noticeid=<noticeId>
 * Anything else that parses as http(s) is a web page to read.
 */
export function parseSolicitationUrl(raw: string): ParsedSolicitationUrl {
  const text = (raw ?? "").trim();
  if (!text) return { kind: "invalid", reason: "Paste a link first." };
  let u: URL;
  try {
    u = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return { kind: "invalid", reason: "That does not look like a web address." };
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    return { kind: "invalid", reason: "Only http and https links can be read." };
  }
  // A phrase with spaces or no domain is not an address, whatever URL() makes of it.
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(u.hostname)) {
    return { kind: "invalid", reason: "That does not look like a web address." };
  }
  const host = u.hostname.toLowerCase();
  if (host === "sam.gov" || host === "www.sam.gov" || host === "beta.sam.gov") {
    const m = u.pathname.match(/\/opp\/([0-9a-f]{32}|[0-9a-f-]{36})\b/i);
    if (m) return { kind: "sam_notice", noticeId: m[1], url: u.toString() };
  }
  if (host === "api.sam.gov") {
    const id = u.searchParams.get("noticeid");
    if (id) return { kind: "sam_notice", noticeId: id, url: `https://sam.gov/opp/${id}/view` };
  }
  return { kind: "web", url: u.toString() };
}

/**
 * True when a SAM row's description is the API link to the description
 * rather than the description itself. SAM's search results carry the URL of
 * the notice text, not the text, and that URL was being stored, scored and
 * shown to people as "what this job is".
 */
export function isDescriptionPlaceholder(description: string | null | undefined): boolean {
  const d = (description ?? "").trim();
  if (!d) return false;
  return /^https?:\/\/api\.sam\.gov\/[^\s]*noticedesc/i.test(d) || /^https?:\/\/\S+$/.test(d) && d.length < 400;
}

/** A description that is really there, or null. */
export function usableDescription(description: string | null | undefined): string | null {
  const d = (description ?? "").trim();
  if (!d || isDescriptionPlaceholder(d)) return null;
  return d;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

function meta(html: string, name: string): string | null {
  const re = new RegExp(
    `<meta[^>]+(?:property|name)=["']${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["'][^>]*content=["']([^"']*)["']`,
    "i"
  );
  const m = html.match(re);
  if (m) return decodeEntities(m[1]).trim() || null;
  const re2 = new RegExp(
    `<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["']`,
    "i"
  );
  const m2 = html.match(re2);
  return m2 ? decodeEntities(m2[1]).trim() || null : null;
}

/** Visible text of a page, with scripts, styles and tags removed. */
export function htmlToText(html: string, maxChars = 20_000): string {
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<(br|\/p|\/div|\/li|\/tr|\/h[1-6])\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  return decodeEntities(text)
    .replace(/[ \t\r\f\v]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, maxChars);
}

const SOL_NUMBER_RE =
  /(?:solicitation|bid|rfp|rfq|ifb|rfi|project|contract)\s*(?:no\.?|number|#|id)\s*[:#]?\s*([A-Z0-9][A-Z0-9._\/-]{4,40})/i;
const DEADLINE_RE =
  /(?:due|deadline|closes?|closing|responses?\s+due|proposals?\s+due|bids?\s+due|submission\s+deadline|offers?\s+due)[^\n]{0,40}?(\d{1,2}\/\d{1,2}\/\d{2,4}|\d{4}-\d{2}-\d{2}|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{1,2},?\s+\d{4})/i;

function parseDate(s: string): string | null {
  const t = new Date(s);
  if (Number.isNaN(t.getTime())) return null;
  if (t.getFullYear() < 2000 || t.getFullYear() > 2100) return null;
  return t.toISOString();
}

/** Attachment-looking links: PDFs, Office files and archives. */
export function extractDocumentLinks(html: string, baseUrl: string): { name: string; url: string }[] {
  const out = new Map<string, { name: string; url: string }>();
  for (const m of html.matchAll(/<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const href = m[1];
    let abs: string;
    try {
      abs = new URL(href, baseUrl).toString();
    } catch {
      continue;
    }
    if (!/^https?:/i.test(abs)) continue;
    if (!/\.(pdf|docx?|xlsx?|zip)(\?|$)/i.test(abs)) continue;
    const label = htmlToText(m[2], 120) || abs.split("/").pop() || "attachment";
    if (!out.has(abs)) out.set(abs, { name: label, url: abs });
    if (out.size >= 25) break;
  }
  return [...out.values()];
}

/**
 * What can be read straight off a page without any AI: metadata, the title,
 * an obvious solicitation number, an obvious due date, and document links.
 * Everything returned here is provenance "retrieved".
 */
export function extractFromHtml(html: string, url: string): Partial<ImportedFields> {
  const text = htmlToText(html, 60_000);
  const titleTag = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title =
    meta(html, "og:title") ??
    (titleTag ? decodeEntities(titleTag[1]).replace(/\s+/g, " ").trim() : null);
  const description = meta(html, "og:description") ?? meta(html, "description");
  const sol = text.match(SOL_NUMBER_RE);
  const due = text.match(DEADLINE_RE);
  const site = meta(html, "og:site_name");
  return {
    title: title && title.length <= 300 ? title : null,
    description: description && description.length >= 40 ? description : null,
    solicitation_number: sol ? sol[1] : null,
    deadline: due ? parseDate(due[1]) : null,
    agency: site && !/^https?:/.test(site) ? site : null,
    attachments: extractDocumentLinks(html, url),
  };
}

/** Lowercased significant tokens of a title, for near-duplicate detection. */
export function titleTokens(title: string | null | undefined): Set<string> {
  const stop = new Set(["the", "and", "for", "of", "a", "an", "to", "in", "on", "at", "by", "with", "or", "services", "service"]);
  return new Set(
    (title ?? "")
      .toLowerCase()
      .replace(/[^a-z0-9 ]+/g, " ")
      .split(/\s+/)
      .filter((t) => t.length > 2 && !stop.has(t))
  );
}

/** Jaccard similarity of two titles, 0 to 1. */
export function titleSimilarity(a: string | null | undefined, b: string | null | undefined): number {
  const ta = titleTokens(a);
  const tb = titleTokens(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return inter / (ta.size + tb.size - inter);
}

export interface DuplicateCandidate {
  id: string;
  title: string | null;
  solicitation_number: string | null;
  source_id: string | null;
  source_url: string | null;
  status: string;
  stage: string;
}

export interface DuplicateMatch {
  id: string;
  title: string | null;
  reason: "source_id" | "solicitation_number" | "source_url" | "similar_title";
  confidence: "certain" | "likely";
  status: string;
  stage: string;
}

/**
 * Rank existing records against what is about to be added. An identity
 * match is certain; a title that shares most of its words is likely.
 */
export function findDuplicateMatches(
  incoming: { title?: string | null; solicitation_number?: string | null; source_id?: string | null; source_url?: string | null },
  candidates: DuplicateCandidate[]
): DuplicateMatch[] {
  const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();
  const out: DuplicateMatch[] = [];
  const seen = new Set<string>();
  const push = (c: DuplicateCandidate, reason: DuplicateMatch["reason"], confidence: DuplicateMatch["confidence"]) => {
    if (seen.has(c.id)) return;
    seen.add(c.id);
    out.push({ id: c.id, title: c.title, reason, confidence, status: c.status, stage: c.stage });
  };
  for (const c of candidates) {
    if (incoming.source_id && norm(c.source_id) === norm(incoming.source_id)) push(c, "source_id", "certain");
  }
  for (const c of candidates) {
    if (incoming.solicitation_number && norm(c.solicitation_number) === norm(incoming.solicitation_number))
      push(c, "solicitation_number", "certain");
  }
  for (const c of candidates) {
    if (incoming.source_url && norm(c.source_url) === norm(incoming.source_url)) push(c, "source_url", "certain");
  }
  for (const c of candidates) {
    if (titleSimilarity(incoming.title, c.title) >= 0.6) push(c, "similar_title", "likely");
  }
  return out;
}

export interface ImportMeta {
  method: ImportMethod;
  imported_at: string;
  imported_by: string | null;
  /** Per field, where the saved value came from. */
  provenance: Partial<Record<ImportedFieldKey, FieldProvenance>>;
  /** True when the platform keeps checking the source for changes. */
  monitored: boolean;
  fetch?: { status: "read" | "login_required" | "unreachable" | "not_enough" | "skipped"; detail?: string | null };
}

/** One sentence for the record page about how this solicitation got here. */
export function describeImport(meta: ImportMeta | null | undefined, source: string): string | null {
  if (!meta) return source === "sam_federal" ? null : null;
  const when = new Date(meta.imported_at);
  const day = Number.isNaN(when.getTime())
    ? ""
    : ` on ${when.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;
  const how =
    meta.method === "url"
      ? "Added from a link"
      : meta.method === "upload"
        ? "Added from uploaded documents"
        : "Entered by hand";
  const watch = meta.monitored
    ? "SAM.gov is checked for changes."
    : "Imported once; the source is not watched for changes.";
  return `${how}${day}. ${watch}`;
}
