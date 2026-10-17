/**
 * A finished 50-69 score whose pursue-or-pass was never stored.
 *
 * The decision normally happens inside the scoring write. A provider hold
 * makes that call return nothing, and the score is saved anyway. Later
 * sweeps only reload rows whose score is still null, so the decision is
 * never tried again. This says which of those rows may be decided once,
 * and what that decision writes. It does not call a model.
 */

import { eligibleForBandDecision } from "./band-decision";

export const BAND_BLOCKING_FLAGS = [
  "incomplete_scoring",
  "value_over_max",
  "out_of_service_area",
  "missing_deadline",
  "below_min_lead_time",
  "possible_duplicate",
] as const;

const OPEN_STAGES = new Set(["monitoring", "scoring", "analysis"]);
const PAST_SOURCING = new Set([
  "sub_research",
  "outreach",
  "call_queue",
  "quote_entry",
  "bid_building",
  "review_submit",
  "submitted",
  "won",
  "lost",
]);

export interface BandBackfillInput {
  score: number | null;
  tier: string | null;
  status: string | null;
  stage: string;
  bandDecision: string | null;
  riskFlags: readonly string[];
  hardExclusions: readonly string[];
  autonomous: boolean;
  pursuitActive: boolean;
  thresholds: { pursue_min_score: number; review_min_score: number };
}

/** `decide` is the only result that may call the model. */
export function bandBackfillSkip(input: BandBackfillInput): "decide" | "skip" {
  if (!input.autonomous || !input.pursuitActive) return "skip";
  if (input.status !== "open" || input.tier !== "review" || input.bandDecision) return "skip";
  if (!OPEN_STAGES.has(input.stage)) return "skip";
  if (input.score == null || !eligibleForBandDecision(input.score, input.thresholds)) return "skip";
  if (input.hardExclusions.length > 0) return "skip";
  if (input.riskFlags.some((flag) => (BAND_BLOCKING_FLAGS as readonly string[]).includes(flag))) {
    return "skip";
  }
  return "decide";
}

export interface BandBackfillWrite {
  tier: "pursue" | "dismiss";
  stage: string;
  status: "open" | "archived";
  humanAction: boolean;
  /** Pricing and sub discovery. False when that work already started, or on a pass. */
  enqueueSourcing: boolean;
  enqueuePricingOnly: boolean;
}

/**
 * Pursue starts sourcing unless this record is already past that step, or
 * the company performs the work itself. Pass archives the review item and
 * starts nothing.
 */
export function bandBackfillWrite(
  choice: "pursue" | "pass",
  stage: string,
  outreachAllowed: boolean
): BandBackfillWrite {
  if (choice === "pass") {
    return {
      tier: "dismiss",
      stage: "dismissed",
      status: "archived",
      humanAction: false,
      enqueueSourcing: false,
      enqueuePricingOnly: false,
    };
  }
  const past = PAST_SOURCING.has(stage);
  if (!outreachAllowed) {
    return {
      tier: "pursue",
      stage: past ? stage : "quote_entry",
      status: "open",
      humanAction: true,
      enqueueSourcing: false,
      enqueuePricingOnly: !past,
    };
  }
  return {
    tier: "pursue",
    stage: past ? stage : "sub_research",
    status: "open",
    humanAction: false,
    enqueueSourcing: !past,
    enqueuePricingOnly: false,
  };
}
