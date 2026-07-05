-- ============================================================================
-- BROSTCO — Autonomous Procurement Execution Platform
-- Migration 0001 — initial schema (SYS-03 plus supporting tables)
-- Target: PostgreSQL 15+ (Supabase). Safe to re-run (IF NOT EXISTS everywhere).
-- ============================================================================

create extension if not exists "pgcrypto";   -- gen_random_uuid()

-- ---------------------------------------------------------------------------
-- company_profile — versioned single source of truth injected into every
-- Claude API call as system context. Only one row is "active" at a time.
-- ---------------------------------------------------------------------------
create table if not exists company_profile (
  id           uuid primary key default gen_random_uuid(),
  version      integer not null default 1,
  is_active    boolean not null default false,
  profile_json jsonb not null default '{}'::jsonb,
  profile_text text not null,                 -- injected into every Claude call
  updated_at   timestamptz not null default now(),
  updated_by   text
);
create unique index if not exists company_profile_active_uidx
  on company_profile (is_active) where is_active;
create unique index if not exists company_profile_version_uidx
  on company_profile (version);

-- ---------------------------------------------------------------------------
-- scoring_weights — versioned 100-point rubric weights. Learning Loop proposes
-- new versions (proposed_at set, approved_at null); operator approves to apply.
-- ---------------------------------------------------------------------------
create table if not exists scoring_weights (
  id           uuid primary key default gen_random_uuid(),
  version      integer not null,
  weights      jsonb not null,               -- { dimension_key: {weight, ...} }
  rationale    text,
  is_active    boolean not null default false,
  proposed_at  timestamptz not null default now(),
  proposed_by  text not null default 'system',   -- 'system' | 'learning-loop' | operator
  approved_at  timestamptz,
  approved_by  text,
  supporting_data jsonb                       -- win-rate evidence from Learning Loop
);
create unique index if not exists scoring_weights_active_uidx
  on scoring_weights (is_active) where is_active;

-- ---------------------------------------------------------------------------
-- opportunities — the core pipeline record (SYS-03).
-- ---------------------------------------------------------------------------
create table if not exists opportunities (
  id                     uuid primary key default gen_random_uuid(),
  source                 text not null,        -- sam_federal | state | county | school
  source_id              text unique,          -- external notice id (dedup key)
  solicitation_number    text,
  title                  text,
  description            text,
  naics_code             text,
  psc_code               text,
  set_aside_type         text,                 -- e.g. SBA, 8(a), HUBZone, WOSB, full
  value_estimated        numeric,
  deadline               timestamptz,
  posted_at              timestamptz,
  location_state         text,
  location_text          text,
  agency                 text,
  sub_agency             text,
  contact_json           jsonb,                -- POC name/email/phone from notice
  attachments_json       jsonb default '[]'::jsonb, -- [{name,url,storage_path,mime}]
  raw_json               jsonb,                -- normalized-from source payload
  score                  integer,
  score_breakdown        jsonb,                -- per-dimension points + reasoning
  tier                   text,                 -- pursue | review | dismiss
  is_sources_sought      boolean not null default false,
  solicitation_analysis  jsonb,                -- Solicitation Analyst output
  past_perf_classification text,               -- not_required | team_accepted | prime_only
  risk_flags             text[] default '{}',
  stage                  text not null default 'monitoring',
  -- pipeline stages: monitoring, scoring, analysis, sub_research, outreach,
  -- call_queue, quote_entry, bid_building, submitted, won, lost, dismissed
  status                 text not null default 'open',  -- open | closed | archived
  human_action_required  boolean not null default false,
  review_expires_at      timestamptz,          -- review-tier auto-dismiss timer (+4h)
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);
create index if not exists opportunities_stage_idx    on opportunities (stage);
create index if not exists opportunities_tier_idx     on opportunities (tier);
create index if not exists opportunities_deadline_idx on opportunities (deadline);
create index if not exists opportunities_naics_idx    on opportunities (naics_code);
create index if not exists opportunities_ss_idx       on opportunities (is_sources_sought) where is_sources_sought;

-- ---------------------------------------------------------------------------
-- subcontractors — the sub database (SYS-03).
-- ---------------------------------------------------------------------------
create table if not exists subcontractors (
  id                   uuid primary key default gen_random_uuid(),
  company_name         text not null,
  owner_name           text,
  trade_categories     text[] default '{}',
  naics_codes          text[] default '{}',
  state                text,
  city                 text,
  address              text,
  email                text,
  email_verified       boolean not null default false,
  phone                text,
  website              text,
  license_number       text,
  license_status       text,                 -- active | expired | unknown | not_found
  sam_excluded         boolean not null default false,
  google_rating        numeric,
  review_count         integer,
  google_place_id      text,
  responsiveness_score integer,              -- 0-100, updated by Learning Loop
  reliability_score    integer,              -- 0-100, updated by Learning Loop
  sb_certified         boolean,
  business_age_years    integer,
  project_history      jsonb default '[]'::jsonb, -- [{name,scope,value,client_type,year}]
  is_preferred         boolean not null default false,
  blacklisted          boolean not null default false,
  bbb_summary          text,
  reviews_summary      text,
  last_contacted       timestamptz,
  notes                text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create index if not exists subcontractors_state_idx  on subcontractors (state);
create index if not exists subcontractors_trades_idx on subcontractors using gin (trade_categories);
create index if not exists subcontractors_naics_idx  on subcontractors using gin (naics_codes);

-- ---------------------------------------------------------------------------
-- opportunity_subs — join: which subs are candidates for which opportunity,
-- per trade, with verification + outreach state.
-- ---------------------------------------------------------------------------
create table if not exists opportunity_subs (
  id                uuid primary key default gen_random_uuid(),
  opportunity_id    uuid not null references opportunities(id) on delete cascade,
  subcontractor_id  uuid not null references subcontractors(id) on delete cascade,
  trade             text,
  candidate_rank    integer,
  verified          boolean not null default false,
  verification_json jsonb,
  outreach_state    text not null default 'pending', -- pending|sent|followed_up|responsive|declined|no_response
  responded_at      timestamptz,
  created_at        timestamptz not null default now(),
  unique (opportunity_id, subcontractor_id, trade)
);
create index if not exists opportunity_subs_opp_idx on opportunity_subs (opportunity_id);
create index if not exists opportunity_subs_sub_idx on opportunity_subs (subcontractor_id);

-- ---------------------------------------------------------------------------
-- quotes — written sub quotes entered by the operator after calls.
-- ---------------------------------------------------------------------------
create table if not exists quotes (
  id                uuid primary key default gen_random_uuid(),
  opportunity_id    uuid not null references opportunities(id) on delete cascade,
  subcontractor_id  uuid references subcontractors(id) on delete set null,
  trade             text,
  quote_amount      numeric not null,
  payment_terms     text,
  notes             text,
  is_out_of_range   boolean not null default false,   -- vs pricing comps
  comparison_json   jsonb,
  created_at        timestamptz not null default now()
);
create index if not exists quotes_opp_idx on quotes (opportunity_id);

-- ---------------------------------------------------------------------------
-- pricing_comps — USASpending historical awards, CPI inflation-adjusted.
-- ---------------------------------------------------------------------------
create table if not exists pricing_comps (
  id                uuid primary key default gen_random_uuid(),
  opportunity_id    uuid references opportunities(id) on delete cascade,
  naics_code        text,
  state             text,
  award_amount      numeric,
  award_amount_adj  numeric,                  -- CPI-adjusted to present
  awarded_at        date,
  recipient_name    text,
  agency            text,
  is_incumbent      boolean not null default false,
  raw_json          jsonb,
  created_at        timestamptz not null default now()
);
create index if not exists pricing_comps_opp_idx on pricing_comps (opportunity_id);

-- ---------------------------------------------------------------------------
-- bids — the assembled bid record (SYS-03).
-- ---------------------------------------------------------------------------
create table if not exists bids (
  id                uuid primary key default gen_random_uuid(),
  opportunity_id    uuid not null references opportunities(id) on delete cascade,
  sub_quote_total   numeric,
  markup_pct        numeric,
  bid_amount        numeric,
  margin_pct        numeric,
  target_margin_pct numeric,
  qa_checklist      jsonb,                    -- [{item, ok, note}]
  narrative         text,                     -- past-perf narrative (from sub history)
  documents_json    jsonb default '[]'::jsonb,-- [{name, storage_path, kind}]
  human_flags       text[] default '{}',      -- e.g. prime_only, out_of_range
  submitted_at      timestamptz,
  outcome           text,                     -- won | lost | no_award | pending
  award_amount      numeric,
  loss_reason       text,
  cpars_rating      text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists bids_opp_idx     on bids (opportunity_id);
create index if not exists bids_outcome_idx on bids (outcome);

-- ---------------------------------------------------------------------------
-- contracts — won contracts (SYS-03) with pass-through defense logging.
-- ---------------------------------------------------------------------------
create table if not exists contracts (
  id                uuid primary key default gen_random_uuid(),
  bid_id            uuid references bids(id) on delete set null,
  opportunity_id    uuid references opportunities(id) on delete set null,
  contract_number   text,
  award_amount      numeric,
  start_date        date,
  end_date          date,
  milestones        jsonb default '[]'::jsonb,-- [{name, due, status, amount}]
  primary_sub_id    uuid references subcontractors(id) on delete set null,
  backup_sub_id     uuid references subcontractors(id) on delete set null, -- recommended; nullable until confirmed
  coordination_log  jsonb default '[]'::jsonb,-- timestamped activity (pass-through defense)
  non_ss_sub_pct    numeric not null default 0, -- non-small-business sub spend %
  co_contact_json   jsonb,                    -- contracting officer contact
  cpars_due_at      timestamptz,
  cpars_status      text,                     -- pending | requested | received
  status            text not null default 'active', -- active | completed | closed
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists contracts_status_idx on contracts (status);

-- ---------------------------------------------------------------------------
-- communications — every outreach/reply, with open/click tracking.
-- ---------------------------------------------------------------------------
create table if not exists communications (
  id                uuid primary key default gen_random_uuid(),
  subcontractor_id  uuid references subcontractors(id) on delete cascade,
  opportunity_id    uuid references opportunities(id) on delete cascade,
  channel           text not null,            -- email | sms | call | note
  direction         text not null,            -- outbound | inbound
  subject           text,
  body              text,
  gmail_message_id  text,
  gmail_thread_id   text,
  tracking_id       text unique,              -- our wrapper id for opens/clicks
  opened_at         timestamptz,
  clicked_at        timestamptz,
  replied_at        timestamptz,
  follow_up_at      timestamptz,              -- scheduled 48h follow-up
  meta              jsonb,
  created_at        timestamptz not null default now()
);
create index if not exists communications_sub_idx     on communications (subcontractor_id);
create index if not exists communications_opp_idx     on communications (opportunity_id);
create index if not exists communications_track_idx   on communications (tracking_id);
create index if not exists communications_followup_idx on communications (follow_up_at)
  where follow_up_at is not null and replied_at is null;

-- ---------------------------------------------------------------------------
-- documents — generated + downloaded files (templates, bids, cap statements).
-- ---------------------------------------------------------------------------
create table if not exists documents (
  id                uuid primary key default gen_random_uuid(),
  opportunity_id    uuid references opportunities(id) on delete cascade,
  bid_id            uuid references bids(id) on delete cascade,
  kind              text not null,            -- solicitation | bid_pdf | bid_docx | capability_statement | template | sow
  name              text not null,
  storage_path      text,                     -- supabase storage key or local path
  storage_backend   text not null default 'supabase', -- supabase | local
  mime              text,
  version           integer not null default 1,
  meta              jsonb,
  created_at        timestamptz not null default now()
);
create index if not exists documents_opp_idx on documents (opportunity_id);

-- ---------------------------------------------------------------------------
-- templates — outreach/response templates with version history.
-- ---------------------------------------------------------------------------
create table if not exists templates (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null,                  -- template_1_outreach, template_3_sources_sought, template_4_cpars ...
  version     integer not null default 1,
  is_active   boolean not null default true,
  subject     text,
  body        text not null,                  -- supports {{handlebars}}-style vars
  description text,
  created_at  timestamptz not null default now(),
  unique (slug, version)
);

-- ---------------------------------------------------------------------------
-- compliance_items — tracked deadlines (SYS-08). Compliance Monitor updates.
-- ---------------------------------------------------------------------------
create table if not exists compliance_items (
  id             uuid primary key default gen_random_uuid(),
  category       text not null,               -- sam_registration | sb_cert | state_llc | insurance | non_ss_cap | far_change | cpars
  label          text not null,
  contract_id    uuid references contracts(id) on delete cascade, -- for per-contract items
  due_at         timestamptz,
  status         text not null default 'ok',  -- ok | warning | critical | blocked | resolved
  days_remaining integer,
  detail         jsonb,
  last_checked_at timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists compliance_items_due_idx on compliance_items (due_at);
create index if not exists compliance_items_cat_idx on compliance_items (category);

-- ---------------------------------------------------------------------------
-- agent_logs — every agent action with full reasoning (architecture principle).
-- ---------------------------------------------------------------------------
create table if not exists agent_logs (
  id             uuid primary key default gen_random_uuid(),
  agent          text not null,               -- opportunity-monitor, scoring-engine, ...
  action         text not null,
  opportunity_id uuid references opportunities(id) on delete set null,
  subcontractor_id uuid references subcontractors(id) on delete set null,
  bid_id         uuid references bids(id) on delete set null,
  level          text not null default 'info',-- info | warn | error | success
  status         text not null default 'ok',  -- ok | error | skipped
  message        text,
  reasoning      text,                        -- the "why" — model or rule rationale
  input_json     jsonb,
  output_json    jsonb,
  duration_ms    integer,
  claude_usage   jsonb,                        -- {input_tokens, output_tokens, model}
  created_at     timestamptz not null default now()
);
create index if not exists agent_logs_agent_idx on agent_logs (agent);
create index if not exists agent_logs_opp_idx   on agent_logs (opportunity_id);
create index if not exists agent_logs_time_idx  on agent_logs (created_at desc);

-- ---------------------------------------------------------------------------
-- call_cards — pre-built one-screen call cards for the Call Queue (Call Prep).
-- ---------------------------------------------------------------------------
create table if not exists call_cards (
  id                uuid primary key default gen_random_uuid(),
  opportunity_id    uuid not null references opportunities(id) on delete cascade,
  subcontractor_id  uuid not null references subcontractors(id) on delete cascade,
  card_json         jsonb not null,           -- everything the operator needs on one screen
  call_script       text,
  question_list     jsonb,                    -- SOW-specific questions + project-history question
  needs_project_history boolean not null default false,
  status            text not null default 'pending', -- pending | called | skipped
  called_at         timestamptz,
  response_json     jsonb,                     -- captured responses
  created_at        timestamptz not null default now(),
  unique (opportunity_id, subcontractor_id)
);
create index if not exists call_cards_status_idx on call_cards (status);

-- ---------------------------------------------------------------------------
-- users — operator auth (Phase 1 single-user; extensible to multi-user).
-- ---------------------------------------------------------------------------
create table if not exists users (
  id            uuid primary key default gen_random_uuid(),
  email         text unique not null,
  password_hash text not null,
  name          text,
  role          text not null default 'operator', -- operator | admin | viewer
  created_at    timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- sessions — server-side session store for cookie auth.
-- ---------------------------------------------------------------------------
create table if not exists sessions (
  id         text primary key,                -- random token (also the cookie value)
  user_id    uuid not null references users(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists sessions_user_idx on sessions (user_id);

-- ---------------------------------------------------------------------------
-- integration_tokens — OAuth tokens (Gmail) + scraper state, encrypted at rest
-- by the app layer. Single-row-per-provider.
-- ---------------------------------------------------------------------------
create table if not exists integration_tokens (
  provider    text primary key,               -- gmail
  data        jsonb not null,                 -- {access_token, refresh_token, expiry}
  updated_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- job_runs — lightweight audit of cron/queue runs for the Agents dashboard.
-- ---------------------------------------------------------------------------
create table if not exists job_runs (
  id          uuid primary key default gen_random_uuid(),
  agent       text not null,
  trigger     text not null,                  -- cron | queue | manual
  status      text not null default 'running',-- running | ok | error
  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  error       text,
  summary     jsonb
);
create index if not exists job_runs_agent_idx on job_runs (agent, started_at desc);

-- updated_at auto-touch trigger ---------------------------------------------
create or replace function touch_updated_at() returns trigger as $$
begin new.updated_at = now(); return new; end;
$$ language plpgsql;

do $$
declare t text;
begin
  foreach t in array array[
    'opportunities','subcontractors','bids','contracts','compliance_items'
  ] loop
    execute format(
      'drop trigger if exists trg_touch_%1$s on %1$s;
       create trigger trg_touch_%1$s before update on %1$s
       for each row execute function touch_updated_at();', t);
  end loop;
end $$;
