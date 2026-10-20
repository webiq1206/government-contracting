\pset pager off
\echo == V0 worker heartbeat and latest job
select max(started_at) last_job, now() db_now from job_runs;
\echo == V1 job_runs since 15:30 UTC by agent/status
select agent, status, count(*) from job_runs where started_at > '2026-10-20 15:30:00+00' group by 1,2 order by 1,2;
\echo == V2 notable agent_logs since 15:30
select agent, action, level, count(*) from agent_logs where created_at > '2026-10-20 15:30:00+00' and action in ('requeue-final-score','requeue-analysis','requeue-scoring','auto-pursue','rule-dismissed','band-decision','readiness-held','gate','downstream-held','completion-held','sent','send','blocked','run','score','rescore','stale-analysis-score-refused') group by 1,2,3 order by 4 desc limit 40;
\echo == V3 errors since 15:30
select agent, left(coalesce(error,''),150) err, count(*) from job_runs where status='error' and started_at > '2026-10-20 15:30:00+00' group by 1,2 order by 3 desc limit 15;
\echo == V4 open live opps by stage/tier/human now
select stage, tier, human_action_required h, count(*) from opportunities where status='open' and deadline > now() and created_at > now()-interval '21 days' group by 1,2,3 order by 4 desc;
\echo == V5 opps moved since 15:30 by stage/tier
select stage, tier, status, count(*) from opportunities where updated_at > '2026-10-20 15:30:00+00' group by 1,2,3 order by 4 desc;
\echo == V6 sub pairings created since 15:30
select os.outreach_state, os.verified, count(*) from opportunity_subs os where os.created_at > '2026-10-20 15:30:00+00' group by 1,2;
\echo == V7 outbound email since 15:30 by state
select delivery_state, count(*) from communications where direction='outbound' and channel='email' and created_at > '2026-10-20 15:30:00+00' group by 1;
