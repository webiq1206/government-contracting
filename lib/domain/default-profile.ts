/**
 * The company profile a brand-new organization starts with.
 *
 * Signup used to insert a profile containing only the eight fields the setup
 * checklist asks about. Everything else in the platform assumes a complete
 * profile: the Company Profile page reads `decision_thresholds.pursue_min_score`,
 * the scoring engine maps over `hard_exclusions` and `scoring_rubric.dimensions`,
 * quote entry reads `pricing_rules.out_of_range_tolerance_pct`, and the bid
 * builder reads `decision_thresholds.submit_lead_hours`.
 *
 * The result was that every new customer's Company Profile page crashed on
 * load, and would have taken scoring down with it the moment an opportunity
 * arrived. It went unnoticed because the founding organization's profile was
 * seeded complete by a migration years before self-serve signup existed.
 *
 * So the defaults live here, in one typed factory, rather than as a JSON
 * literal inside an insert statement. The values are the operating defaults a
 * small federal subcontractor can work with on day one, and every one of them
 * is editable from Settings once they are in.
 */
import type { CompanyProfileJson } from "../types";

/**
 * The 100-point rubric every opportunity is scored against.
 *
 * Weighted toward the things that decide whether a small firm can actually
 * win: does the work match their codes, is the contract inside the
 * simplified-acquisition band they can bond, and is past performance required
 * at the prime level (the usual disqualifier for a newcomer).
 */
const DEFAULT_RUBRIC: CompanyProfileJson["scoring_rubric"] = {
  total_points: 100,
  dimensions: [
    {
      key: "naics_active",
      label: "NAICS code in active list",
      guidance:
        "Full points when the opportunity's primary NAICS is one you have listed. Zero when it is on your excluded list; adjacent codes score partial.",
      max_points: 20,
    },
    {
      key: "sb_setaside_match",
      label: "Small business set-aside match",
      guidance:
        "Full for Total or Partial Small Business set-asides. Reduced for unrestricted competition. Zero when it requires a certification you do not hold.",
      max_points: 15,
    },
    {
      key: "value_in_band",
      label: "Contract value inside your band",
      guidance:
        "Full inside the value range in your decision thresholds. Zero below the minimum; above the maximum scores partial until you have won a few.",
      max_points: 15,
    },
    {
      key: "multiyear_idiq",
      label: "Multi-year or IDIQ vehicle",
      guidance:
        "Full for multi-year or IDIQ contracts. Recurring revenue outranks a larger one-time award.",
      max_points: 15,
    },
    {
      key: "pp_not_required",
      label: "Past performance not required at prime level",
      guidance:
        "Full when past performance is not required, or when subcontractor and team experience is accepted. Zero when prime-only experience is demanded.",
      max_points: 10,
    },
    {
      key: "pricing_comps",
      label: "Historical pricing comparables available",
      guidance:
        "Full when USASpending has comparable awards in the same NAICS and state to anchor your price.",
      max_points: 10,
    },
    {
      key: "sub_findability",
      label: "Subcontractors findable in the area",
      guidance:
        "Full when at least two qualified subcontractors are findable in the required geography.",
      max_points: 5,
    },
    {
      key: "deadline_runway",
      label: "Days until the deadline",
      guidance:
        "Full at fourteen or more days of runway, scaled down toward your minimum.",
      max_points: 5,
    },
    {
      key: "recompete_incumbent",
      label: "Recompete with an identifiable incumbent price",
      guidance:
        "Points when this is a recompete and the incumbent's last award price can be identified.",
      max_points: 3,
    },
    {
      key: "agency_pays_ontime",
      label: "Agency pays on time",
      guidance:
        "Points for agencies with a good historical payment record. Tuned over time as outcomes are recorded.",
      max_points: 2,
    },
  ],
};

/**
 * Rules that stop an opportunity outright, whatever it scores.
 *
 * Deliberately few. Each one is a way a small firm loses money or standing by
 * bidding work it cannot deliver.
 */
const DEFAULT_HARD_EXCLUSIONS: CompanyProfileJson["hard_exclusions"] = [
  {
    key: "requires_facility_clearance",
    label: "Requires a facility security clearance",
    rule: "Skip anything requiring a cleared facility until you hold one.",
  },
  {
    key: "requires_prime_past_performance",
    label: "Requires prime-level past performance you do not have",
    rule: "Skip when the solicitation demands prime past performance and will not accept team or subcontractor experience.",
  },
  {
    key: "outside_service_area",
    label: "Outside your service area",
    rule: "Skip work outside the states and regions listed on your profile.",
  },
  {
    key: "bonding_over_capacity",
    label: "Bonding requirement above your capacity",
    rule: "Skip when the required bond exceeds your bonding capacity.",
  },
];

/**
 * A complete, valid profile for a new organization.
 *
 * `seed` carries what signup already knows. Everything else is a working
 * default: the account functions on day one and the customer refines it from
 * Settings rather than being blocked by an empty form.
 */
export function defaultCompanyProfile(seed: {
  legalName: string;
  email: string;
  ownerName?: string | null;
}): CompanyProfileJson {
  const legalName = seed.legalName.trim() || "My company";
  const ownerName = seed.ownerName?.trim() || "";
  return {
    legal_name: legalName,
    dba: "",
    uei: "",
    cage_code: "",
    email: seed.email,
    outreach_email: seed.email,
    owner_name: ownerName,
    // First name only. Subcontractor-facing copy never carries a last name.
    outreach_display_name: ownerName ? ownerName.split(/\s+/)[0] : "",
    owner_title: "",
    physical_address: "",
    phone: "",
    entity_state: "",
    business_structure: "",

    // Almost every self-serve signup here is a small business; it is the
    // premise of the product. Editable, and it only affects set-aside scoring.
    small_business: true,
    certifications: [],
    naics_codes: [],
    excluded_naics: [],
    primary_trades: [],
    service_areas: [],

    // Margin defaults for subcontracted federal work: enough room to survive a
    // change order, low enough to stay competitive on price.
    target_margin_pct: 25,
    min_margin_pct: 15,
    max_markup_pct: 50,

    scoring_rubric: DEFAULT_RUBRIC,
    hard_exclusions: DEFAULT_HARD_EXCLUSIONS,

    sub_standards: {
      min_google_rating: 3.5,
      min_reviews: 3,
      require_active_license: true,
      require_not_sam_excluded: true,
      candidates_per_trade: 12,
      verify_top_n: 5,
    },

    pricing_rules: {
      margin_scenarios: [15, 25, 35],
      markup_default_pct: 25,
      // Quotes more than a quarter off the comparable median are surfaced for
      // a human rather than used silently.
      out_of_range_tolerance_pct: 25,
      recompete_undercut_pct: [3, 8],
      sanity_low_pct: 30,
    },

    decision_thresholds: {
      // Pursue automatically at 70, hold 50-69 for a human decision, drop the
      // rest. These are the numbers the Review queue is built around.
      pursue_min_score: 70,
      review_min_score: 50,
      review_auto_dismiss_hours: 72,
      min_subs_per_trade: 2,
      submit_lead_hours: 2,
      non_ss_cap_pct: 50,
      non_ss_alert_pct: 45,
      sam_alert_days: [90, 30, 7],
      cert_alert_days: [90, 30, 7],
      state_llc_alert_days: [60, 30, 7],
      insurance_alert_days: [60, 30, 7],
      value_min: 25_000,
      value_max: 500_000,
      deadline_min_days: 7,
      block_prime_only: false,
    },

    legal_guardrails: [
      "Never certify a socioeconomic status the company does not hold.",
      "Never submit a bid that omits a required form or certification.",
      "Never send a subcontractor another subcontractor's pricing.",
    ],
    notes: "",
  };
}
