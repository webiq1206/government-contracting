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
import { tightenAnalysisProse } from "../domain/analysis-prose";
import { logAgent } from "../logger";
import { deepNoEmDash } from "../sanitize";
import { extractValueFromText } from "../domain/value-extract";
import {
  evaluateSolicitationCompleteness,
  type AttachmentFetchOutcome,
} from "../domain/solicitation-completeness";
import { storage } from "../integrations/storage";
import { extractPdfText, looksLikePdf, looksLikePdfBytes } from "../integrations/pdf";
import { normalizeAttachmentMeta } from "../domain/attachment-meta";
import type { AgentDefinition } from "./types";
import type {
  AgentResult,
  Opportunity,
  SolicitationAnalysis,
  Attachment,
} from "../types";

/** Soft cap: prefer collecting the full linked packet when SAM provides many URLs. */
const MAX_ATTACHMENT_URLS = 40;

const NA = "Not specified in the provided documents";

const AnalysisSchema = z.object({
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
  past_perf_classification: z.enum(["not_required", "team_accepted", "prime_only"]),
  questions_for_subs: z.array(z.string()).default([]),
  draft_sow: z.string().default(""),
  set_aside: z.string().nullable().default(null),
  compliance_matrix: z
    .array(
      z.object({
        id: z.string(),
        title: z.string(),
        category: z
          .enum([
            "form",
            "pricing",
            "narrative",
            "certification",
            "acknowledgment",
            "attachment",
            "other",
          ])
          .default("other"),
        mandatory: z.boolean().default(true),
        source: z.string().default(NA),
        format: z.string().optional(),
        signature_required: z.boolean().default(false),
        satisfied_by: z
          .enum(["auto_generated", "from_profile", "operator_signature", "operator_provided"])
          .default("operator_provided"),
        instructions: z.string().optional(),
        official_form: z.string().optional(),
      })
    )
    .default([]),
});

const MAX_ATTACH_BYTES = 25 * 1024 * 1024; // 25MB cap per file

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
  const label = att.name || `attachment-${index + 1}`;
  if (!att.url) {
    return {
      context: `- ${label} (no url)`,
      parsedChars: 0,
      outcome: { name: label, url: null, status: "no_url", detail: "No download URL on the notice" },
    };
  }
  try {
    const res = await fetch(att.url, { method: "GET" });
    if (!res.ok) {
      return {
        context: `- ${label} (${att.url}), could not fetch (HTTP ${res.status})`,
        parsedChars: 0,
        outcome: {
          name: label,
          url: att.url,
          status: "failed",
          detail: `HTTP ${res.status}`,
        },
      };
    }
    const ct = (res.headers.get("content-type") ?? "").toLowerCase();
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength > MAX_ATTACH_BYTES) {
      return {
        context: `- ${label}, too large to parse (${Math.round(buf.byteLength / 1e6)}MB)`,
        parsedChars: 0,
        outcome: {
          name: label,
          url: att.url,
          status: "too_large",
          detail: `${Math.round(buf.byteLength / 1e6)}MB`,
        },
      };
    }

    // Persist the raw file + a documents row (best-effort).
    // Sniff bytes so SAM's generic "attachment" / octet-stream metadata does not
    // break email openability later (clients and Resend key off name + MIME).
    const meta = normalizeAttachmentMeta({
      filename: label,
      mime: ct || null,
      content: buf,
    });
    // Keep the storage key stable across re-runs (do not bake corrected
    // extensions into the path). Openability comes from documents.name/mime
    // and send-time normalization, plus Content-Type on /api/files.
    const safeKeyStem = label.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 120) || "attachment";
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
    } catch {
      /* storage/documents are best-effort; continue with extraction */
    }

    // Trust the actual bytes over SAM's (usually generic/wrong) headers.
    if (looksLikePdf(att.url, ct) || looksLikePdfBytes(buf)) {
      const { text, pages } = await extractPdfText(buf);
      if (text) {
        return {
          context: `- ${label} (${pages} pp, extracted):\n${text}`,
          parsedChars: text.length,
          outcome: {
            name: label,
            url: att.url,
            status: stored ? "fetched" : "fetched",
            detail: `${pages} pages`,
          },
        };
      }
      return {
        context: `- ${label}, PDF stored but no extractable text (likely scanned/image-only).`,
        parsedChars: 0,
        outcome: {
          name: label,
          url: att.url,
          status: stored ? "no_text" : "failed",
          detail: "PDF had no extractable text",
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
    return {
      context: `- ${label} (${att.url}), ${ct || "binary"} stored (not text-parseable)`,
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
      context: `- ${label} (${att.url}), processing failed (${(err as Error).message})`,
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
    (opp.description ?? "(no description provided)").slice(0, 8000),
    "",
    "ATTACHMENT TEXT (parsed from the actual bid documents, PRIMARY SOURCE, prefer this over the portal summary):",
    (attachmentContext || "(no attachment text extracted)").slice(0, 60000),
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
    '  "trade_scopes": [{ "trade": string, "work": string }],  // REQUIRED for each required_trades entry. `work` is what THAT trade does on THIS job: 2-4 short lines, newline separated, one task each, naming locations, materials and quantities where the documents give them. It is read aloud to a subcontractor who has never seen the solicitation, so no jargon, no form numbers, no contracting-officer contact info.',
    '  "geographic_area": string,                // area to source subs from',
    '  "risk_flags": string[],                   // short machine-ish flags, e.g. "liquidated_damages", "high_bonding"',
    '  "past_perf_classification": "not_required"|"team_accepted"|"prime_only",',
    '  "questions_for_subs": string[],           // AT MOST 4, and only things specific to THIS job. The call form already captures, with its own field, whether they can do the work, whether they are interested, their price, firm or estimate, start date, availability, insurance, bonding, licenses, certifications and past projects. Never ask any of those. Each question under 12 words, phrased to be said out loud.',
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
    "If the documents do not enumerate submission contents, infer the standard mandatory items for this vehicle (e.g. a signed offer form, a completed pricing schedule, reps & certifications, and acknowledgment of any amendments) and mark their source \"Standard requirement for this solicitation type\".",
    "IMPORTANT, official forms: whenever the solicitation requires a SPECIFIC government or agency form or fillable worksheet (any Standard Form like SF-1449/SF-33/SF-18/SF-1442, an agency-provided pricing/bid schedule, a portal-only form), set `official_form` to that exact identifier. These cannot be substituted with a generic document, so be precise. Also capture format constraints (page limits, font/size, number of copies, required file types, submission portal) in `format` and in `submission_requirements`.",
  ].join("\n");
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
    if (
      opp.solicitation_analysis &&
      ctx.trigger === "queue" &&
      ctx.payload.force !== true
    ) {
      return {
        ok: true,
        summary: `Opportunity ${opportunityId} already analyzed; skipped duplicate run.`,
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
    const processed = await Promise.all(
      attachments
        .slice(0, MAX_ATTACHMENT_URLS)
        .map((att, i) => processAttachment(opportunityId, att, i))
    );
    const attachmentContext = processed.map((p) => p.context).join("\n\n");
    const parsedChars = processed.reduce((a, p) => a + p.parsedChars, 0);
    const attachmentOutcomes = processed.map((p) => p.outcome);
    await logAgent({
      agent: "solicitation-analyst",
      action: "attachments",
      opportunityId,
      level: "info",
      message: `processed ${attachments.length} attachment(s) (cap ${MAX_ATTACHMENT_URLS}), extracted ${parsedChars} chars of text; outcomes: ${attachmentOutcomes.map((o) => `${o.name}:${o.status}`).join(", ") || "none"}`,
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
        valueUpdate = ", value_estimated = $8, value_estimated_source = 'analysis'";
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
             solicitation_text = $7
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
