/**
 * An opportunity, read as the case for deciding it.
 *
 * The glue between a stored opportunity and `buildReviewBrief`: which fields
 * the brief reads, where the confidence lives, and how a conflict between the
 * notice and the document is spotted. It was written inline on the Review page
 * and is now needed by the workbench too, and two copies of "the confidence is
 * on the score breakdown, not the analysis" is one copy too many: the second
 * one goes stale silently and the brief quietly starts reading a different
 * record.
 */
import { buildReviewBrief, type ReviewBrief } from "./domain/review-brief";
import { conflictingFacts } from "./domain/brief-conflicts";
import type { DataConfidence } from "./domain/score-confidence";
import type { Opportunity, SolicitationAnalysis } from "./types";

/** ISO or null, never a Date pretending to be a string. */
function iso(v: unknown): string | null {
  if (v == null) return null;
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * Where to read the original.
 *
 * A decision made on a reading should be one click from the document. Only
 * links that exist: a notice with no stored URL gets no button rather than a
 * dead one.
 */
export function sourceLinksFor(o: Opportunity): { label: string; href: string }[] {
  const raw = (o.raw_json ?? {}) as Record<string, unknown>;
  const url = typeof raw.uiLink === "string" ? raw.uiLink : null;
  return url ? [{ label: "The notice on SAM.gov", href: url }] : [];
}

export function briefFor(o: Opportunity): ReviewBrief {
  const analysis = o.solicitation_analysis as SolicitationAnalysis | null;
  return buildReviewBrief({
    score: o.score ?? null,
    dimensions: o.score_breakdown?.dimensions ?? [],
    riskFlags: o.risk_flags ?? [],
    /*
     * On the score breakdown, not on the analysis. It describes how much of
     * the notice could be read at scoring time, which is a property of the
     * scoring rather than of the solicitation.
     */
    confidence: (o.score_breakdown?.data_confidence as DataConfidence | undefined) ?? null,
    deadline: iso(o.deadline),
    reviewExpiresAt: iso(o.review_expires_at),
    requiredTradeCount: analysis?.required_trades?.length ?? null,
    valueKnown: o.value_estimated != null,
    pastPerfClassification: o.past_perf_classification ?? null,
    value: o.value_estimated ?? null,
    valueSource: o.value_estimated_source ?? null,
    /*
     * Where the notice and the document do not agree. Reported rather than
     * resolved: the analyst's value backfill only fills a null, so a portal
     * figure and a document figure that disagree both survive in the record.
     */
    conflicts: conflictingFacts({
      setAsideFromNotice: o.set_aside_type,
      setAsideFromDocument: analysis?.set_aside ?? null,
      valueFromNotice: o.value_estimated ?? null,
      valueTextFromDocument: analysis?.estimated_value ?? null,
    }),
    sourceLinks: sourceLinksFor(o),
  });
}

/** The line under the title: agency, state, set-aside, as far as each is known. */
export function briefSubtitle(o: Opportunity): string {
  return [o.agency, o.location_state, o.set_aside_type].filter(Boolean).join(" · ");
}
