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

/**
 * Best-effort attachment text. We do NOT parse PDFs — for PDF/binary links we
 * simply note the attachment; for small text-like responses we capture a snippet
 * to feed Claude as extra context. Any failure degrades to a note.
 */
async function fetchAttachmentContext(att: Attachment): Promise<string> {
  const label = att.name || "attachment";
  if (!att.url) return `- ${label} (no url)`;
  try {
    const res = await fetch(att.url, { method: "GET" });
    const ct = (res.headers.get("content-type") ?? "").toLowerCase();
    if (!res.ok) return `- ${label} (${att.url}) — could not fetch (HTTP ${res.status})`;
    if (ct.includes("pdf") || ct.includes("octet-stream") || ct.includes("word") || ct.includes("zip")) {
      return `- ${label} (${att.url}) — binary/PDF document (not parsed; note its presence in requirements)`;
    }
    if (ct.includes("text") || ct.includes("html") || ct.includes("json")) {
      const text = await res.text();
      return `- ${label} (${att.url}):\n${text.slice(0, 4000)}`;
    }
    return `- ${label} (${att.url}) — content-type ${ct || "unknown"} (not parsed)`;
  } catch (err) {
    return `- ${label} (${att.url}) — fetch failed (${(err as Error).message})`;
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
    "ATTACHMENTS (names/urls; binary docs are not parsed — reason from names + description):",
    attachmentContext || "(none)",
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

    // Gather best-effort attachment context.
    const attachments: Attachment[] = Array.isArray(opp.attachments_json)
      ? opp.attachments_json
      : [];
    const attachmentContext = (
      await Promise.all(attachments.slice(0, 8).map(fetchAttachmentContext))
    ).join("\n");

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
    const mergedRiskFlags = [...new Set([...(opp.risk_flags ?? []), ...analysis.risk_flags])];
    if (isPrimeOnly && !mergedRiskFlags.includes("prime_only_blocked")) {
      mergedRiskFlags.push("prime_only_blocked");
    }

    const enqueued: AgentResult["enqueued"] = [];
    let stage = opp.stage;
    let humanAction = opp.human_action_required;

    if (isPrimeOnly) {
      // BLOCK: stay in analysis, flag for human, no downstream enqueue.
      stage = "analysis";
      humanAction = true;
    } else {
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

    if (isPrimeOnly) {
      return {
        ok: true,
        summary:
          "Past performance is prime-only — BLOCKED and flagged for human review. No downstream work triggered.",
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
      summary: `Solicitation analyzed (past-perf: ${analysis.past_perf_classification}); advanced to sub research.`,
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
