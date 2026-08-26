-- ============================================================================
-- Migration 0070, tenant identity on job_runs
--
-- job_runs records every agent execution: which agent, what triggered it,
-- whether it succeeded, its error text and its summary JSON. It has never
-- carried an organization.
--
-- That is not merely a missing column. `/agents` is the customer-facing
-- Automation Health page, and it reads job_runs with no organization filter
-- through agentStatuses() and jobRunsSummary(). Every customer has therefore
-- been shown, for each agent: run counts and error counts across the whole
-- platform, and the error text and summary JSON of the most recent run
-- whoever it belonged to. A summary reading "Compliance monitor: 3 orgs
-- checked" or an error naming a record is another tenant's data on this
-- tenant's screen.
--
-- Nullable, and deliberately NOT backfilled. Nothing in an existing row says
-- which organization it belonged to: the agent name does not (every tenant
-- runs the same roster), and the timestamp does not. Inventing an owner would
-- be worse than admitting there is none, so legacy rows keep org_id null and
-- the customer-facing queries exclude nulls rather than guessing. Platform
-- admin keeps the unfiltered view, which is where a platform-wide question
-- belongs.
--
-- on delete set null rather than cascade: deleting an organization should not
-- erase the record that the platform's automation ran. The run happened.
-- ============================================================================

alter table job_runs
  add column if not exists org_id uuid references organizations(id) on delete set null;

-- The customer-facing read is "this organization's runs, this agent, most
-- recent first", which is exactly this order. Partial on org_id not null
-- because the legacy rows are never in a customer query and there is no
-- reason to carry them in the index.
create index if not exists job_runs_org_agent_idx
  on job_runs (org_id, agent, started_at desc)
  where org_id is not null;

-- Platform admin asks "what ran recently across everything", which the
-- existing job_runs_agent_idx already serves.
