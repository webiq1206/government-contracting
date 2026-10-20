\pset pager off
\echo == X0 now
select now();
\echo == X1 outbound email since 15:30 by state, channel and hour
select date_trunc('hour',created_at) h, delivery_state, count(*) from communications where direction='outbound' and channel='email' and created_at > '2026-10-20 15:30:00+00' group by 1,2 order by 1,2;
\echo == X2 outreach agent log messages since 16:30
select level, left(message,300) msg, count(*) from agent_logs where agent in ('outreach','outreach-recovery-sweep','pursuit-continuation-sweep') and created_at > '2026-10-20 16:30:00+00' group by 1,2 order by 3 desc limit 25;
\echo == X3 job_runs since 16:30 by agent/status
select agent, status, count(*) from job_runs where started_at > '2026-10-20 16:30:00+00' group by 1,2 order by 1,2;
\echo == X4 pairings with a verified email, by outreach state
select os.outreach_state, s.contact_status, count(*) from opportunity_subs os join subcontractors s on s.id=os.subcontractor_id join opportunities o on o.id=os.opportunity_id where o.status='open' and o.deadline>now() and os.removed_at is null and s.contact_status='verified' group by 1,2 order by 3 desc;
\echo == X5 outbound sent emails, latest 15
select created_at, delivery_state, left(subject,90) subj, recipient_email from communications where direction='outbound' and channel='email' and delivery_state in ('sent','delivered','queued','attempting','unknown','held','failed') order by created_at desc limit 15;
\echo == X6 rfq outbound rules and pause
select key, value_json from app_settings where key ilike '%automation_rules%' or key ilike '%pause%';
