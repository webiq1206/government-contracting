/**
 * Adding a solicitation somebody found themselves.
 *
 * Three ways in: paste a link, upload the documents, or type the essentials.
 * A link is read here, on the server, through the same SSRF guard every
 * other outbound fetch uses; what can be read off the page directly is
 * marked "from the source", what the model fills in is marked "suggested by
 * AI", and whatever the person changes is "entered by you". Nothing is
 * invented: a field the source did not state stays empty for the person to
 * fill, and a page that cannot be read says so with a way to continue.
 */
import { randomUUID, createHash } from "node:crypto";
import { z } from "zod";
import { query, queryOne } from "./db";
import { enqueue } from "./queue";
import { logAgent } from "./logger";
import { sam, type SamOpportunity } from "./integrations/sam";
import { guardedFetch, GuardedFetchError } from "./integrations/guarded-fetch";
import { extractPdfText, looksLikePdfBytes } from "./integrations/pdf";
import { completeJson, ClaudeNotConfiguredError } from "./ai/claude";
import { ingestOpportunity } from "./domain/opportunity-ingest";
import { normalizeSamNotice } from "./agents/opportunity-monitor";
import { noticePlainText } from "./domain/notice-brief";
import {
  parseSolicitationUrl,
  extractFromHtml,
  htmlToText,
  findDuplicateMatches,
  IMPORTED_FIELD_KEYS,
  type ImportedFields,
  type ImportedFieldKey,
  type FieldProvenance,
  type ImportMeta,
  type ImportMethod,
  type DuplicateMatch,
  type DuplicateCandidate,
} from "./domain/solicitation-import";
import { ensureNoticeDescription } from "./opportunity-description";

const MAX_PAGE_BYTES = 3 * 1024 * 1024;
const AI_TEXT_CHARS = 14_000;

export type FetchStatus = "read" | "login_required" | "unreachable" | "not_enough";

export interface ImportPreview {
  url: string;
  kind: "sam_notice" | "web";
  status: FetchStatus;
  /** Plain English for the person: what happened and what to do next. */
  message: string;
  fields: ImportedFields;
  provenance: Partial<Record<ImportedFieldKey, FieldProvenance>>;
  /** Kept so a later save can ingest the SAM notice whole. */
  samNoticeId: string | null;
  duplicates: DuplicateMatch[];
}

const EMPTY: ImportedFields = {
  title: null,
  agency: null,
  solicitation_number: null,
  description: null,
  deadline: null,
  posted_at: null,
  naics_code: null,
  set_aside_type: null,
  location_text: null,
  attachments: [],
};

const AiFields = z.object({
  title: z.string().nullable().optional(),
  agency: z.string().nullable().optional(),
  solicitation_number: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  deadline: z.string().nullable().optional(),
  posted_at: z.string().nullable().optional(),
  naics_code: z.string().nullable().optional(),
  set_aside_type: z.string().nullable().optional(),
  location_text: z.string().nullable().optional(),
});

function isoOrNull(v: string | null | undefined): string | null {
  if (!v) return null;
  const t = new Date(v);
  return Number.isNaN(t.getTime()) ? null : t.toISOString();
}

/**
 * Ask the model to fill what the page did not state outright. It is told to
 * leave a field empty rather than guess, and everything it returns is
 * labelled as a suggestion.
 */
async function inferFields(text: string, known: Partial<ImportedFields>): Promise<Partial<ImportedFields>> {
  const prompt = [
    "Below is the text of a public procurement notice or a web page about one.",
    "Extract these fields as JSON. Use null for anything the text does not clearly state. Never invent a value.",
    "Fields: title, agency (issuing organization), solicitation_number, description (2 to 5 sentences in plain English about the work, taken from the text), deadline (ISO 8601 date-time of the response or bid due date), posted_at (ISO 8601), naics_code (6 digits), set_aside_type (e.g. Small Business Set-Aside, or null), location_text (city and state of the work).",
    known.title ? `A title already read from the page: ${known.title}` : "",
    "",
    "TEXT:",
    text.slice(0, AI_TEXT_CHARS),
  ]
    .filter((l) => l !== "")
    .join("\n");
  try {
    const { data } = await completeJson(prompt, {
      schema: AiFields,
      feature: "Solicitation import",
      injectProfile: false,
      maxTokens: 1200,
      retries: 1,
    });
    return {
      title: data.title?.trim() || null,
      agency: data.agency?.trim() || null,
      solicitation_number: data.solicitation_number?.trim() || null,
      description: data.description?.trim() || null,
      deadline: isoOrNull(data.deadline ?? null),
      posted_at: isoOrNull(data.posted_at ?? null),
      naics_code: data.naics_code && /^\d{6}$/.test(data.naics_code.trim()) ? data.naics_code.trim() : null,
      set_aside_type: data.set_aside_type?.trim() || null,
      location_text: data.location_text?.trim() || null,
    };
  } catch (err) {
    if (err instanceof ClaudeNotConfiguredError) return {};
    console.warn("[solicitation-import] AI extraction failed:", (err as Error).message);
    return {};
  }
}

function merge(
  retrieved: Partial<ImportedFields>,
  inferred: Partial<ImportedFields>
): { fields: ImportedFields; provenance: Partial<Record<ImportedFieldKey, FieldProvenance>> } {
  const fields: ImportedFields = { ...EMPTY, attachments: retrieved.attachments ?? [] };
  const provenance: Partial<Record<ImportedFieldKey, FieldProvenance>> = {};
  for (const key of IMPORTED_FIELD_KEYS) {
    const r = retrieved[key];
    const i = inferred[key];
    if (r) {
      fields[key] = r;
      provenance[key] = "retrieved";
    } else if (i) {
      fields[key] = i;
      provenance[key] = "inferred";
    }
  }
  return { fields, provenance };
}

async function duplicatesFor(
  orgId: string,
  incoming: { title?: string | null; solicitation_number?: string | null; source_id?: string | null; source_url?: string | null }
): Promise<DuplicateMatch[]> {
  const words = [...new Set((incoming.title ?? "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter((w) => w.length > 3))].slice(0, 4);
  const rows = await query<DuplicateCandidate>(
    `select id, title, solicitation_number, source_id, source_url, status, stage
       from opportunities
      where org_id=$1
        and (
          ($2::text is not null and source_id=$2)
          or ($3::text is not null and lower(btrim(solicitation_number))=lower(btrim($3)))
          or ($4::text is not null and source_url=$4)
          or ($5::text[] <> '{}'::text[] and title ilike any($5))
        )
      order by status='open' desc, updated_at desc
      limit 40`,
    [
      orgId,
      incoming.source_id ?? null,
      incoming.solicitation_number ?? null,
      incoming.source_url ?? null,
      words.map((w) => `%${w}%`),
    ]
  );
  return findDuplicateMatches(incoming, rows);
}

/** Read a pasted link and say what was found. Writes nothing. */
export async function previewSolicitationUrl(orgId: string, raw: string): Promise<ImportPreview | { error: string }> {
  const parsed = parseSolicitationUrl(raw);
  if (parsed.kind === "invalid") return { error: parsed.reason };

  if (parsed.kind === "sam_notice") {
    const res = await sam.getNotice(parsed.noticeId, orgId);
    if (res.disabled) {
      return {
        url: parsed.url,
        kind: "sam_notice",
        status: "unreachable",
        message:
          res.disabledReason === "quota_exhausted"
            ? "Today's SAM.gov request allowance is used up, so the notice could not be read. Enter the details below, or try again tomorrow."
            : "SAM.gov is not connected on this account, so the notice could not be read. Connect it under Settings, Integrations, or enter the details below.",
        fields: { ...EMPTY },
        provenance: {},
        samNoticeId: parsed.noticeId,
        duplicates: await duplicatesFor(orgId, { source_id: parsed.noticeId, source_url: parsed.url }),
      };
    }
    if (res.error || !res.notice) {
      return {
        url: parsed.url,
        kind: "sam_notice",
        status: "unreachable",
        message: res.error
          ? `SAM.gov did not answer (${res.error}). Enter the details below or try again shortly.`
          : "SAM.gov has no notice with that id, or it is older than a year. Check the link, or enter the details below.",
        fields: { ...EMPTY },
        provenance: {},
        samNoticeId: parsed.noticeId,
        duplicates: await duplicatesFor(orgId, { source_id: parsed.noticeId, source_url: parsed.url }),
      };
    }
    const n = normalizeSamNotice(res.notice);
    const description = await ensureDescriptionText(orgId, res.notice);
    const fields: ImportedFields = {
      title: n.title,
      agency: n.agency,
      solicitation_number: n.solicitation_number,
      description,
      deadline: n.deadline,
      posted_at: n.posted_at,
      naics_code: n.naics_code,
      set_aside_type: n.set_aside_type,
      location_text: [n.location_text, n.location_state].filter(Boolean).join(", ") || null,
      attachments: (n.attachments_json as { name: string; url: string }[]).filter((a) => a.url),
    };
    const provenance: Partial<Record<ImportedFieldKey, FieldProvenance>> = {};
    for (const key of IMPORTED_FIELD_KEYS) if (fields[key]) provenance[key] = "retrieved";
    return {
      url: parsed.url,
      kind: "sam_notice",
      status: "read",
      message: "Read from SAM.gov. This notice will be checked for changes like every other SAM.gov opportunity.",
      fields,
      provenance,
      samNoticeId: res.notice.noticeId,
      duplicates: await duplicatesFor(orgId, {
        title: fields.title,
        solicitation_number: fields.solicitation_number,
        source_id: res.notice.noticeId,
        source_url: parsed.url,
      }),
    };
  }

  // A web page or a PDF somewhere on the public internet.
  let body: Buffer;
  let contentType: string;
  try {
    const res = await guardedFetch(parsed.url, {
      maxBytes: MAX_PAGE_BYTES,
      timeoutMs: 20_000,
      maxRedirects: 5,
      allowInsecure: true,
      onOversize: "truncate",
      headers: { "user-agent": "Mozilla/5.0 (compatible; BROSTCO-Import/1.0)" },
    });
    body = res.body;
    contentType = res.contentType;
  } catch (err) {
    const e = err as GuardedFetchError;
    const status = e instanceof GuardedFetchError ? e.status : null;
    const loginLike = status === 401 || status === 403;
    return {
      url: parsed.url,
      kind: "web",
      status: loginLike ? "login_required" : "unreachable",
      message: loginLike
        ? "That page asks for a login, so it cannot be read from here. Download the solicitation documents and upload them below, or enter the details by hand."
        : status === 404 || status === 410
          ? "That link answers Not Found. Check it, upload the documents, or enter the details by hand."
          : `That page could not be read (${e instanceof GuardedFetchError ? e.kind.replace(/_/g, " ") : "network error"}). Upload the documents or enter the details by hand.`,
      fields: { ...EMPTY },
      provenance: {},
      samNoticeId: null,
      duplicates: await duplicatesFor(orgId, { source_url: parsed.url }),
    };
  }

  let retrieved: Partial<ImportedFields> = {};
  let text = "";
  if (contentType.includes("pdf") || looksLikePdfBytes(body)) {
    const pdf = await extractPdfText(body, 60_000);
    text = pdf.text;
    retrieved = { attachments: [{ name: parsed.url.split("/").pop() || "solicitation.pdf", url: parsed.url }] };
  } else if (contentType.includes("html") || contentType.includes("text")) {
    const html = body.toString("utf8");
    retrieved = extractFromHtml(html, parsed.url);
    text = htmlToText(html, 60_000);
  } else {
    return {
      url: parsed.url,
      kind: "web",
      status: "not_enough",
      message: `That link is a ${contentType.split(";")[0] || "file"} rather than a page, and it could not be read as text. Upload the documents or enter the details by hand.`,
      fields: { ...EMPTY },
      provenance: {},
      samNoticeId: null,
      duplicates: await duplicatesFor(orgId, { source_url: parsed.url }),
    };
  }
  if (text.trim().length < 200 && !retrieved.title) {
    return {
      url: parsed.url,
      kind: "web",
      status: "not_enough",
      message:
        "The page loaded but has almost no readable text; it may build its content in the browser or behind a search. Upload the documents or enter the details by hand.",
      fields: { ...EMPTY, ...retrieved, attachments: retrieved.attachments ?? [] },
      provenance: {},
      samNoticeId: null,
      duplicates: await duplicatesFor(orgId, { source_url: parsed.url }),
    };
  }
  const inferred = await inferFields(text, retrieved);
  const { fields, provenance } = merge(retrieved, inferred);
  const gaps = IMPORTED_FIELD_KEYS.filter((k) => !fields[k] && ["title", "deadline", "agency"].includes(k));
  return {
    url: parsed.url,
    kind: "web",
    status: "read",
    message:
      gaps.length > 0
        ? `Read the page. It did not state ${gaps.map((g) => g.replace(/_/g, " ")).join(", ")}; fill those in below. This link is imported once and not watched for changes.`
        : "Read the page. Check the details below before saving. This link is imported once and not watched for changes.",
    fields,
    provenance,
    samNoticeId: null,
    duplicates: await duplicatesFor(orgId, {
      title: fields.title,
      solicitation_number: fields.solicitation_number,
      source_url: parsed.url,
    }),
  };
}

async function ensureDescriptionText(orgId: string, notice: SamOpportunity): Promise<string | null> {
  const desc = notice.description ?? null;
  if (desc && !/^https?:\/\//i.test(desc.trim())) return noticePlainText(desc);
  const res = await sam.noticeDescription(notice.noticeId, orgId);
  return res.description ? noticePlainText(res.description) : null;
}

export interface CreateSolicitationInput {
  method: ImportMethod;
  url?: string | null;
  samNoticeId?: string | null;
  fields: Partial<ImportedFields>;
  /** Provenance as the form last knew it; edited fields arrive as "entered". */
  provenance: Partial<Record<ImportedFieldKey, FieldProvenance>>;
  attachments?: { name: string; url: string }[];
  /** Add even though a likely duplicate exists. */
  force?: boolean;
}

export type CreateSolicitationResult =
  | { ok: true; id: string; scoringQueued: boolean }
  | { ok: false; duplicates: DuplicateMatch[] }
  | { ok: false; error: string };

/** Save the record and start the same workflow every found opportunity gets. */
export async function createSolicitation(
  orgId: string,
  actorEmail: string | null,
  input: CreateSolicitationInput
): Promise<CreateSolicitationResult> {
  const f = input.fields;
  const title = f.title?.trim() || null;
  if (!title) return { ok: false, error: "A title is required." };
  const deadline = isoOrNull(f.deadline ?? null);
  if (f.deadline && !deadline) return { ok: false, error: "The deadline is not a date." };
  const solNum = f.solicitation_number?.trim() || null;

  let samNotice: SamOpportunity | null = null;
  if (input.samNoticeId) {
    const res = await sam.getNotice(input.samNoticeId, orgId);
    samNotice = res.notice ?? null;
  }
  const sourceUrl = input.url?.trim() || null;
  const sourceId = samNotice
    ? samNotice.noticeId
    : sourceUrl
      ? `web:${createHash("sha256").update(sourceUrl).digest("hex").slice(0, 32)}`
      : `${input.method}:${randomUUID()}`;

  if (!input.force) {
    const dups = await duplicatesFor(orgId, { title, solicitation_number: solNum, source_id: sourceId, source_url: sourceUrl });
    if (dups.length > 0) return { ok: false, duplicates: dups };
  }

  const provenance: Partial<Record<ImportedFieldKey, FieldProvenance>> = {};
  for (const key of IMPORTED_FIELD_KEYS) {
    const value = f[key];
    if (value) provenance[key] = input.provenance[key] ?? "entered";
  }
  const importMeta: ImportMeta = {
    method: input.method,
    imported_at: new Date().toISOString(),
    imported_by: actorEmail,
    provenance,
    monitored: Boolean(samNotice),
  };

  const base = samNotice ? normalizeSamNotice(samNotice) : null;
  const attachments = (input.attachments ?? []).filter((a) => a?.url).slice(0, 25);
  const res = await ingestOpportunity({
    orgId,
    source: samNotice ? "sam_federal" : input.method === "url" ? "web" : input.method,
    source_id: sourceId,
    solicitation_number: solNum ?? base?.solicitation_number ?? null,
    title,
    description: f.description?.trim() || base?.description || null,
    naics_code: f.naics_code?.trim() || base?.naics_code || null,
    psc_code: base?.psc_code ?? null,
    set_aside_type: f.set_aside_type?.trim() || base?.set_aside_type || null,
    value_estimated: base?.value_estimated ?? null,
    value_estimated_source: base?.value_estimated_source ?? null,
    deadline: deadline ?? base?.deadline ?? null,
    posted_at: isoOrNull(f.posted_at ?? null) ?? base?.posted_at ?? null,
    location_state: base?.location_state ?? null,
    location_text: f.location_text?.trim() || base?.location_text || null,
    agency: f.agency?.trim() || base?.agency || null,
    sub_agency: base?.sub_agency ?? null,
    contact_json: base?.contact_json ?? null,
    attachments_json: attachments.length > 0 ? attachments : (base?.attachments_json ?? []),
    raw_json: base?.raw_json ?? { import: { method: input.method, url: sourceUrl } },
    is_sources_sought: base?.is_sources_sought ?? false,
    source_url: sourceUrl,
    import_meta: importMeta,
  });
  if (!res.id) return { ok: false, error: "The record could not be saved." };
  if (!res.inserted) {
    // The identity matched an existing row after all (a race, or force on a
    // certain match). Say so rather than pretending a second record exists.
    return { ok: true, id: res.id, scoringQueued: false };
  }
  if (samNotice) {
    await ensureNoticeDescription(orgId, { id: res.id, source: "sam_federal", source_id: samNotice.noticeId, description: base?.description ?? null }).catch(() => null);
  }

  if (res.isSourcesSought) {
    await enqueue("sources-sought-responder", { opportunityId: res.id }, { orgId });
  }
  const queued = await enqueue(
    "scoring-engine",
    { opportunityId: res.id },
    { singletonKey: `score:${res.id}`, singletonSeconds: 3600, orgId }
  );
  await logAgent({
    agent: "operator",
    action: "solicitation-added",
    level: "info",
    opportunityId: res.id,
    message: `${actorEmail ?? "Somebody"} added "${title}" ${input.method === "url" ? "from a link" : input.method === "upload" ? "from uploaded documents" : "by hand"}.${queued ? "" : " Scoring was not queued because automation is paused."}`,
  });
  return { ok: true, id: res.id, scoringQueued: Boolean(queued) };
}

/** Existing rows that look like the one about to be added. */
export async function findSolicitationDuplicates(
  orgId: string,
  incoming: { title?: string | null; solicitation_number?: string | null; source_url?: string | null }
): Promise<DuplicateMatch[]> {
  return duplicatesFor(orgId, incoming);
}

/** Read-only helper for the record page. */
export async function importedRecordSummary(id: string, orgId: string) {
  return queryOne<{ source: string; source_url: string | null; import_meta: ImportMeta | null }>(
    `select source, source_url, import_meta from opportunities where id=$1 and org_id=$2`,
    [id, orgId]
  );
}
