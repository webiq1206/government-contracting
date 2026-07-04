/**
 * SOLICITATION ANALYST — triggered when an opportunity reaches the pursue tier.
 * Reads the solicitation (description + attachment names/urls; best-effort fetch
 * of attachment text where trivially possible), then uses Claude to produce a
 * structured SolicitationAnalysis: plain-language scope, submission requirements,
 * evaluation criteria, required trades, geographic area, risk flags, a past-perf
 * classification, questions for subs, a draft SOW, and key dates.
 *
 * ROUTING: if past_perf_classification is "prime_only" we BLOCK — flag for human
 * review, keep the opportunity in 'analysis', add a "prime_only_blocked" risk
 * flag, and do NOT enqueue downstream work. Otherwise (not_required |
 * team_accepted) we advance the stage to 'sub_research' and trigger Sub Finder.
 */
import { z } from "zod";
import { query, queryOne } from "../db";
import { getProfileJson } from "../ai/companyProfile";
import { completeJson, ClaudeNotConfiguredError } from "../ai/claude";
import { logAgent } from "../logger";
import { storage } from "../integrations/storage";
import { extractPdfText, looksLikePdf } from "../integrations/pdf";
import type { AgentDefinition } from "./types";
import type {
  AgentResult,
  Opportunity,
  SolicitationAnalysis,
  Attachment,
} from "../types";

const AnalysisSchema = z.object({
  scope_plain_language: z.string(),
  submission_requirements: z.array(z.string()).default([]),
  evaluation_criteria: z.array(z.string()).default([]),
  required_trades: z.array(z.string()).default([]),
  geographic_area: z.string(),
  risk_flags: z.array(z.string()).default([]),
  past_perf_classification: z.enum(["not_required", "team_accepted", "prime_only"]),
  questions_for_subs: z.array(z.string()).default([]),
  draft_sow: z.string(),
  set_aside: z.string().nullable().default(null),
  key_dates: z
    .array(z.object({ label: z.string(), date: z.string() }))
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
): Promise<{ context: string; parsedChars: number }> {
  const label = att.name || `attachment-${index + 1}`;
  if (!att.url) return { context: `- ${label} (no url)`, parsedChars: 0 };
  try {
    const res = await fetch(att.url, { method: "GET" });
    if (!res.ok) {
      return { context: `- ${label} (${att.url}) — could not fetch (HTTP ${res.status})`, parsedChars: 0 };
    }
    const ct = (res.headers.get("content-type") ?? "").toLowerCase();
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength > MAX_ATTACH_BYTES) {
      return { context: `- ${label} — too large to parse (${Math.round(buf.byteLength / 1e6)}MB)`, parsedChars: 0 };
    }

    // Persist the raw file + a documents row (best-effort).
    const safeName = label.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 120);
    const key = `solicitations/${opportunityId}/${index + 1}_${safeName}`;
    let storagePath: string | null = null;
    try {
      const up = await storage.upload(key, buf, ct || "application/octet-stream");
      storagePath = up.path;
      await query(
        `insert into documents (opportunity_id, kind, name, storage_path, storage_backend, mime, meta)
         values ($1,'solicitation',$2,$3,$4,$5,$6)`,
        [opportunityId, label, up.path, up.backend, ct || null, JSON.stringify({ source_url: att.url })]
      );
    } catch {
      /* storage/documents are best-effort; continue with extraction */
    }

    if (looksLikePdf(att.url, ct)) {
      const { text, pages } = await extractPdfText(buf);
      if (text) {
        return {
          context: `- ${label} (${pages} pp, extracted):\n${text}`,
          parsedChars: text.length,
        };
      }
      return { context: `- ${label} — PDF stored but no extractable text (likely scanned/image-only).`, parsedChars: 0 };
    }
    if (ct.includes("text") || ct.includes("html") || ct.includes("json")) {
      const text = buf.toString("utf8").slice(0, 6000);
      return { context: `- ${label}:\n${text}`, parsedChars: text.length };
    }
    return { context: `- ${label} (${att.url}) — ${ct || "binary"} stored (not text-parseable)`, parsedChars: 0 };
  } catch (err) {
    return { context: `- ${label} (${att.url}) — processing failed (${(err as Error).message})`, parsedChars: 0 };
  }
}

function buildPrompt(opp: Opportunity, attachmentContext: string): string {
  return [
    "Analyze this government solicitation and produce a structured brief. Use the Company Profile (your system context) to judge what trades we need, our geographic fit, and — critically — how the past-performance requirement should be classified for us as a small-business prime that teams with subcontractors.",
    "",
    "OPPORTUNITY:",
    `Title: ${opp.title ?? "(none)"}`,
    `Agency: ${opp.agency ?? "(none)"}`,
    `Solicitation #: ${opp.solicitation_number ?? "(none)"}`,
    `NAICS: ${opp.naics_code ?? "(none)"}  Set-aside: ${opp.set_aside_type ?? "(none)"}`,
    `Estimated value: ${opp.value_estimated ?? "(unknown)"}`,
    `Location: ${opp.location_state ?? "(unknown)"}`,
    `Deadline: ${opp.deadline ?? "(unknown)"}`,
    "",
    "DESCRIPTION:",
    (opp.description ?? "(no description provided)").slice(0, 6000),
    "",
    "ATTACHMENTS (extracted text where available — PDFs are parsed; use this as primary source material):",
    (attachmentContext || "(none)").slice(0, 24000),
    "",
    "PAST-PERFORMANCE CLASSIFICATION — choose exactly one:",
    '- "not_required": the solicitation does not require past performance.',
    '- "team_accepted": past performance may be satisfied by the team, including subcontractor project history.',
    '- "prime_only": past performance must be the prime\'s own performance and cannot rely on subs. This BLOCKS us.',
    "",
    "Return JSON matching this shape exactly:",
    "{ scope_plain_language: string, submission_requirements: string[], evaluation_criteria: string[], required_trades: string[], geographic_area: string, risk_flags: string[], past_perf_classification: \"not_required\"|\"team_accepted\"|\"prime_only\", questions_for_subs: string[], draft_sow: string, set_aside: string|null, key_dates: [{label, date}] }",
    "draft_sow is a concise statement of work we can hand to subcontractors. questions_for_subs are the specific clarifying questions to ask each sub.",
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

    const profile = await getProfileJson();
    if (!profile) return { ok: false, summary: "no active Company Profile" };

    // Download, store, and extract text from solicitation attachments (PDFs parsed).
    const attachments: Attachment[] = Array.isArray(opp.attachments_json)
      ? opp.attachments_json
      : [];
    const processed = await Promise.all(
      attachments.slice(0, 8).map((att, i) => processAttachment(opportunityId, att, i))
    );
    const attachmentContext = processed.map((p) => p.context).join("\n\n");
    const parsedChars = processed.reduce((a, p) => a + p.parsedChars, 0);
    await logAgent({
      agent: "solicitation-analyst",
      action: "attachments",
      opportunityId,
      level: "info",
      message: `processed ${attachments.length} attachment(s), extracted ${parsedChars} chars of text`,
    });

    let analysis: SolicitationAnalysis;
    try {
      const { data, usage } = await completeJson(buildPrompt(opp, attachmentContext), {
        schema: AnalysisSchema,
        maxTokens: 2500,
      });
      analysis = data;
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
          message: "Claude not configured — solicitation analysis skipped; flagged for human review.",
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
          summary: "Solicitation analysis skipped (Claude disabled) — flagged for human review.",
          humanActionRequired: true,
        };
      }
      throw err;
    }

    // Persist analysis + past-perf + merge risk flags.
    const isPrimeOnly = analysis.past_perf_classification === "prime_only";
    // Operator preference: by default we do NOT stop for prime-only past
    // performance — auto-pursue proceeds and a human still reviews before submit.
    // Set decision_thresholds.block_prime_only = true to restore the hard block.
    const blockPrimeOnly = profile.decision_thresholds.block_prime_only === true;
    const blocked = isPrimeOnly && blockPrimeOnly;

    const mergedRiskFlags = [...new Set([...(opp.risk_flags ?? []), ...analysis.risk_flags])];
    if (isPrimeOnly && !mergedRiskFlags.includes("prime_only")) mergedRiskFlags.push("prime_only");
    if (blocked && !mergedRiskFlags.includes("prime_only_blocked")) {
      mergedRiskFlags.push("prime_only_blocked");
    }

    const enqueued: AgentResult["enqueued"] = [];
    let stage = opp.stage;
    let humanAction = opp.human_action_required;

    if (blocked) {
      // Hard block (only when the operator has opted in): stay in analysis, flag for human.
      stage = "analysis";
      humanAction = true;
    } else {
      // Auto-pursue proceeds — prime-only is flagged for visibility but not stopped.
      stage = "sub_research";
      enqueued.push({ agent: "sub-finder", payload: { opportunityId } });
    }

    await query(
      `update opportunities
         set solicitation_analysis = $2,
             past_perf_classification = $3,
             risk_flags = $4,
             stage = $5,
             human_action_required = $6
       where id = $1`,
      [
        opportunityId,
        JSON.stringify(analysis),
        analysis.past_perf_classification,
        mergedRiskFlags,
        stage,
        humanAction,
      ]
    );

    if (blocked) {
      return {
        ok: true,
        summary:
          "Past performance is prime-only — BLOCKED and flagged for human review (block_prime_only is on). No downstream work triggered.",
        reasoning: analysis.scope_plain_language,
        data: {
          past_perf_classification: analysis.past_perf_classification,
          required_trades: analysis.required_trades,
          risk_flags: mergedRiskFlags,
        },
        humanActionRequired: true,
      };
    }

    return {
      ok: true,
      summary: `Solicitation analyzed (past-perf: ${analysis.past_perf_classification}${
        isPrimeOnly ? ", prime-only — flagged but auto-pursuing" : ""
      }); advanced to sub research.`,
      reasoning: analysis.scope_plain_language,
      data: {
        past_perf_classification: analysis.past_perf_classification,
        required_trades: analysis.required_trades,
        submission_requirements: analysis.submission_requirements,
      },
      enqueued,
    };
  },
};
