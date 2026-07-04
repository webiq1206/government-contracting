/** Domain types mirroring the database schema (db/migrations/0001_init.sql). */

export type Tier = "pursue" | "review" | "dismiss";
export type PastPerfClassification =
  | "not_required"
  | "team_accepted"
  | "prime_only";

export type PipelineStage =
  | "monitoring"
  | "scoring"
  | "analysis"
  | "sub_research"
  | "outreach"
  | "call_queue"
  | "quote_entry"
  | "bid_building"
  | "submitted"
  | "won"
  | "lost"
  | "dismissed";

export interface CompanyProfile {
  id: string;
  version: number;
  is_active: boolean;
  profile_json: CompanyProfileJson;
  profile_text: string;
  updated_at: string;
  updated_by: string | null;
}

/** Structured shape of the Company Profile (persistent system context). */
export interface CompanyProfileJson {
  legal_name: string;
  dba?: string;
  uei?: string;
  cage_code?: string;
  duns?: string;
  ein?: string;
  entity_state?: string;
  business_structure?: string;
  physical_address?: string;
  phone?: string;
  email?: string;
  outreach_email?: string; // all sub outreach must originate here
  owner_name?: string;
  owner_title?: string;
  small_business: boolean;
  certifications: string[]; // e.g. ["SDVOSB", "HUBZone", "8(a)"]
  excluded_naics?: string[]; // do not add without human approval
  naics_codes: string[];
  psc_codes?: string[];
  primary_trades: string[];
  service_areas: string[]; // states/regions
  bonding_capacity?: number;
  annual_revenue?: number;
  years_in_business?: number;
  business_model?: string; // e.g. brokerage
  target_margin_pct: number;
  min_margin_pct: number;
  max_markup_pct: number;
  scoring_rubric: ScoringRubric;
  hard_exclusions: HardExclusion[];
  sub_standards: SubStandards;
  pricing_rules: PricingRules;
  decision_thresholds: DecisionThresholds;
  pricing_philosophy?: string;
  legal_guardrails?: string[];
  templates?: Record<string, string>;
  capability_statement_doc?: string; // documents.id or storage path
  notes?: string;
}

export interface MarginBand {
  category: string;
  target_low_pct: number;
  target_high_pct: number;
  floor_pct: number; // hard floor — never compress below
  cap_pct: number;
}

export interface ScoringDimension {
  key: string;
  label: string;
  max_points: number;
  guidance: string;
}
export interface ScoringRubric {
  total_points: number; // 100
  dimensions: ScoringDimension[];
}

export interface HardExclusion {
  key: string;
  label: string;
  rule: string; // human-readable; enforced in code where structured
}

export interface SubStandards {
  min_google_rating?: number;
  min_reviews?: number;
  require_active_license: boolean;
  require_not_sam_excluded: boolean;
  min_reliability_score?: number;
  candidates_per_trade: number; // e.g. 10-15
  verify_top_n: number; // e.g. 5
}

export interface PricingRules {
  margin_scenarios: number[]; // e.g. [25, 35, 50]
  markup_default_pct: number;
  out_of_range_tolerance_pct: number; // flag quotes beyond this vs comps
  cpi_series_id?: string; // BLS series for inflation adjustment
  recompete_undercut_pct?: [number, number]; // price this % below incumbent, e.g. [3, 8]
  sanity_low_pct?: number; // flag if bid > this % below historical median
  new_naics_learning_premium_pct?: number; // +% target margin on first bid in a NAICS
  remote_premium_pct?: number; // +% floor for work >80mi from a metro
  margin_by_category?: MarginBand[];
}

export interface DecisionThresholds {
  pursue_min_score: number; // 70
  review_min_score: number; // 50
  review_auto_dismiss_hours: number; // 4
  min_subs_per_trade: number; // 2
  submit_lead_hours: number; // 2 (submit >= 2h before deadline)
  non_ss_cap_pct: number; // 50 (block additional at 49%, alert at 45%)
  non_ss_alert_pct: number; // 45
  sam_alert_days: number[]; // [90, 30, 7]
  cert_alert_days: number[]; // [90, 30, 7]
  state_llc_alert_days: number[]; // [60, 30, 7]
  insurance_alert_days: number[]; // [60, 30, 7]
  value_min?: number; // 50000 — below this: auto-dismiss
  value_max?: number; // 350000 — above this: flag for review
  deadline_min_days?: number; // 7 — fewer days: auto-dismiss unless in pipeline
  unrestricted_min_value?: number; // 150000 — unrestricted below this: auto-dismiss
  pricing_gap_flag_pct?: number; // 20 — flag if min-margin bid > this % above median
}

export interface Opportunity {
  id: string;
  source: string;
  source_id: string | null;
  solicitation_number: string | null;
  title: string | null;
  description: string | null;
  naics_code: string | null;
  psc_code: string | null;
  set_aside_type: string | null;
  value_estimated: number | null;
  deadline: string | null;
  posted_at: string | null;
  location_state: string | null;
  location_text: string | null;
  agency: string | null;
  sub_agency: string | null;
  contact_json: Record<string, unknown> | null;
  attachments_json: Attachment[];
  raw_json: Record<string, unknown> | null;
  score: number | null;
  score_breakdown: ScoreBreakdown | null;
  tier: Tier | null;
  is_sources_sought: boolean;
  solicitation_analysis: SolicitationAnalysis | null;
  past_perf_classification: PastPerfClassification | null;
  risk_flags: string[];
  stage: PipelineStage;
  status: string;
  human_action_required: boolean;
  review_expires_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Attachment {
  name: string;
  url?: string;
  storage_path?: string;
  mime?: string;
}

export interface ScoreBreakdown {
  total: number;
  tier: Tier;
  hard_exclusions_triggered: string[];
  dimensions: {
    key: string;
    label: string;
    points: number;
    max_points: number;
    reasoning: string;
  }[];
  summary: string;
}

export interface SolicitationAnalysis {
  scope_plain_language: string;
  submission_requirements: string[];
  evaluation_criteria: string[];
  required_trades: string[];
  geographic_area: string;
  risk_flags: string[];
  past_perf_classification: PastPerfClassification;
  questions_for_subs: string[];
  draft_sow: string;
  set_aside: string | null;
  key_dates: { label: string; date: string }[];
}

export interface Subcontractor {
  id: string;
  company_name: string;
  owner_name: string | null;
  trade_categories: string[];
  naics_codes: string[];
  state: string | null;
  city: string | null;
  address: string | null;
  email: string | null;
  email_verified: boolean;
  phone: string | null;
  website: string | null;
  license_number: string | null;
  license_status: string | null;
  sam_excluded: boolean;
  google_rating: number | null;
  review_count: number | null;
  google_place_id: string | null;
  responsiveness_score: number | null;
  reliability_score: number | null;
  sb_certified: boolean | null;
  business_age_years: number | null;
  project_history: ProjectHistoryItem[];
  is_preferred: boolean;
  blacklisted: boolean;
  bbb_summary: string | null;
  reviews_summary: string | null;
  last_contacted: string | null;
  notes: string | null;
}

export interface ProjectHistoryItem {
  name: string;
  scope: string;
  value: number;
  client_type: string;
  year: number;
}

export interface Bid {
  id: string;
  opportunity_id: string;
  sub_quote_total: number | null;
  markup_pct: number | null;
  bid_amount: number | null;
  margin_pct: number | null;
  target_margin_pct: number | null;
  qa_checklist: QaChecklistItem[] | null;
  narrative: string | null;
  documents_json: { name: string; storage_path: string; kind: string }[];
  human_flags: string[];
  submitted_at: string | null;
  outcome: "won" | "lost" | "no_award" | "pending" | null;
  award_amount: number | null;
  loss_reason: string | null;
  cpars_rating: string | null;
}

export interface QaChecklistItem {
  item: string;
  ok: boolean;
  note?: string;
}

/** Standard result shape all agents return so the worker can log uniformly. */
export interface AgentResult {
  ok: boolean;
  summary: string;
  reasoning?: string;
  data?: Record<string, unknown>;
  enqueued?: { agent: string; payload: Record<string, unknown> }[];
  humanActionRequired?: boolean;
}

export interface AgentContext {
  runId: string;
  trigger: "cron" | "queue" | "manual";
  payload: Record<string, unknown>;
}
