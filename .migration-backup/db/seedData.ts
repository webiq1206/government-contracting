/**
 * Seed data for a fresh BROSTCO install, transcribed from the official
 * "BROSTCO — Company Profile" persistent-memory document (v1.2). This is the
 * single source of truth every agent reads as system context. Edit at
 * /settings/profile; the platform versions each change.
 *
 * Business model: brokerage of qualified local subcontractors for federal (and
 * state/local) service contracts under the simplified acquisition ceiling.
 */
import type { CompanyProfileJson } from "../lib/types";

export const DEFAULT_PROFILE: CompanyProfileJson = {
  legal_name: "BROSTCO HOLDINGS LLC", // use EXACTLY as in SAM.gov — never abbreviate
  dba: undefined,
  uei: "", // [TO BE ADDED — assigned upon SAM.gov registration]
  cage_code: "", // [TO BE ADDED — assigned upon SAM.gov registration]
  ein: "41-4782422",
  entity_state: "ID",
  business_structure: "LLC — Single Member",
  physical_address: "4349 N Camas Creek Way, Meridian, ID 83646",
  phone: "(208) 695-0070",
  email: "brostcoholdings@gmail.com",
  outreach_email: "brostcoholdings@gmail.com", // all sub outreach must originate here
  owner_name: "Todd Brost",
  owner_title: "Sole Member",
  small_business: true,
  business_model: "brokerage",
  certifications: ["Small Business"],
  // 42 active NAICS across 8 service categories — all monitored continuously.
  naics_codes: [
    "561730", "561720", "561210", "561790", "561710", "561612", "561621",
    "238320", "238910", "238990",
    "562111", "562112", "562910", "562998", "562119",
    "722320", "722310", "722330",
    "488991", "484110", "484121", "492110", "493110", "493190",
    "811310", "811490", "811412", "811198",
    "531311", "531312",
    "561110", "561499", "561990", "561320", "561330",
    "541380", "541350", "541922", "512110",
  ],
  // Do not add without human approval (revisited after 10 contracts won).
  excluded_naics: ["541511", "541512", "541519", "623110", "621991"],
  primary_trades: [
    "landscaping",
    "janitorial",
    "facilities support",
    "pest control & security services",
    "painting & specialty trades",
    "waste, environmental & remediation",
    "catering & food service",
    "freight, warehousing & courier",
    "equipment maintenance & repair",
    "property management",
    "staffing & business support",
    "inspection, testing & photography",
  ],
  service_areas: ["Nationwide (all 50 states, DC, and US territories)"],
  years_in_business: 0, // newly formed; building its own track record
  target_margin_pct: 30, // standard-services target midpoint; category table below
  min_margin_pct: 20, // standard-services hard floor
  max_markup_pct: 100, // a 50% margin cap == 100% markup
  scoring_rubric: {
    total_points: 100,
    dimensions: [
      { key: "naics_active", label: "NAICS code in active list", max_points: 20, guidance: "Full points when the primary NAICS is one of our 42 active codes. Zero if it is on the excluded list; adjacency scores partial." },
      { key: "sb_setaside_match", label: "Small business set-aside match", max_points: 15, guidance: "Full for Total/Partial Small Business set-asides (we are SB). Reduced for unrestricted. Zero if it requires a certification we lack." },
      { key: "value_in_band", label: "Contract value in $50K–$350K range", max_points: 15, guidance: "Full inside the simplified-acquisition band. Zero below $50K. Above $350K only after 3+ contracts won." },
      { key: "multiyear_idiq", label: "Multi-year or IDIQ contract", max_points: 15, guidance: "Full for multi-year or IDIQ vehicles — highest priority. A 3-year IDIQ at $100K/yr outranks a one-time $250K." },
      { key: "pp_not_required", label: "Past performance not required at prime level", max_points: 10, guidance: "Full when not required or when subcontractor/team experience is accepted. Zero when prime-only experience is required." },
      { key: "pricing_comps", label: "Historical pricing comps available", max_points: 10, guidance: "Full when USASpending has comparable awards in the same NAICS/state to anchor pricing." },
      { key: "sub_findability", label: "Sub-findability (2+ verified subs)", max_points: 5, guidance: "Full when at least 2 qualified subs are findable in the required geography." },
      { key: "deadline_runway", label: "Days until deadline (14+ = full)", max_points: 5, guidance: "Full at 14+ days of runway; scaled down toward the 7-day minimum." },
      { key: "recompete_incumbent", label: "Recompete — incumbent price identified", max_points: 3, guidance: "Points when this is a recompete and the incumbent's last award price is identifiable for competitive positioning." },
      { key: "agency_pays_ontime", label: "Agency has paid on time historically", max_points: 2, guidance: "Points for agencies with a good historical payment record (Learning Loop tunes over time)." },
    ],
  },
  hard_exclusions: [
    { key: "value_below_min", label: "Value below $50K", rule: "Auto-dismiss: margin per hour of effort too low at this stage." },
    { key: "deadline_too_soon", label: "Fewer than 7 days to deadline", rule: "Auto-dismiss unless already in the active pipeline: insufficient time for sub research and quotes." },
    { key: "security_clearance", label: "Security clearance required", rule: "Auto-dismiss on keywords: Secret, Top Secret, TS/SCI, security clearance required." },
    { key: "licensed_professional", label: "Licensed professional / stamp required", rule: "Auto-dismiss when an engineering or architectural stamp is required on deliverables." },
    { key: "unrestricted_under_threshold", label: "Unrestricted under $150K", rule: "Auto-dismiss: competition density too high on unrestricted contracts below $150K." },
    { key: "ineligible_set_aside", label: "Ineligible set-aside", rule: "Auto-dismiss if the set-aside requires a certification we do not hold (WOSB, SDVOSB, 8(a), HUBZone)." },
  ],
  sub_standards: {
    min_google_rating: 3.8,
    min_reviews: 5,
    require_active_license: true, // active state license in the state of performance for licensed trades
    require_not_sam_excluded: true,
    min_reliability_score: 50,
    candidates_per_trade: 12,
    verify_top_n: 5,
  },
  pricing_rules: {
    margin_scenarios: [25, 35, 50],
    markup_default_pct: 30,
    out_of_range_tolerance_pct: 20,
    cpi_series_id: "CUUR0000SA0", // CPI-U, all items, US city average
    recompete_undercut_pct: [3, 8], // price 3–8% below incumbent's last award
    sanity_low_pct: 30, // flag if a bid is >30% below the historical median
    new_naics_learning_premium_pct: 15,
    remote_premium_pct: 10, // +10% floor for work >80mi from a metro
    margin_by_category: [
      { category: "Standard services (landscaping, janitorial, painting, pest control)", target_low_pct: 30, target_high_pct: 35, floor_pct: 20, cap_pct: 50 },
      { category: "Waste / environmental / remediation", target_low_pct: 35, target_high_pct: 45, floor_pct: 30, cap_pct: 50 },
      { category: "Catering / food service", target_low_pct: 25, target_high_pct: 35, floor_pct: 20, cap_pct: 45 },
      { category: "Facilities / property management", target_low_pct: 30, target_high_pct: 40, floor_pct: 25, cap_pct: 50 },
      { category: "Security guard / patrol services", target_low_pct: 25, target_high_pct: 35, floor_pct: 20, cap_pct: 45 },
      { category: "Packing, crating, freight", target_low_pct: 25, target_high_pct: 35, floor_pct: 20, cap_pct: 45 },
      { category: "Equipment maintenance / repair", target_low_pct: 30, target_high_pct: 40, floor_pct: 25, cap_pct: 50 },
      { category: "Multi-year IDIQ (any category)", target_low_pct: 30, target_high_pct: 40, floor_pct: 25, cap_pct: 50 },
    ],
  },
  decision_thresholds: {
    pursue_min_score: 70,
    review_min_score: 50,
    review_auto_dismiss_hours: 4,
    min_subs_per_trade: 2,
    submit_lead_hours: 2, // target 2h before deadline; never in the final 30 minutes
    non_ss_cap_pct: 50, // FAR 52.219-14 services cap
    non_ss_alert_pct: 45, // mandatory 5% buffer
    sam_alert_days: [90, 30, 7],
    cert_alert_days: [90, 30, 7],
    state_llc_alert_days: [60, 30, 7],
    insurance_alert_days: [60, 30, 7],
    value_min: 50_000,
    value_max: 350_000,
    deadline_min_days: 7,
    unrestricted_min_value: 150_000,
    pricing_gap_flag_pct: 20,
  },
  pricing_philosophy:
    "Price to win. On simplified acquisitions the lowest reasonable price that still clears the margin floor wins. Do not price to maximize margin on individual contracts — price to build a win record; margins expand as past performance accumulates. Recompete: price 3–8% below the incumbent's last award. New contract: at or below the inflation-adjusted historical median. Never bid above P75 unless scope clearly exceeds historical contracts. Flag for human review if a bid is more than 30% below the historical median (COs can reject unreasonably low bids).",
  legal_guardrails: [
    "FAR 52.219-14: at most 50% of a service contract's value may go to non-similarly-situated subs. Alert at 45% (mandatory 5% buffer).",
    "Similarly-situated subs (same Small Business status under the assigned subcontract NAICS) do not count against the 50% cap — prioritize them to maximize flexibility.",
    "Assign each subcontract the NAICS that best describes what the sub is actually doing — this can differ from the prime NAICS and is critical to the 50% cap calculation.",
    "Pass-through prevention: on every active contract perform scope review, sub vetting, CO communication, invoicing/accountability, and problem resolution; contracts over $100K require a site visit or documented remote oversight. Log every coordination activity with timestamps.",
    "Pay subs within agreed terms after receiving government payment; never delay without prior notice and an agreed revised date.",
    "Flag any contract in a state with subcontractor bonding or trust-account requirements for human review before execution.",
    "Always identify a backup subcontractor before signing any contract and document it in the contract record.",
  ],
  notes:
    "Brokerage model: BROSTCO wins federal service contracts and fulfills them through a vetted network of qualified, licensed local subcontractors — it does not self-perform. SAM.gov registration is pending (UEI/CAGE to be added on completion); the Compliance Agent must block bid submission while registration is inactive or within 7 days of expiry. Always use the legal name exactly as it appears in SAM.gov. All subcontractor outreach must originate from the outreach Gmail account only. Sub-findability gate: at least 2 verified subs must be found in the required geography within 24 hours, otherwise flag for a 60-second human review (never auto-dismiss). Every Sources Sought notice in an active NAICS gets a mandatory capability-statement response — never skip. Past performance at the prime level is generally not required below $350K; use subcontractor experience until the company builds its own record, then request CPARS after each completed contract.",
};

export interface SeedTemplate {
  slug: string;
  subject: string;
  body: string;
  description: string;
}

/**
 * Email templates, transcribed from Company Profile §15. Placeholders use the
 * {{var}} convention the Outreach agent fills; wording matches the profile so
 * the tone (professional, direct, brief — sound like a real business owner) is
 * preserved.
 */
export const DEFAULT_TEMPLATES: SeedTemplate[] = [
  {
    slug: "template_1_outreach",
    subject: "{{trade}} Quote Request — {{location_state}}",
    description: "Template 1 — initial subcontractor outreach (4–6 sentences, scannable under 20s).",
    body: [
      'Hi {{owner_name}},',
      "",
      "My name is {{sender_name}} with {{company_name}}. We're a federal contracting company and we have a {{trade}} contract in {{location_state}} that we need a qualified local partner to fulfill.",
      "",
      "Scope: {{scope_summary}}",
      "",
      "{{questions}}",
      "",
      "Estimated start: on award. If this is a fit, I'd like to get a written quote and schedule a quick call. Is this something your team can take on?",
      "",
      "{{sender_name}}",
      "{{company_name}} | {{phone}}",
    ].join("\n"),
  },
  {
    slug: "template_2_followup",
    subject: "Re: {{trade}} Quote Request — {{location_state}}",
    description: "Template 2 — 48-hour follow-up (2–3 sentences). One follow-up only; no third email.",
    body: [
      'Hi {{owner_name}},',
      "",
      "Following up on my email about a {{trade}} contract in {{location_state}}. The bid deadline is {{deadline}}, so I need to move quickly.",
      "",
      "Interested? Reply here or call me at {{phone}}.",
      "",
      "{{sender_name}}",
    ].join("\n"),
  },
  {
    slug: "template_3_sources_sought",
    subject: "Sources Sought Response — {{solicitation_number}} — {{company_name}}",
    description: "Template 3 — Sources Sought capability response (queued for human send within 24h).",
    body: [
      "{{co_name}},",
      "",
      "{{company_name}} (UEI: {{uei}}, CAGE: {{cage_code}}) submits this response to the Sources Sought notice for {{opportunity_title}}.",
      "",
      "We are an active Small Business registered in SAM.gov with primary NAICS {{naics_code}}. We have the capability to perform the described requirements through our established network of qualified, licensed {{trade}} subcontractors.",
      "",
      "We intend to bid on the resulting solicitation and request that this procurement be set aside for Small Businesses per FAR 19.502-2. Our capability statement is attached.",
      "",
      "{{sender_name}}",
      "{{company_name}} | {{phone}} | {{email}}",
      "UEI: {{uei}} | CAGE: {{cage_code}}",
    ].join("\n"),
  },
  {
    slug: "template_4_cpars",
    subject: "CPARS Evaluation Request — Contract {{contract_number}}",
    description: "Template 4 — CPARS request, queued 7 days after contract close.",
    body: [
      "{{co_name}},",
      "",
      "I'm writing to request that a Contractor Performance Assessment Report be completed for our performance on Contract {{contract_number}}, which concluded on {{end_date}}.",
      "",
      "Please let me know if you need any supporting information from us.",
      "",
      "Thank you for the opportunity to serve {{agency}}.",
      "",
      "{{sender_name}} | {{company_name}}",
    ].join("\n"),
  },
];
