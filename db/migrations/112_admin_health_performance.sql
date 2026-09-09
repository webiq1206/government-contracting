-- These reads run on navigation, Automation Health and recovery. Index the
-- tenant before time/status so a customer's view does not scan platform history.
-- Additive only; existing audit rows and earlier migration checksums stay intact.
create index if not exists agent_logs_org_created_idx
  on agent_logs (org_id, created_at desc);
create index if not exists agent_logs_org_status_created_idx
  on agent_logs (org_id, status, created_at desc)
  where status in ('ok', 'error');
create index if not exists job_runs_org_started_idx
  on job_runs (org_id, started_at desc);
create index if not exists job_runs_org_success_record_idx
  on job_runs (org_id, agent, opportunity_id, started_at desc)
  where status = 'ok';
create index if not exists communications_org_email_created_idx
  on communications (org_id, created_at desc)
  where channel = 'email';
