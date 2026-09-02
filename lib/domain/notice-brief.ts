/**
 * A readable Bid Brief from the notice and the score, used whenever the
 * solicitation analyst has not written a model brief yet.
 *
 * Most opportunities never auto-pursue. The analyst used to run only on that
 * path, so Overview showed "has not run yet" on every review and dismissed
 * record even when the score already knew what the job was. This is the
 * fallback that fills that box from facts we already have. It is never
 * persisted as solicitation_analysis: that column is the model brief, and
 * writing a stub there would skip the real read and burn the trial quota.
 *
 * Pure.
 */

import { currency } from "../format";
import type { Opportunity, ScoreBreakdown, SolicitationAnalysis } from "../types";

const NA = "Not specified in the provided documents";
const MAX_SCOPE_CHARS = 4_000;

export function isNoticeOnlyBrief(
  analysis: SolicitationAnalysis | null | undefined
): boolean {
  return analysis?.brief_source === "notice";
}

/** Strip the markup SAM sometimes leaves in a description field. */
export function noticePlainText(raw: string): string {
  return raw
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function firstSentences(text: string, max = 2): string {
  const parts = text.split(/(?<=[.!?])\s+/).filter(Boolean);
  if (parts.length === 0) return "";
  return parts.slice(0, max).join(" ");
}

function scopeLines(text: string): string {
  const sentences = text.split(/(?<=[.!?])\s+/).filter(Boolean);
  if (sentences.length === 0) return "The notice does not include a work description.";
  const joined = sentences.join("\n");
  return joined.length > MAX_SCOPE_CHARS ? `${joined.slice(0, MAX_SCOPE_CHARS).trimEnd()}…` : joined;
}

export function buildNoticeBrief(input: {
  title?: string | null;
  agency?: string | null;
  description?: string | null;
  locationText?: string | null;
  locationState?: string | null;
  valueEstimated?: number | null;
  deadline?: string | null;
  setAside?: string | null;
  score?: number | null;
  scoreSummary?: string | null;
}): SolicitationAnalysis {
  const desc = noticePlainText(input.description ?? "");
  const location =
    [input.locationText, input.locationState].filter(Boolean).join(", ") || NA;
  const fromTitle = [input.title, input.agency ? `for ${input.agency}` : null]
    .filter(Boolean)
    .join(" ");
  const overview = desc ? firstSentences(desc, 2) : fromTitle || "This notice has not been summarized yet.";

  return {
    brief_source: "notice",
    title: input.title ?? undefined,
    project_overview: overview,
    scope_plain_language: desc ? scopeLines(desc) : "The notice does not include a work description.",
    location,
    estimated_value: input.valueEstimated != null ? currency(input.valueEstimated) : NA,
    due_date: input.deadline ?? NA,
    qualifications: {},
    prebid_meeting: null,
    site_visit: null,
    submission_method: NA,
    period_of_performance: NA,
    offer_acceptance_period: NA,
    bid_schedule: [],
    submission_requirements: [],
    evaluation_criteria: [],
    required_forms: [],
    key_dates: input.deadline ? [{ label: "Response deadline", date: input.deadline }] : [],
    contacts: [],
    qa_addenda: [],
    special_requirements: [],
    attention_items: [],
    pursue_recommendation:
      input.scoreSummary?.trim() ||
      (input.score != null ? `This opportunity scores ${input.score} points.` : "") ||
      "Score this opportunity to see whether it is a fit.",
    required_trades: [],
    trade_scopes: [],
    geographic_area: location,
    risk_flags: [],
    past_perf_classification: "not_required",
    questions_for_subs: [],
    draft_sow: "",
    set_aside: input.setAside ?? null,
    compliance_matrix: [],
    completeness: {
      ok: false,
      missing: [
        {
          key: "model_read",
          what: "Full document read",
          why: "This brief was written from the notice and the score. The solicitation documents have not been read yet.",
          retrievable: "auto",
          resolution:
            "The analyst replaces this with a full brief once the document read finishes.",
          critical: false,
        },
      ],
      evaluated_at: new Date().toISOString(),
    },
  };
}

/** The page-level fallback: notice plus whatever scoring already wrote. */
export function noticeBriefFromOpportunity(
  opp: Pick<
    Opportunity,
    | "title"
    | "agency"
    | "description"
    | "location_text"
    | "location_state"
    | "value_estimated"
    | "deadline"
    | "set_aside_type"
    | "score"
  >,
  breakdown?: ScoreBreakdown | null
): SolicitationAnalysis {
  return buildNoticeBrief({
    title: opp.title,
    agency: opp.agency,
    description: opp.description,
    locationText: opp.location_text,
    locationState: opp.location_state,
    valueEstimated: opp.value_estimated,
    deadline: opp.deadline,
    setAside: opp.set_aside_type,
    score: opp.score,
    scoreSummary: breakdown?.summary ?? null,
  });
}
