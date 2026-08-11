/**
 * Plain-English glossary for government-contracting and Brost Co terms.
 * Keep each tip short enough to scan in an InfoTip; teach just enough to
 * operate the page without leaving the product.
 */

export const GLOSSARY: Record<string, string> = {
  uei: "Unique Entity ID — your company’s official ID in SAM.gov. It goes on every federal bid and form.",
  cage: "Commercial and Government Entity code — a five-character ID used on DoD and many federal forms alongside your UEI.",
  naics:
    "North American Industry Classification System code — the industry code that decides which opportunities fit your company and which set-asides apply.",
  psc: "Product or Service Code — the government’s category for what is being bought (e.g. facilities support).",
  set_aside:
    "Who is allowed to bid — for example Small Business, 8(a), or unrestricted (anyone).",
  sources_sought:
    "Market research, not a live bid. Agencies ask who can do the work; responding builds relationships for later solicitations.",
  solicitation:
    "A live request for bids. If you win and sign, it becomes a contract.",
  score:
    "How well this opportunity fits your profile (0–100). Higher is better. Open the score breakdown for each factor.",
  tier_pursue:
    "High fit — the system auto-pursues these when automation is running.",
  tier_review:
    "Borderline fit — needs your judgment to pursue or pass.",
  tier_ignore:
    "Low fit — usually skipped unless you override.",
  place_of_performance:
    "Where the work must be done. Used to judge geographic fit and find local subcontractors.",
  past_performance:
    "Whether the agency wants proof that your company (not just your subcontractors) has done similar work before.",
  outreach_state:
    "Where outreach stands with this sub on this opportunity — emailed, followed up, replied, declined, etc.",
  contact_status:
    "How contactable this company is on your roster (verified email, no email found, etc.).",
  quote_entry:
    "Stage where subcontractor prices are collected so Bid Builder can price and assemble the package.",
  call_queue:
    "Stage where the system has prepared call cards so you can follow up by phone.",
  package_ready:
    "Whether every required submission file is present and the independent compliance check has passed.",
  follow_up_due:
    "A sub was contacted and has not replied within the follow-up window — they need another nudge or a call.",
};

export function termTip(key: string): string | undefined {
  return GLOSSARY[key];
}
