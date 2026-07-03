/**
 * Default seed data for a fresh BROSTCO install. The Company Profile encodes
 * every business rule the spec references (100-point rubric, tier thresholds,
 * non-SS cap, submit lead time, sub standards, pricing scenarios). All of it is
 * editable later at /settings/profile — this is a sensible, complete starting
 * point so the platform behaves correctly from first boot.
 */
import type { CompanyProfileJson } from "../lib/types";

export const DEFAULT_PROFILE: CompanyProfileJson = {
  legal_name: "Brostco Construction LLC",
  dba: "BROSTCO",
  uei: "",
  cage_code: "",
  entity_state: "TX",
  small_business: true,
  certifications: ["Small Business"],
  naics_codes: [
    "236220", // Commercial & Institutional Building Construction
    "238160", // Roofing Contractors
    "238210", // Electrical Contractors
    "238220", // Plumbing/HVAC
    "561210", // Facilities Support Services
  ],
  psc_codes: ["Z2AA", "Y1AA"],
  primary_trades: [
    "general construction",
    "roofing",
    "electrical",
    "plumbing",
    "HVAC",
    "concrete",
  ],
  service_areas: ["TX", "OK", "LA", "NM", "AR"],
  bonding_capacity: 2_000_000,
  annual_revenue: 3_500_000,
  years_in_business: 6,
  target_margin_pct: 20,
  min_margin_pct: 12,
  max_markup_pct: 35,
  scoring_rubric: {
    total_points: 100,
    dimensions: [
      {
        key: "naics_fit",
        label: "NAICS / trade fit",
        max_points: 20,
        guidance:
          "Full points when the primary NAICS is one we hold and the scope matches our trades. Partial for adjacent codes.",
      },
      {
        key: "geographic_fit",
        label: "Geographic fit",
        max_points: 15,
        guidance:
          "Full points inside our service areas where we can find subs; reduced for distant states.",
      },
      {
        key: "set_aside_fit",
        label: "Set-aside / certification fit",
        max_points: 15,
        guidance:
          "Full points when a set-aside matches our certifications (small business, and any we hold). Zero if we are ineligible.",
      },
      {
        key: "value_fit",
        label: "Contract value fit",
        max_points: 15,
        guidance:
          "Full points for contracts within our bonding capacity and sweet spot ($100K–$1.5M). Penalize if above bonding capacity.",
      },
      {
        key: "competition",
        label: "Competition level",
        max_points: 10,
        guidance:
          "Higher when historical award counts are low and set-aside narrows the field.",
      },
      {
        key: "past_perf_feasibility",
        label: "Past-performance feasibility",
        max_points: 10,
        guidance:
          "Full when not_required or team_accepted with strong sub history; zero when prime_only.",
      },
      {
        key: "sub_findability",
        label: "Subcontractor findability",
        max_points: 10,
        guidance:
          "Higher when required trades are common in the job location and we already have qualified subs.",
      },
      {
        key: "agency_favorability",
        label: "Agency favorability",
        max_points: 5,
        guidance:
          "Higher for agencies that pay fast and where we have a track record. Learning Loop tunes this over time.",
      },
    ],
  },
  hard_exclusions: [
    {
      key: "ineligible_set_aside",
      label: "Ineligible set-aside",
      rule: "Dismiss if the set-aside requires a certification we do not hold (e.g. 8(a), SDVOSB, WOSB) unless we hold it.",
    },
    {
      key: "over_bonding",
      label: "Over bonding capacity",
      rule: "Dismiss if estimated value exceeds 150% of our bonding capacity.",
    },
    {
      key: "out_of_scope_naics",
      label: "Out-of-scope NAICS",
      rule: "Dismiss if the NAICS and scope have no overlap with our trades.",
    },
    {
      key: "deadline_too_soon",
      label: "Deadline too soon",
      rule: "Dismiss (auto) if the deadline is under 48 hours away and no analysis has started.",
    },
    {
      key: "sam_registration_lapsed",
      label: "SAM registration lapsed",
      rule: "Block submission (not ingestion) if our SAM.gov registration is expired.",
    },
  ],
  sub_standards: {
    min_google_rating: 4.0,
    min_reviews: 5,
    require_active_license: true,
    require_not_sam_excluded: true,
    min_reliability_score: 50,
    candidates_per_trade: 12,
    verify_top_n: 5,
  },
  pricing_rules: {
    margin_scenarios: [25, 35, 50],
    markup_default_pct: 25,
    out_of_range_tolerance_pct: 20,
    cpi_series_id: "CUUR0000SA0", // CPI-U, all items, US city average
  },
  decision_thresholds: {
    pursue_min_score: 70,
    review_min_score: 50,
    review_auto_dismiss_hours: 4,
    min_subs_per_trade: 2,
    submit_lead_hours: 2,
    non_ss_cap_pct: 50,
    non_ss_alert_pct: 45,
    sam_alert_days: [90, 30, 7],
    cert_alert_days: [90, 30, 7],
    state_llc_alert_days: [60, 30, 7],
    insurance_alert_days: [60, 30, 7],
  },
  notes:
    "This is the default seed profile. Update identity fields (UEI, CAGE), certifications, NAICS, and service areas to match the real entity before going live. All agents read this profile as authoritative system context.",
};

export interface SeedTemplate {
  slug: string;
  subject: string;
  body: string;
  description: string;
}

export const DEFAULT_TEMPLATES: SeedTemplate[] = [
  {
    slug: "template_1_outreach",
    subject: "Subcontractor quote request — {{opportunity_title}} ({{location_state}})",
    description: "Template 1 — personalized sub outreach for a specific opportunity/trade.",
    body: [
      "Hi {{owner_name}},",
      "",
      "I'm reaching out from {{company_name}} regarding an upcoming project we're bidding: {{opportunity_title}} in {{location_state}} (due {{deadline}}).",
      "",
      "We're looking for a {{trade}} subcontractor and your work came highly rated. The scope in brief:",
      "{{scope_summary}}",
      "",
      "Would you be able to provide a written quote? A few quick questions to get us started:",
      "{{questions}}",
      "",
      "If it's easier to talk it through, reply with a good time and number and I'll call.",
      "",
      "Thanks,",
      "{{sender_name}}",
      "{{company_name}}",
    ].join("\n"),
  },
  {
    slug: "template_3_sources_sought",
    subject: "Capability Statement — {{company_name}} — {{solicitation_number}}",
    description: "Template 3 — Sources Sought capability statement response.",
    body: [
      "To the Contracting Officer,",
      "",
      "{{company_name}} is a {{certifications}} firm responding to the Sources Sought notice {{solicitation_number}} ({{opportunity_title}}).",
      "",
      "We are interested and capable of performing this requirement. Our relevant capabilities:",
      "{{capability_summary}}",
      "",
      "Relevant NAICS: {{naics_codes}}. UEI: {{uei}}. CAGE: {{cage_code}}.",
      "",
      "Our capability statement is attached. We welcome the opportunity to support this requirement and are available to discuss.",
      "",
      "Respectfully,",
      "{{sender_name}}",
      "{{company_name}}",
    ].join("\n"),
  },
  {
    slug: "template_4_cpars",
    subject: "Past performance / CPARS reference request — {{contract_number}}",
    description: "Template 4 — CPARS request, queued 7 days after contract close.",
    body: [
      "Hi {{co_name}},",
      "",
      "Now that {{contract_number}} ({{opportunity_title}}) is complete, we'd appreciate a CPARS evaluation at your convenience.",
      "",
      "Please let us know if you need anything from us to finalize it. We valued working with your team and hope to support future requirements.",
      "",
      "Thank you,",
      "{{sender_name}}",
      "{{company_name}}",
    ].join("\n"),
  },
];
