/**
 * Human-readable labels for the internal risk-flag keys stored on an opportunity
 * (scoring exclusions, review flags, pipeline-health flags). Keeps the UI from
 * showing raw snake_case like "naics_not_in_active_list" and from dumping a long
 * comma-joined wall of them.
 */
const OVERRIDES: Record<string, string> = {
  naics_not_in_active_list: "NAICS not in your list",
  no_bonding_insurance_details: "No bonding/insurance details",
  insufficient_data_to_score: "Not enough info to score",
  out_of_service_area: "Outside your service area",
  value_over_max: "Value over your ceiling",
  value_exceeds_ceiling: "Value over your ceiling",
  value_above_target_range: "Value above target range",
  unrestricted_under_threshold: "Open bid under threshold",
  value_below_min: "Value below minimum",
  possible_wage_determination_required: "Wage determination likely",
  possible_bonding_requirement: "Bonding may be required",
  prime_only: "Prime-only past performance",
  deadline_too_soon: "Deadline too soon",
  security_clearance: "Security clearance required",
  licensed_professional: "Licensed professional required",
  ineligible_set_aside: "Set-aside you don't qualify for",
  incomplete_scoring: "Needs a human to finish scoring",
  qa_failures: "QA checks failing",
  package_incomplete: "Submission package incomplete",
};

/** One flag key → a short, plain-English label. */
export function flagLabel(key: string): string {
  if (OVERRIDES[key]) return OVERRIDES[key];
  const s = key.replace(/_/g, " ").trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * A compact, readable summary of a flag list: the first `max` labels, then
 * "+N more" so a heavily-flagged opportunity doesn't become an unreadable wall.
 */
export function flagSummary(keys: string[], max = 3): string {
  const labels = keys.map(flagLabel);
  if (labels.length <= max) return labels.join(" · ");
  return `${labels.slice(0, max).join(" · ")} · +${labels.length - max} more`;
}
