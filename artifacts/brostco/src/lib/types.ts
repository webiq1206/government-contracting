export type Tier = "pursue" | "review" | "dismiss";
export type PipelineStage =
  | "monitoring" | "scoring" | "analysis" | "sub_research" | "outreach"
  | "call_queue" | "quote_entry" | "bid_building" | "submitted" | "won" | "lost" | "dismissed";

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
  score: number | null;
  score_breakdown: ScoreBreakdown | null;
  tier: Tier | null;
  is_sources_sought: boolean;
  solicitation_analysis: Record<string, unknown> | null;
  past_perf_classification: string | null;
  risk_flags: string[];
  stage: PipelineStage;
  status: string;
  human_action_required: boolean;
  review_expires_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ScoreBreakdown {
  total: number;
  tier: Tier;
  dimensions: { key: string; label: string; points: number; max_points: number; reasoning: string }[];
  summary: string;
  hard_exclusions_triggered?: string[];
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
  created_at: string;
  updated_at: string;
}

export interface ProjectHistoryItem {
  name: string;
  scope: string;
  value: number;
  client_type: string;
  year: number;
}

export interface SessionUser {
  id: string;
  email: string;
  name: string | null;
  role: string;
}
