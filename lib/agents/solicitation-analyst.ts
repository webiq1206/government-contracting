/**
 * SOLICITATION ANALYST, triggered when an opportunity reaches the pursue tier.
 * Reads the solicitation (description + attachment names/urls; best-effort fetch
 * of attachment text where trivially possible), then uses Claude to produce a
 * structured SolicitationAnalysis: plain-language scope, submission requirements,
 * evaluation criteria, required trades, geographic area, risk flags, a past-perf
 * classification, questions for subs, a draft SOW, and key dates.
 *
 * ROUTING: if past_perf_classification is "prime_only" we BLOCK, flag for human
 * review, keep the opportunity in 'analysis', add a "prime_only_blocked" risk
 * flag, and do NOT enqueue downstream work. Otherwise (not_required |
 * team_accepted) we advance the stage to 'sub_research' and trigger Sub Finder.
 */
import { z } from "zod";
import { config } from "../config";
import { query, queryOne } from "../db";
import { getProfileJson } from "../ai/companyProfile";
import { completeJson, ClaudeNotConfiguredError } from "../ai/claude";
import { analysisInputHash, inputsUnchanged } from "../domain/analysis-inputs";
import { tightenAnalysisProse } from "../domain/analysis-prose";
import { requirementsFingerprint } from "../domain/package";
import { assembleAttachmentContext, coverageSummary } from "../domain/extraction-budget";
import { logAgent } from "../logger";
import { deepNoEmDash } from "../sanitize";
import { extractValueFromText } from "../domain/value-extract";
import {
  evaluateSolicitationCompleteness,
  type AttachmentFetchOutcome,
  type AttachmentFetchStatus,
} from "../domain/solicitation-completeness";
import { storage } from "../integrations/storage";
import {
  guardedFetch,
  GuardedFetchError,
  redactUrl,
  type GuardedFetchResult,
} from "../integrations/guarded-fetch";
import { extractPdfText, looksLikePdf, looksLikePdfBytes } from "../integrations/pdf";
import { ocrPdf } from "../integrations/pdf-ocr";
import { filenameFromResponse, isArchive, normalizeAttachmentMeta } from "../domain/attachment-meta";
import type { AgentDefinition } from "./types";
import type {
  AgentResult,
  Opportunity,
  SolicitationAnalysis,
  Attachment,
} from "../types";

/** Soft cap: prefer collecting the full linked packet when SAM provides many URLs. */
/**
 * Attachments fetched at once. There is no cap on how many are processed, only
 * on how many are in flight: forty concurrent downloads of up to 25MB each is
 * a gigabyte of buffers, and the reason the old code got away with it was the
 * forty-file limit that was losing amendments.
 */
const ATTACHMENT_CONCURRENCY = 5;

/** Run over a list with a bounded number in flight, preserving input order. */
async function inBatches<T, R>(
  items: readonly T[],
  size: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += size) {
    const batch = items.slice(i, i + size);
    out.push(...(await Promise.all(batch.map((item, j) => fn(item, i + j)))));
  }
  return out;
}

const NA = "Not specified in the provided documents";

export const AnalysisSchema = z.object({
  project_overview: z.string().default(NA),
  scope_plain_language: z.string().default(NA),
  location: z.string().default(NA),
  estimated_value: z.string().default(NA),
  due_date: z.string().default(NA),
  qualifications: z
    .object({
      certifications: z.array(z.string()).default([]),
      licenses: z.array(z.string()).default([]),
      insurance: z.array(z.string()).default([]),
      bonding: z.array(z.string()).default([]),
      experience: z.array(z.string()).default([]),
      other: z.array(z.string()).default([]),
    })
    .default({}),
  prebid_meeting: z
    .object({ required: z.boolean().default(false), details: z.string().optional() })
    .nullable()
    .default(null),
  site_visit: z
    .object({ required: z.boolean().default(false), details: z.string().optional() })
    .nullable()
    .default(null),
  submission_method: z.string().default(NA),
  /**
   * Two facts that belong ON the offer and were never extracted at all, so
   * the transmittal letter and the pricing schedule could not state them:
   * how long the work runs, and how long the price stands. A contracting
   * officer looks for both, and an offer that omits the acceptance period can
   * be treated as non-conforming. Verbatim from the documents or the "Not
   * specified" string, never a customary default.
   */
  period_of_performance: z.string().default(NA),
  offer_acceptance_period: z.string().default(NA),
  /**
   * The agency's OWN schedule of items, verbatim.
   *
   * Federal solicitations price by CLIN: numbered line items with a
   * description, a quantity and a unit, and the offer is expected on that
   * structure. Our pricing schedule was a rollup of subcontractor trades
   * ("Electrical", "Roofing"), which is not what the agency asked to be
   * filled in, and nothing anywhere held the agency's structure so nothing
   * could tell the difference. Empty when the solicitation does not enumerate
   * line items; never reconstructed from the scope.
   */
  bid_schedule: z
    .array(
      z.object({
        clin: z.string().optional().catch(undefined),
        description: z.string(),
        quantity: z.string().optional().catch(undefined),
        unit: z.string().optional().catch(undefined),
      })
    )
    .default([]),
  submission_requirements: z.array(z.string()).default([]),
  evaluation_criteria: z.array(z.string()).default([]),
  required_forms: z
    .array(z.object({ name: z.string(), note: z.string().optional() }))
    .default([]),
  key_dates: z.array(z.object({ label: z.string(), date: z.string() })).default([]),
  contacts: z
    .array(
      z.object({
        name: z.string().optional(),
        role: z.string().optional(),
        email: z.string().optional(),
        phone: z.string().optional(),
      })
    )
    .default([]),
  qa_addenda: z
    .array(z.object({ label: z.string(), summary: z.string(), date: z.string().optional() }))
    .default([]),
  special_requirements: z.array(z.string()).default([]),
  attention_items: z.array(z.string()).default([]),
  pursue_recommendation: z.string().default(NA),
  required_trades: z.array(z.string()).default([]),
  trade_scopes: z
    .array(z.object({ trade: z.string(), work: z.string() }))
    .default([]),
  geographic_area: z.string().default(NA),
  risk_flags: z.array(z.string()).default([]),
  // No default and no coercion meant one unexpected word here threw away the
  // whole analysis. Unrecognised now routes to prime_only, which blocks and
  // asks a person, rather than silently sourcing subs for a bid whose past
  // performance rules were never actually read.
  past_perf_classification: z.unknown().transform(toPastPerf),
  questions_for_subs: z.array(z.string()).default([]),
  draft_sow: z.string().default(""),
  set_aside: z.string().nullable().default(null),
  compliance_matrix: z
    .array(
      z.object({
        id: z.string().catch(""),
        title: z.string(),
        // Coerced, never rejected. `.default()` only fires on undefined, so a
        // model that answered "certifications" instead of "certification"
        // threw, and because the throw happens on the whole object, ONE
        // out-of-enum word destroyed the entire analysis: scope, dates,
        // trades, every requirement. The retry usually repeated it. Mapping
        // the near miss keeps the other forty fields, and an unrecognised
        // value lands on the safe side rather than nowhere.
        category: z.unknown().transform(toCategory),
        mandatory: z.boolean().catch(true),
        source: z.string().catch(NA),
        format: z.string().optional().catch(undefined),
        signature_required: z.boolean().catch(false),
        satisfied_by: z.unknown().transform(toSatisfiedBy),
        instructions: z.string().optional().catch(undefined),
        official_form: z.string().optional().catch(undefined),
      })
    )
    .default([]),
});

function toPastPerf(v: unknown): "not_required" | "team_accepted" | "prime_only" {
  const s = String(v ?? "").toLowerCase().trim();
  if (s === "not_required" || s === "team_accepted" || s === "prime_only") return s;
  if (/not.?required|none|n\/a/.test(s)) return "not_required";
  if (/team|sub|joint|partner/.test(s)) return "team_accepted";
  return "prime_only";
}

const CATEGORY_VALUES = [
  "form",
  "pricing",
  "narrative",
  "certification",
  "acknowledgment",
  "attachment",
  "other",
] as const;
type MatrixCategory = (typeof CATEGORY_VALUES)[number];

function toCategory(v: unknown): MatrixCategory {
  const s = String(v ?? "").toLowerCase().trim();
  if ((CATEGORY_VALUES as readonly string[]).includes(s)) return s as MatrixCategory;
  if (/certif|reps|represent/.test(s)) return "certification";
  if (/acknowledg|amend|addend/.test(s)) return "acknowledgment";
  if (/pric|cost|bid schedule|schedule of/.test(s)) return "pricing";
  if (/narrative|technical|approach|letter|plan|volume|proposal/.test(s)) return "narrative";
  if (/form|sf[- ]?\d/.test(s)) return "form";
  if (/attach|exhibit|enclosure|supporting/.test(s)) return "attachment";
  return "other";
}

const SATISFIED_VALUES = [
  "auto_generated",
  "from_profile",
  "operator_signature",
  "operator_provided",
] as const;
type SatisfiedBy = (typeof SATISFIED_VALUES)[number];

function toSatisfiedBy(v: unknown): SatisfiedBy {
  const s = String(v ?? "").toLowerCase().trim();
  if ((SATISFIED_VALUES as readonly string[]).includes(s)) return s as SatisfiedBy;
  if (/signature|sign/.test(s)) return "operator_signature";
  if (/profile|company data/.test(s)) return "from_profile";
  if (/auto|generat|platform/.test(s)) return "auto_generated";
  // Anything unrecognised is the operator's. Guessing "we generate this" for
  // a word we do not know would mark an item done with nothing behind it.
  return "operator_provided";
}

const MAX_ATTACH_BYTES = 25 * 1024 * 1024; // 25MB cap per file
/**
 * Whole-download budget per attachment. There was no timeout at all before, so
 * one server that accepted the connection and then sent nothing held a worker
 * slot until the process was restarted.
 */
const ATTACH_TIMEOUT_MS = 60_000;

/**
 * What a refused or failed download means to the completeness check.
 *
 * The distinction that matters: "failed" is worth retrying and "refused" is
 * not. A link that points at a private address will point at a private address
 * again tomorrow, so telling an operator to re-run analysis wastes their time.
 * The file has to come from a person.
 */
function attachmentStatusFor(err: GuardedFetchError): AttachmentFetchStatus {
  switch (err.kind) {
    case "blocked_scheme":
    case "blocked_host":
    case "blocked_address":
    case "too_many_redirects":
    case "unsupported_type":
      return "refused";
    case "too_large":
      return "too_large";
    default:
      return "failed";
  }
}

/**
 * Download a solicitation attachment, persist it (Supabase Storage or local
 * fallback) + record it in `documents`, and return extracted text for Claude:
 *   - PDFs are parsed to text with unpdf.
 *   - text/html/json responses are captured as a snippet.
 *   - other binaries are stored and noted (no text).
 * Any failure degrades to a note; it never throws.
 */
async function processAttachment(
  opportunityId: string,
  att: Attachment,
  index: number
): Promise<{ context: string; parsedChars: number; outcome: AttachmentFetchOutcome }> {
  const ingestLabel = att.name || `attachment-${index + 1}`;
  let label = ingestLabel;
  if (!att.url) {
    return {
      context: `- ${label} (no url)`,
      parsedChars: 0,
      outcome: { name: label, url: null, status: "no_url", detail: "No download URL on the notice" },
    };
  }
  try {
    /*
     * `att.url` is a resourceLink copied out of a SAM.gov notice. Nobody here
     * wrote it, so it is fetched through the guard: scheme and destination
     * address checked before connecting and re-checked on every redirect hop,
     * and the size limit applied while the bytes are arriving rather than
     * after the whole response is already in memory.
     */
    let fetched: GuardedFetchResult;
    try {
      fetched = await guardedFetch(att.url, {
        maxBytes: MAX_ATTACH_BYTES,
        timeoutMs: ATTACH_TIMEOUT_MS,
      });
    } catch (err) {
      if (err instanceof GuardedFetchError) {
        const status = attachmentStatusFor(err);
        return {
          context: `- ${label} (${redactUrl(att.url)}), not collected: ${err.message}`,
          parsedChars: 0,
          outcome: { name: label, url: att.url, status, detail: err.message },
        };
      }
      throw err;
    }
    const ct = fetched.contentType;
    // SAM's notice JSON names every resourceLink "attachment"; the server's
    // Content-Disposition carries the real filename ("Wage Determination.pdf").
    // Recover it here so document names mean something everywhere downstream:
    // the Files tab, trade prioritisation, official-form linking, and the
    // filenames a subcontractor sees on the outreach email.
    label = filenameFromResponse({
      contentDisposition: fetched.contentDisposition,
      url: att.url,
      fallback: label,
    });
    const buf = fetched.body;

    // Persist the raw file + a documents row (best-effort).
    // Sniff bytes so SAM's generic "attachment" / octet-stream metadata does not
    // break email openability later (clients and Resend key off name + MIME).
    const meta = normalizeAttachmentMeta({
      filename: label,
      mime: ct || null,
      content: buf,
    });
    // Keep the storage key stable across re-runs: derived from the INGEST
    // label, never the header-recovered one. A re-run then computes the same
    // path, finds the existing document row, and the update below renames it
    // in place; keying on the recovered name would store the same bytes twice
    // under two names. Openability comes from documents.name/mime and
    // send-time normalization, plus Content-Type on /api/files.
    const safeKeyStem = ingestLabel.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 120) || "attachment";
    const key = `solicitations/${opportunityId}/${index + 1}_${safeKeyStem}`;
    let stored = false;
    try {
      const up = await storage.upload(key, buf, meta.mime);
      // Upsert-by-path so re-running the analyst does not duplicate document rows.
      const existing = await queryOne<{ id: string }>(
        `select id from documents where opportunity_id=$1 and storage_path=$2`,
        [opportunityId, up.path]
      );
      if (!existing) {
        await query(
          `insert into documents (opportunity_id, kind, name, storage_path, storage_backend, mime, meta)
           values ($1,'solicitation',$2,$3,$4,$5,$6)`,
          [
            opportunityId,
            meta.filename,
            up.path,
            up.backend,
            meta.mime,
            JSON.stringify({ source_url: att.url }),
          ]
        );
      } else {
        await query(
          `update documents set name=$1, mime=$2, storage_backend=$3 where id=$4`,
          [meta.filename, meta.mime, up.backend, existing.id]
        );
      }
      stored = true;
    } catch (err) {
      // Extraction continues (analysis still needs the text), but a document
      // that is not stored will not be attached to any outreach email, so
      // the failure has to be visible, not "best-effort" silence.
      console.error(
        `[solicitation-analyst] failed to store ${redactUrl(att.url)}: ${(err as Error).message}`
      );
    }

    // Trust the actual bytes over SAM's (usually generic/wrong) headers.
    if (looksLikePdf(att.url, ct) || looksLikePdfBytes(buf)) {
      // Read the WHOLE document. extractPdfText defaults to 14,000 characters,
      // roughly five pages, so a real solicitation was cut off inside Section
      // B or C and Sections L and M, where every submission instruction and
      // evaluation factor lives, never reached the model at all. The prompt
      // then falls back to inferring "standard" items, which is how a package
      // gets built against a checklist nobody read. The per-attachment budget
      // below decides what actually fits in the prompt; this decides what is
      // available to choose from.
      const { text, pages } = await extractPdfText(buf, 400_000);
      if (text) {
        return {
          context: `- ${label} (${pages} pp, extracted):\n${text}`,
          parsedChars: text.length,
          outcome: {
            name: label,
            url: att.url,
            // "failed" when the store failed: the text was read for analysis,
            // but with no documents row the file cannot ride on outreach, and
            // reporting "fetched" here hid exactly that. (This ternary used to
            // read `stored ? "fetched" : "fetched"`.)
            status: stored ? "fetched" : "failed",
            detail: stored ? `${pages} pages` : `${pages} pages read, but the file could not be stored`,
          },
        };
      }
      // No text layer means a scan. Read it anyway: send the pages to Claude
      // for transcription rather than shrugging and letting the analysis be
      // built from the portal blurb. The transcript is labelled so nothing
      // downstream, and nobody reading the brief, mistakes a machine reading
      // of a photocopy for the document's own text.
      const ocr = await ocrPdf(buf, { label, model: config.claude.modelSmart });
      if (ocr.text) {
        const truncNote = ocr.truncated
          ? `\n[only the first ${ocr.pagesRead} of ${ocr.pagesTotal} pages were transcribed]`
          : "";
        return {
          context: `- ${label} (${ocr.pagesTotal} pp, SCANNED DOCUMENT, transcribed from the page images; anything marked [illegible] was not readable and must not be guessed):\n${ocr.text}${truncNote}`,
          parsedChars: ocr.text.length,
          outcome: {
            name: label,
            url: att.url,
            status: stored ? "fetched" : "failed",
            detail: stored
              ? `${ocr.pagesRead} of ${ocr.pagesTotal} pages transcribed from a scan`
              : `${ocr.pagesRead} pages transcribed, but the file could not be stored`,
          },
        };
      }
      return {
        context: `- ${label}, scanned PDF stored but it could not be read (${ocr.error ?? "no readable text"}). Do NOT assume anything about its contents.`,
        parsedChars: 0,
        outcome: {
          name: label,
          url: att.url,
          status: stored ? "no_text" : "failed",
          detail: ocr.error ?? "PDF had no extractable text",
        },
      };
    }
    if (ct.includes("text") || ct.includes("html") || ct.includes("json")) {
      const text = buf.toString("utf8").slice(0, 6000);
      return {
        context: `- ${label}:\n${text}`,
        parsedChars: text.length,
        outcome: { name: label, url: att.url, status: "fetched" },
      };
    }
    /*
     * An archive is not merely unsupported, it is a container of documents
     * nobody opened.
     *
     * Nothing in this codebase extracts archives, so a notice whose entire
     * solicitation package arrives as `Solicitation.zip` used to report one
     * cleanly fetched attachment and advance, with every requirement inside
     * it unread and the analysis assembled from the portal blurb. Saying so
     * is the honest state; extracting it is a separate decision with its own
     * decompression-bomb problem.
     */
    if (isArchive(label, ct)) {
      return {
        context: `- ${label}: an ARCHIVE, stored but never opened. Its contents were not read by anything. Do NOT state or assume anything about what is inside it.`,
        parsedChars: 0,
        outcome: {
          name: label,
          url: att.url,
          status: stored ? "archive" : "failed",
          detail: "archive contents were not opened",
        },
      };
    }
    return {
      context: `- ${label} (${redactUrl(att.url)}), ${ct || "binary"} stored (not text-parseable)`,
      parsedChars: 0,
      outcome: {
        name: label,
        url: att.url,
        status: stored ? "unsupported" : "failed",
        detail: ct || "binary",
      },
    };
  } catch (err) {
    return {
      context: `- ${label} (${redactUrl(att.url)}), processing failed (${(err as Error).message})`,
      parsedChars: 0,
      outcome: {
        name: label,
        url: att.url,
        status: "failed",
        detail: (err as Error).message,
      },
    };
  }
}

/**
 * Characters of attachment text the analysis prompt may carry. Sized so a
 * real solicitation's instructions survive rather than being cut off after
 * the first few pages of the first file.
 */
const ATTACHMENT_PROMPT_BUDGET = 240_000;

function buildPrompt(opp: Opportunity, attachmentContext: string): string {
  return [
    "You are a government-procurement analyst. Read this solicitation and its attachments and produce a COMPLETE, plain-English bid brief so a busy contractor can understand the whole opportunity in a few minutes without reading hundreds of pages.",
    "",
    "RULES, follow exactly:",
    "1. Extract every important requirement that appears ANYWHERE in the notice or the attachment text below. Never omit a critical requirement, deadline, form, or qualification.",
    "2. Do NOT invent or assume anything. If a field is not stated in the provided material, set it to \"Not specified in the provided documents\" (or an empty list). Never guess a date, dollar amount, or requirement.",
    "3. Preserve exact figures, dates, times, timezones, form numbers, and clause references verbatim, do not round or paraphrase numbers.",
    "4. Write in clear plain English an operator can skim. Be concise but complete.",
    "",
    "OPPORTUNITY METADATA:",
    `Title: ${opp.title ?? "(none)"}`,
    `Agency: ${opp.agency ?? "(none)"}${opp.sub_agency ? " / " + opp.sub_agency : ""}`,
    `Solicitation #: ${opp.solicitation_number ?? "(none)"}`,
    `NAICS: ${opp.naics_code ?? "(none)"}  Set-aside: ${opp.set_aside_type ?? "(none)"}`,
    `Posted value (if any): ${opp.value_estimated ?? "(unknown)"}`,
    `Place of performance: ${opp.location_text ?? ""} ${opp.location_state ?? ""}`.trim(),
    `Response deadline (from portal): ${opp.deadline ?? "(unknown)"}`,
    opp.contact_json ? `Point of contact (from portal): ${JSON.stringify(opp.contact_json)}` : "",
    "",
    "DESCRIPTION:",
    // Combined Synopsis/Solicitation notices carry the ENTIRE solicitation,
    // instructions to offerors included, in the description with no
    // attachments at all, and they routinely run past 8,000 characters.
    (opp.description ?? "(no description provided)").slice(0, 60_000),
    "",
    "ATTACHMENT TEXT (parsed from the actual bid documents, PRIMARY SOURCE, prefer this over the portal summary):",
    (attachmentContext || "(no attachment text extracted)").slice(0, ATTACHMENT_PROMPT_BUDGET),
    "",
    "PAST-PERFORMANCE CLASSIFICATION, choose exactly one for past_perf_classification:",
    '- "not_required": the solicitation does not require past performance.',
    '- "team_accepted": past performance may be satisfied by the team, including subcontractor experience.',
    '- "prime_only": past performance must be the prime\'s OWN performance and cannot rely on subs.',
    "",
    "HOW TO WRITE THE LONG-FORM FIELDS. Every one of these is read on a screen by somebody looking for one fact inside it, often mid-phone-call. Write for scanning, not for reading end to end:",
    "  - No paragraphs. One item per line, newline separated. No bullet glyphs, no numbering, the display adds those.",
    "  - No preamble. Never open with 'This solicitation is for' or 'The contractor shall'. Start with the thing itself.",
    "  - One idea per line, and keep a line under about 20 words.",
    "  - Say the specific thing. 'Replace 14 rooftop units on buildings 3 and 4' beats 'perform HVAC work as specified'.",
    "  - No jargon, no form numbers, no contracting-officer contact details in any field a subcontractor might be read.",
    "",
    "Return ONE JSON object with EXACTLY these keys (use the \"Not specified\" string or [] where the documents are silent):",
    "{",
    '  "project_overview": string,               // TWO sentences at most: what the job is and who it is for. Not a summary of the whole document.',
    '  "scope_plain_language": string,           // the work itself, one task per line, newline separated. Never paragraphs. Each line is one deliverable a person could tick off.',
    '  "location": string,                       // full place of performance (address/city/state/base)',
    '  "estimated_value": string,                // e.g. "$120,000" or a range, or "Not specified..."',
    '  "due_date": string,                       // full bid due date AND time AND timezone, verbatim',
    '  "qualifications": {                        // everything the bidder must hold/prove',
    '     "certifications": string[], "licenses": string[], "insurance": string[],',
    '     "bonding": string[], "experience": string[], "other": string[] },',
    '  "prebid_meeting": { "required": boolean, "details": string } | null,   // date/time/location/registration if any',
    '  "site_visit": { "required": boolean, "details": string } | null,',
    '  "submission_method": string,              // how/where to submit: portal, email, hand-delivery, mailing address',
    '  "period_of_performance": string,          // how long the work runs, verbatim: a date range, a number of days after award, or a base-plus-options structure. "Not specified..." if the documents do not state it.',
    '  "offer_acceptance_period": string,        // how long the offer must remain valid, verbatim, e.g. "30 calendar days" or "60 days from the date of the offer" (SF-1449 block 12 / FAR 52.212-1). NEVER supply a customary default; "Not specified..." if the documents do not state it.',
    '  "bid_schedule": [{ "clin": string, "description": string, "quantity": string, "unit": string }],  // the agency\'s OWN schedule of items / CLIN table, transcribed line by line in the order printed, with the item numbers (0001, 1001, Item 1, Base Bid, Alternate 1) exactly as written. Include base, option and alternate lines. This is a TRANSCRIPTION: copy what the schedule lists and nothing else. Return [] if the solicitation does not enumerate priced line items, and NEVER build lines out of the scope of work or out of the trades involved.',
    '  "submission_requirements": string[],      // page limits, format, copies, sealed-bid rules, labeling, etc.',
    '  "evaluation_criteria": string[],          // how bids are evaluated (LPTA, best value, factors + weights)',
    '  "required_forms": [{ "name": string, "note": string }],   // SF-1449, reps & certs, bid bond form, wage decs, etc.',
    '  "key_dates": [{ "label": string, "date": string }],       // ALL dates: questions due, addenda, award, POP start/end, milestones',
    '  "contacts": [{ "name": string, "role": string, "email": string, "phone": string }],',
    '  "qa_addenda": [{ "label": string, "summary": string, "date": string }],  // amendments/addenda and Q&A if present',
    '  "special_requirements": string[],         // wage determinations, Buy American, security, environmental, small-biz subcontracting, etc.',
    '  "attention_items": string[],              // risks / unusual clauses (liquidated damages, tight timeline, high bonding, prime-only past perf) a human should note',
    '  "pursue_recommendation": string,          // ONE sentence: pursue or not, and the single biggest reason. No hedging both ways.',
    '  "required_trades": string[],              // trades we would need subcontractors for',
    '  "trade_scopes": [{ "trade": string, "work": string }],  // REQUIRED for each required_trades entry. `work` is what THAT trade does on THIS job: 2-4 short lines, newline separated, one task each, naming locations, materials and quantities where the documents give them. It is read aloud to a subcontractor who has never seen the solicitation, so no jargon, no form numbers, no contracting-officer contact info. Each trade MUST get its own distinct scope; never repeat the same text for two trades and never paste the overall scope, an electrician and a roofer must each see only their own work.',
    '  "geographic_area": string,                // area to source subs from',
    '  "risk_flags": string[],                   // short machine-ish flags, e.g. "liquidated_damages", "high_bonding"',
    '  "past_perf_classification": "not_required"|"team_accepted"|"prime_only",',
    '  "questions_for_subs": string[],           // AT MOST 4, and only things specific to THIS job. The call form already captures, with its own field, whether they can do the work, whether they are interested, their price, firm or estimate, start date, availability, insurance, bonding, licenses, certifications and past projects. Never ask any of those. Each question under 12 words, phrased to be said out loud. Never reveal that this is a government solicitation: no mention of the agency, an award, a bid, winning, or asking whether they have bid it themselves. Write them as a contractor pricing a job, not as a bidder.',
    '  "draft_sow": string,                      // overall scope to hand a subcontractor when trade_scopes is thin. Same format: one task per line, newline separated.',
    '  "set_aside": string | null,',
    '  "compliance_matrix": [                     // EVERY item the bid package must include to be responsive',
    '     {',
    '       "id": string,                         // short slug, e.g. "sf1449", "pricing_schedule", "reps_certs", "bid_bond", "amendment_ack_0001"',
    '       "title": string,                      // plain-English name, e.g. "Signed SF-1449 offer form"',
    '       "category": "form"|"pricing"|"narrative"|"certification"|"acknowledgment"|"attachment"|"other",',
    '       "mandatory": boolean,                 // true if required to be responsive; false if optional/if-applicable',
    '       "source": string,                     // where it is stated, e.g. "Section L.3" or "Attachment 2" (or "Not specified...")',
    '       "format": string,                     // format rules if any: file type, page limit, font, number of copies (omit if none)',
    '       "signature_required": boolean,        // does a person have to sign it',
    '       "satisfied_by": "auto_generated"|"from_profile"|"operator_signature"|"operator_provided",',
    '       "instructions": string,               // if the operator must supply/sign it, what exactly they do (omit otherwise)',
    '       "official_form": string               // EXACT form/worksheet id if a SPECIFIC government or agency form is required (e.g. "SF-1449", "SF-33", "SF-18", "SF-1442", "agency pricing worksheet Attachment 3", "SAM.gov reps & certs"). Omit if no specific form is mandated.',
    '     }',
    "  ]",
    "}",
    "",
    "COMPLIANCE MATRIX, this is critical. List EVERY document, form, schedule, certification, acknowledgment, and attachment the bidder must include for the bid to be responsive. Base it on the instructions to offerors, the scope, and the attachments. Classify each item's `satisfied_by`:",
    '- "auto_generated": the platform can produce it from the bid data (pricing/bid schedule, technical approach or cover/transmittal letter).',
    '- "from_profile": it is standard company information (company identifiers, capability statement, small-business status, standard certifications).',
    '- "operator_signature": the platform can prefill it but a person must sign it (SF-1449, reps & certifications, signed forms).',
    '- "operator_provided": only the offeror can supply it (bid bond, notarized document, insurance certificate, wet-ink or agency-portal-only forms).',
    "Every entry must come from something the documents actually say. If the material below does not enumerate the submission contents, return an EMPTY compliance_matrix. Do NOT fall back to the items a solicitation like this usually requires: a package assembled against a checklist nobody read is worse than no checklist, because it looks complete. An empty matrix is handled correctly downstream, it stops the package and asks a person to supply the requirements.",
    "Where a document was transcribed from a scan, treat [illegible] as unknown. Never fill in a form number, page limit, date or amount that was marked unreadable.",
    "IMPORTANT, official forms: whenever the solicitation requires a SPECIFIC government or agency form or fillable worksheet (any Standard Form like SF-1449/SF-33/SF-18/SF-1442, an agency-provided pricing/bid schedule, a portal-only form), set `official_form` to that exact identifier. These cannot be substituted with a generic document, so be precise. Also capture format constraints (page limits, font/size, number of copies, required file types, submission portal) in `format` and in `submission_requirements`.",
  ].join("\n");
}

/**
 * The fingerprint of everything this opportunity's analysis reads.
 *
 * Cheap on purpose: names, sizes, storage paths and timestamps, never file
 * bytes. Reading every attachment to decide whether to read every attachment
 * would cost most of what it saves, and these identifiers already separate the
 * cases that matter -- a new amendment is a new row, a replaced file changes
 * size or timestamp, an edited notice changes its text.
 */
async function computeAnalysisInputHash(
  opportunityId: string,
  opp: Opportunity
): Promise<string> {
  /*
   * Not caught. A failure here must not quietly produce a hash computed from
   * no documents at all: that hash would match the next run's, and a genuine
   * amendment would be skipped as "nothing has changed". Letting it throw
   * means the analysis runs, which costs one call and is the safe direction.
   */
  const docs = await query<{
    id: string;
    name: string;
    storage_path: string | null;
    version: number;
    created_at: string;
  }>(
    `select id::text as id, name, storage_path, version, created_at::text as created_at
       from documents
      where opportunity_id = $1 and kind in ('solicitation','sow')
      order by name asc`,
    [opportunityId]
  );

  return analysisInputHash({
    title: opp.title,
    solicitationNumber: opp.solicitation_number,
    description: opp.description,
    documents: docs.map((d) => ({
      name: d.name,
      // The row id IS the strongest signal available: a replaced or amended
      // document is a new row, so a changed id means changed content even
      // when the filename is identical.
      storagePath: `${d.id}:${d.storage_path ?? ""}:v${d.version}`,
      updatedAt: d.created_at,
    })),
  });
}

export const solicitationAnalyst: AgentDefinition = {
  name: "solicitation-analyst",
  label: "Solicitation Analyst",
  description:
    "Reads the solicitation + attachments, produces a structured analysis, classifies past performance, and routes to sub research (or blocks prime-only).",
  cron: undefined,
  worksWithoutClaude: false,
  async handler(ctx): Promise<AgentResult> {
    const opportunityId = ctx.payload.opportunityId as string;
    if (!opportunityId) return { ok: false, summary: "no opportunityId in payload" };

    const opp = await queryOne<Opportunity>(`select * from opportunities where id = $1`, [
      opportunityId,
    ]);
    if (!opp) return { ok: false, summary: `opportunity ${opportunityId} not found` };

    // Idempotency: a queue-triggered re-run must not re-download attachments and
    // re-bill a Claude analysis that already exists. Manual runs (or an explicit
    // force flag) re-analyze, e.g. after an amendment drops.
    //
    // The trigger is read from the PAYLOAD as well as the runner, because the
    // worker hardcodes runAgent(def, "queue", ...) for every queued job, so
    // ctx.trigger is always "queue" and the manual-run route's own
    // {trigger:"manual"} lands in the payload where nothing looked at it. The
    // effect was that re-analysis could never happen at all: once an
    // opportunity had been analyzed, every retry button, re-pursue, and bulk
    // re-run returned "skipped duplicate run", so an amendment's new
    // requirements, or a solicitation PDF uploaded after the first pass, never
    // reached the compliance matrix and the package kept being built against
    // the original, stale requirements.
    const forced =
      ctx.payload.force === true ||
      ctx.trigger === "manual" ||
      ctx.payload.trigger === "manual";
    if (opp.solicitation_analysis && !forced) {
      return {
        ok: true,
        summary: `Opportunity ${opportunityId} already analyzed; skipped duplicate run.`,
      };
    }

    /*
     * A forced re-run still has to be worth its price.
     *
     * This is the largest Claude call the system makes, and most forced runs
     * are asked for on an opportunity whose documents have not changed: a
     * re-pursue, a bulk re-run, the button pressed twice. Re-reading an
     * identical document set to produce an identical answer is pure waste.
     *
     * The distinction that must survive is between "an amendment landed" and
     * "somebody pressed the button again", so this compares a hash of exactly
     * the inputs that would change the answer. `force: "always"` remains, for
     * the case where an operator wants the model run again regardless.
     */
    const currentInputHash = await computeAnalysisInputHash(opportunityId, opp);
    if (
      forced &&
      opp.solicitation_analysis &&
      ctx.payload.force !== "always" &&
      inputsUnchanged(opp.analysis_input_hash, currentInputHash)
    ) {
      await logAgent({
        agent: "solicitation-analyst",
        action: "skip-unchanged",
        level: "info",
        opportunityId,
        message:
          "Re-analysis was requested but nothing has changed: the same documents, notice text and solicitation number as last time. The existing brief still applies, so the model was not run again.",
      });
      return {
        ok: true,
        summary:
          "Nothing has changed since the last analysis, so the existing brief was kept and no new analysis was billed.",
      };
    }

    // Trial meter. Placed after the idempotency return so re-running an
    // existing analysis is free: the meter counts opportunities analysed, not
    // times the agent was invoked.
    const { checkTrialQuota } = await import("../billing/trial-limits");
    const briefQuota = await checkTrialQuota(opp.org_id, "ai_briefs");
    if (!briefQuota.allowed) {
      return {
        ok: false,
        summary: briefQuota.message ?? "Trial limit reached.",
        humanActionRequired: true,
      };
    }

    const profile = await getProfileJson();
    if (!profile) return { ok: false, summary: "no active Company Profile" };

    // Download, store, and extract text from solicitation attachments (PDFs parsed).
    const attachments: Attachment[] = Array.isArray(opp.attachments_json)
      ? opp.attachments_json
      : [];
    /*
     * Every attachment, in bounded batches.
     *
     * This was `.slice(0, 40)` inside a `Promise.all`, which is two problems
     * wearing one line. Attachments past the fortieth were dropped without a
     * disposition, and SAM appends amendments and Q and A responses AFTER the
     * base documents, so the files that vanished were the ones most likely to
     * have changed the requirements. The forty that survived were then all
     * fetched at once, up to a gigabyte in flight.
     */
    const processed = await inBatches(attachments, ATTACHMENT_CONCURRENCY, (att, i) =>
      processAttachment(opportunityId, att, i)
    );

    /*
     * Decide what fits, and say what did not.
     *
     * Each document is offered an equal share of the prompt budget; one
     * shorter than its share takes only what it needs and releases the rest.
     * The previous version put an 8,000-character FLOOR under each share with
     * no ceiling on the total, so past thirty documents the shares summed past
     * the budget and a final slice on the joined text silently dropped whole
     * documents off the end. The arithmetic lives in the domain module, where
     * it can be tested without a database.
     */
    const { text: attachmentContext, plan } = assembleAttachmentContext(
      processed.map((p) => ({ name: p.outcome.name, context: p.context })),
      ATTACHMENT_PROMPT_BUDGET
    );
    const allocated = new Map(plan.allocations.map((a) => [a.id, a]));
    const parsedChars = processed.reduce((a, p) => a + p.parsedChars, 0);
    /*
     * A document that did not fit gets its own disposition rather than keeping
     * the one it earned by downloading cleanly.
     *
     * "fetched" would be true and misleading at the same time: the file is in
     * storage, and nothing in it reached the analysis. The completeness check
     * treats that as a blocker, which is the whole point, because a brief
     * assembled without a document must not read the same as one assembled
     * with it. Only a clean fetch is downgraded; a refusal or a failure is
     * already a more specific answer.
     */
    const attachmentOutcomes = processed.map((p, i) => {
      const a = allocated.get(String(i));
      if (a?.omitted && p.outcome.status === "fetched") {
        return {
          ...p.outcome,
          status: "not_read" as const,
          detail: "no room in the analysis for this document",
        };
      }
      return p.outcome;
    });
    await logAgent({
      agent: "solicitation-analyst",
      action: "attachments",
      opportunityId,
      level: plan.complete ? "info" : "warn",
      // Counts what happened, not what was asked for. The old line reported
      // `attachments.length` while the code had already discarded everything
      // past the fortieth, so a notice with fifty-seven attachments logged
      // fifty-seven processed and analysed forty.
      message: `${attachments.length} attachment(s) on the notice, ${processed.length} processed, ${parsedChars} chars extracted. Coverage: ${coverageSummary(plan)}. Outcomes: ${attachmentOutcomes.map((o) => `${o.name}:${o.status}`).join(", ") || "none"}`,
    });

    let analysis: SolicitationAnalysis;
    try {
      const { data, usage } = await completeJson(buildPrompt(opp, attachmentContext), {
        schema: AnalysisSchema,
        model: config.claude.modelSmart, // bid-critical extraction, never omit a requirement
        maxTokens: 8192,
      });
      // Hard rule: strip em dashes from all AI text before it is stored or shown.
      // Then put the long-form fields into the one-item-per-line shape the
      // prompt asks for, since compliance with that varies run to run and the
      // fix belongs in one place rather than at each display and email site.
      analysis = tightenAnalysisProse(deepNoEmDash(data));
      // Every requirement needs a stable handle and a name a person can read.
      // A blank id would collide with every other blank id when confirmations
      // are matched; a blank title is not a requirement anybody can act on.
      analysis.compliance_matrix = (analysis.compliance_matrix ?? [])
        .filter((r) => r.title?.trim())
        .map((r, i) => ({
          ...r,
          id:
            r.id?.trim() ||
            r.title
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, "_")
              .replace(/^_+|_+$/g, "")
              .slice(0, 40) ||
            `requirement_${i + 1}`,
        }));
      await logAgent({
        agent: "solicitation-analyst",
        action: "analyze",
        opportunityId,
        message: `analyzed solicitation (past-perf: ${data.past_perf_classification})`,
        reasoning: data.scope_plain_language,
        claudeUsage: usage,
      });
    } catch (err) {
      if (err instanceof ClaudeNotConfiguredError) {
        await logAgent({
          agent: "solicitation-analyst",
          action: "analyze",
          opportunityId,
          level: "warn",
          status: "skipped",
          message: "Claude not configured, solicitation analysis skipped; flagged for human review.",
        });
        await query(
          `update opportunities
             set human_action_required = true,
                 risk_flags = (
                   select array(select distinct unnest(coalesce(risk_flags,'{}') || array['analysis_needs_claude']))
                 )
           where id = $1`,
          [opportunityId]
        );
        return {
          ok: true,
          summary: "Solicitation analysis skipped (Claude disabled), flagged for human review.",
          humanActionRequired: true,
        };
      }
      throw err;
    }

    // Persist analysis + past-perf + merge risk flags.
    const isPrimeOnly = analysis.past_perf_classification === "prime_only";
    // Operator preference: by default we do NOT stop for prime-only past
    // performance, auto-pursue proceeds and a human still reviews before submit.
    // Set decision_thresholds.block_prime_only = true to restore the hard block.
    const blockPrimeOnly = profile.decision_thresholds.block_prime_only === true;
    const blockedPrime = isPrimeOnly && blockPrimeOnly;

    const storedDocs = await queryOne<{ n: string }>(
      `select count(*)::text as n from documents
        where opportunity_id = $1 and kind in ('solicitation','sow')`,
      [opportunityId]
    ).catch(() => ({ n: "0" }));

    const completeness = evaluateSolicitationCompleteness({
      solicitationNumber: opp.solicitation_number,
      agency: opp.agency,
      deadline: opp.deadline,
      locationState: opp.location_state,
      locationText: opp.location_text,
      naicsCode: opp.naics_code,
      setAsideType: opp.set_aside_type,
      valueEstimated: opp.value_estimated,
      description: opp.description,
      storedDocumentCount: Number(storedDocs?.n ?? 0),
      attachmentOutcomes,
      analysis,
    });
    analysis.completeness = {
      ok: completeness.ok,
      missing: completeness.missing.map((m) => ({
        key: m.key,
        what: m.what,
        why: m.why,
        retrievable: m.retrievable,
        resolution: m.resolution,
        critical: m.critical,
        action: m.action,
      })),
      attachment_outcomes: completeness.attachmentOutcomes,
      evaluated_at: new Date().toISOString(),
    };

    const mergedRiskFlags = [
      ...new Set([
        ...(opp.risk_flags ?? []),
        ...analysis.risk_flags,
        ...completeness.riskFlags,
      ]),
    ];
    if (isPrimeOnly && !mergedRiskFlags.includes("prime_only")) mergedRiskFlags.push("prime_only");
    if (blockedPrime && !mergedRiskFlags.includes("prime_only_blocked")) {
      mergedRiskFlags.push("prime_only_blocked");
    }
    if (!completeness.ok && !mergedRiskFlags.includes("incomplete_solicitation")) {
      mergedRiskFlags.push("incomplete_solicitation");
    }

    const enqueued: AgentResult["enqueued"] = [];
    let stage = opp.stage;
    let humanAction = opp.human_action_required;
    const blockedIncomplete = !completeness.ok;

    if (blockedPrime || blockedIncomplete) {
      // Stay in analysis until prime-only (opt-in) or completeness is resolved.
      stage = "analysis";
      humanAction = true;
      await logAgent({
        agent: "solicitation-analyst",
        action: "gate",
        opportunityId,
        level: "warn",
        message: blockedPrime
          ? "Prime-only past performance blocked progression (operator preference)."
          : `Solicitation incomplete (${completeness.missing
              .filter((m) => m.critical)
              .map((m) => m.key)
              .join(", ")}); held in analysis until resolved.`,
      });
    } else {
      stage = "sub_research";
      enqueued.push({ agent: "sub-finder", payload: { opportunityId } });
    }

    /**
     * A re-analysis that changed the requirements must rebuild the package.
     *
     * This agent rewrites the compliance matrix on the OPPORTUNITY. Nothing
     * rebuilt the bid, so after an amendment the assembled package, its
     * manifest and its validation stayed frozen at the pre-amendment
     * requirements and kept reading as ready to submit. The submit gate now
     * refuses a package whose requirements have moved; this is what clears
     * that state without the operator having to know to press anything.
     */
    const existingBid = await queryOne<{
      id: string;
      requirements_fingerprint: string | null;
    }>(
      `select id, requirements_fingerprint from bids
        where opportunity_id=$1 order by created_at desc limit 1`,
      [opportunityId]
    );
    if (existingBid) {
      const nowPrint = requirementsFingerprint(
        analysis.compliance_matrix ?? [],
        analysis.qa_addenda ?? []
      );
      if (existingBid.requirements_fingerprint !== nowPrint) {
        enqueued.push({ agent: "bid-builder", payload: { opportunityId } });
        await logAgent({
          agent: "solicitation-analyst",
          action: "requirements-changed",
          opportunityId,
          bidId: existingBid.id,
          level: "warn",
          message:
            "The submission requirements changed for this solicitation, so the assembled bid package no longer matches them. Rebuilding the package.",
        });
      }
    }

    // Persist the parsed solicitation text (capped) so the independent
    // compliance auditor can re-read it later without re-downloading.
    const solicitationText = [
      `TITLE: ${opp.title ?? ""}`,
      `AGENCY: ${opp.agency ?? ""}`,
      `SOLICITATION: ${opp.solicitation_number ?? ""}`,
      "",
      "DESCRIPTION:",
      opp.description ?? "",
      "",
      "ATTACHMENT TEXT:",
      attachmentContext,
    ]
      .join("\n")
      .slice(0, 120_000);

    // Deepest-pass value backfill: this agent has now read the FULL
    // solicitation text plus every extractable attachment (PWS/SOW/IGCE),
    // far more than the title/description scoring saw. If nothing upstream
    // ever found a value, take one more shot from Claude's own read before
    // giving up on this opportunity ever getting a number.
    let valueUpdate = "";
    const valueParams: unknown[] = [];
    if (opp.value_estimated == null) {
      const fromAnalysis = extractValueFromText(analysis.estimated_value);
      if (fromAnalysis != null) {
        valueUpdate = ", value_estimated = $9, value_estimated_source = 'analysis'";
        valueParams.push(fromAnalysis);
      }
    }

    await query(
      `update opportunities
         set solicitation_analysis = $2,
             past_perf_classification = $3,
             risk_flags = $4,
             stage = $5,
             human_action_required = $6,
             solicitation_text = $7,
             -- What this analysis was computed from, so the next forced run
             -- can tell an amendment from a repeated button press.
             analysis_input_hash = $8
             ${valueUpdate}
       where id = $1`,
      [
        opportunityId,
        JSON.stringify(analysis),
        analysis.past_perf_classification,
        mergedRiskFlags,
        stage,
        humanAction,
        solicitationText,
        currentInputHash,
        ...valueParams,
      ]
    );

    if (blockedPrime) {
      return {
        ok: true,
        summary:
          "Past performance is prime-only, BLOCKED and flagged for human review (block_prime_only is on). No downstream work triggered.",
        reasoning: analysis.scope_plain_language,
        data: {
          past_perf_classification: analysis.past_perf_classification,
          required_trades: analysis.required_trades,
          risk_flags: mergedRiskFlags,
          completeness: analysis.completeness,
        },
        humanActionRequired: true,
      };
    }

    if (blockedIncomplete) {
      const critical = completeness.missing.filter((m) => m.critical).map((m) => m.what);
      return {
        ok: true,
        summary: `Solicitation analyzed but held in analysis: missing ${critical.join(", ") || "required information"}. Resolve the gaps, then re-run Solicitation Analyst.`,
        reasoning: analysis.scope_plain_language,
        data: {
          past_perf_classification: analysis.past_perf_classification,
          required_trades: analysis.required_trades,
          risk_flags: mergedRiskFlags,
          completeness: analysis.completeness,
        },
        humanActionRequired: true,
      };
    }

    return {
      ok: true,
      summary: `Solicitation analyzed (past-perf: ${analysis.past_perf_classification}${
        isPrimeOnly ? ", prime-only, flagged but auto-pursuing" : ""
      }); advanced to sub research.`,
      reasoning: analysis.scope_plain_language,
      data: {
        past_perf_classification: analysis.past_perf_classification,
        required_trades: analysis.required_trades,
        submission_requirements: analysis.submission_requirements,
        completeness: analysis.completeness,
      },
      enqueued,
    };
  },
};
