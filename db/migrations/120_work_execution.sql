-- How the work gets done: by this company, by subcontractors, or both.
--
-- The company-wide default lives with the other automation rules in
-- app_settings (work_execution). These columns are the per-opportunity
-- override: null inherits the default; self_performed_trades names the
-- scopes the company does itself on a mixed job. Turning subcontracting off
-- stops sourcing, outreach and follow-ups for the record without touching
-- quotes, documents, deadlines or history.
alter table opportunities add column if not exists work_mode text
  check (work_mode is null or work_mode in ('self','sub','mixed'));
alter table opportunities add column if not exists self_performed_trades text[] not null default '{}';
alter table opportunities add column if not exists work_mode_changed_at timestamptz;
alter table opportunities add column if not exists work_mode_changed_by text;
