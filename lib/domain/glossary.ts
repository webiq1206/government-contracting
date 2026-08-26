/**
 * Plain-English glossary for government-contracting and Brost Co terms.
 * Keep each tip short enough to scan in an InfoTip; teach just enough to
 * operate the page without leaving the product.
 */

export const GLOSSARY: Record<string, string> = {
  uei: "Unique Entity ID: your company’s official ID in SAM.gov. It goes on every federal bid and form.",
  cage: "Commercial and Government Entity code: a five-character ID used on DoD and many federal forms alongside your UEI.",
  naics:
    "North American Industry Classification System code: the industry code that decides which opportunities fit your company and which set-asides apply.",
  psc: "Product or Service Code: the government’s category for what is being bought (e.g. facilities support).",
  set_aside:
    "Who is allowed to bid, for example Small Business, 8(a), or unrestricted (anyone).",
  sources_sought:
    "Market research, not a live bid. Agencies ask who can do the work; responding builds relationships for later solicitations.",
  solicitation:
    "A live request for bids. If you win and sign, it becomes a contract.",
  score:
    "How well this opportunity fits your profile (0-100). Higher is better. Open the score breakdown for each factor.",
  tier_pursue:
    "High fit: the system auto-pursues these when automation is running.",
  tier_review:
    "Borderline fit: needs your judgment to pursue or pass.",
  tier_ignore: "Low fit: usually skipped unless you override.",
  place_of_performance:
    "Where the work must be done. Used to judge geographic fit and find local subcontractors.",
  past_performance:
    "Whether the agency wants proof that your company (not just your subcontractors) has done similar work before.",
  outreach_state:
    "Where outreach stands with this sub on this opportunity: emailed, followed up, replied, declined, etc.",
  contact_status:
    "How contactable this company is on your roster (verified email, no email found, etc.).",
  quote_entry:
    "Stage where subcontractor prices are collected so Bid Builder can price and assemble the package.",
  call_queue:
    "Stage where the system has prepared call cards so you can follow up by phone.",
  package_ready:
    "Whether every required submission file is present and the independent compliance check has passed.",
  follow_up_due:
    "A sub was contacted and has not replied within the follow-up window. They need another nudge or a call.",
  stage:
    "Where this opportunity sits in Brost Co’s pipeline, from discovery through submission and award.",
  overview:
    "The essentials: what the job is, when it is due, how it scored, and whether you should pursue it.",
  workflow:
    "Completed steps, the current step, who owns it (system vs you vs subs vs agency), and what happens next.",
  documents:
    "Solicitation files, generated bid package pieces, and anything still missing for submission.",
  activity:
    "One timeline of automation, emails, calls, and your decisions for this opportunity.",
  sub_coverage:
    "Per-trade view of who was found, contacted, quoted, and which scopes still block the bid.",
  pricing_comps:
    "Comparable past federal awards for this industry (and state when known). Brost Co inflation-adjusts them so you can see what similar jobs have typically paid.",
  cpi_adjusted:
    "Older award amounts are scaled to today’s dollars using the Consumer Price Index, so a 2022 win is not compared as if prices never changed.",
  comp_median:
    "The middle historical award after inflation adjustment. Half of comps were lower, half higher. Best single benchmark for a typical job.",
  comp_p25:
    "Low end of the typical band: 25% of comparable awards were at or below this amount.",
  comp_p75:
    "High end of the typical band: 75% of comparable awards were at or below this amount.",
};

export function termTip(key: string): string | undefined {
  return GLOSSARY[key];
}

/**
 * How each term is written when it is a heading rather than a tooltip.
 *
 * Spelled out rather than derived from the key, because deriving gives "Uei",
 * "Naics" and "Comp P25". An acronym that a solicitation writes in capitals
 * has to appear in capitals here, or the glossary is teaching the wrong word.
 */
const LABELS: Record<string, string> = {
  uei: "UEI",
  cage: "CAGE code",
  naics: "NAICS code",
  psc: "PSC",
  set_aside: "Set-aside",
  sources_sought: "Sources sought",
  solicitation: "Solicitation",
  score: "Fit score",
  tier_pursue: "Pursue tier",
  tier_review: "Review tier",
  tier_ignore: "Skipped tier",
  place_of_performance: "Place of performance",
  past_performance: "Past performance",
  outreach_state: "Outreach state",
  contact_status: "Contact status",
  quote_entry: "Quote entry",
  call_queue: "Call queue",
  package_ready: "Package ready",
  follow_up_due: "Follow-up due",
  stage: "Stage",
  overview: "Overview",
  workflow: "Workflow",
  documents: "Documents",
  activity: "Activity",
  sub_coverage: "Subcontractor coverage",
  pricing_comps: "Pricing comps",
  cpi_adjusted: "CPI adjusted",
  comp_median: "Comp median",
  comp_p25: "Comp 25th percentile",
  comp_p75: "Comp 75th percentile",
};

/**
 * The heading form of a term. Falls back to the key with underscores opened
 * out, which is wrong-looking on purpose: a term added to GLOSSARY without a
 * label should look unfinished rather than blend in.
 */
export function termLabel(key: string): string {
  return LABELS[key] ?? key.replace(/_/g, " ");
}
