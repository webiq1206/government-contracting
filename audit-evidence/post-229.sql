select phase, updated_at, now() - updated_at as age from worker_heartbeat order by updated_at desc limit 1;
select key, updated_at from app_settings where key like 'platform:stale-build-alerted:%' order by updated_at desc limit 3;
select agent, status, count(*) from job_runs where started_at > now() - interval '20 minutes' group by 1,2 order by 1;
select count(*) filter (where delivery_state in ('sent','delivered')) as sent_today from communications where channel='email' and direction='outbound' and created_at > date_trunc('day', now());
select cause, state, created_at from automation_incidents where cause = 'pursuit_outcome_stall' order by created_at desc limit 3;
