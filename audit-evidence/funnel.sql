\pset pager off
\echo == Q1 open opps by stage/tier/human (created 21d)
select stage, tier, human_action_required h, count(*), count(*) filter (where deadline > now()) live from opportunities where status='open' and created_at > now()-interval '21 days' group by 1,2,3 order by 4 desc;
\echo == Q2 pursue/review live opps: analysis/score/hash state by stage
select stage, tier, (solicitation_analysis is not null) analyzed, (score is not null) scored, (analysis_input_hash is not null and score_breakdown->>'analysis_input_hash' is distinct from analysis_input_hash) rescore_missing, human_action_required h, count(*) from opportunities where status='open' and deadline > now() and tier in ('pursue','review') group by 1,2,3,4,5,6 order by 7 desc;
\echo == Q3 job_runs 48h by agent/status
select agent, status, count(*), max(started_at) last from job_runs where started_at > now()-interval '48 hours' group by 1,2 order by 1,2;
\echo == Q4 top job_run errors 48h
select agent, left(coalesce(error,''),160) err, count(*) from job_runs where status='error' and started_at > now()-interval '48 hours' group by 1,2 order by 3 desc limit 25;
\echo == Q5 agent_logs warn/error 48h
select agent, action, level, left(coalesce(message,''),140) msg, count(*) from agent_logs where level in ('warn','error') and created_at > now()-interval '48 hours' group by 1,2,3,4 order by 5 desc limit 40;
\echo == Q6 outbound email by day/state 14d
select date_trunc('day',created_at)::date d, delivery_state, count(*) from communications where channel='email' and direction='outbound' and created_at > now()-interval '14 days' group by 1,2 order by 1 desc,2;
\echo == Q7 inbound email by day 14d
select date_trunc('day',created_at)::date d, count(*) from communications where direction='inbound' and created_at > now()-interval '14 days' group by 1 order by 1 desc;
\echo == Q8 opportunity_subs on live opps
select o.stage, os.outreach_state, os.verified, s.contact_status, (s.email is not null and s.email<>'') has_email, count(*) from opportunity_subs os join opportunities o on o.id=os.opportunity_id join subcontractors s on s.id=os.subcontractor_id where o.status='open' and o.deadline > now() group by 1,2,3,4,5 order by 6 desc limit 40;
\echo == Q9 live pursue opps with zero outbound email, by stage
select o.stage, o.human_action_required h, o.work_mode, count(*) from opportunities o where o.status='open' and o.deadline>now() and o.tier='pursue' and not exists (select 1 from communications c where c.opportunity_id=o.id and c.direction='outbound' and c.channel='email') group by 1,2,3 order by 4 desc;
\echo == Q10 automation rules and pause flags
select key, value_json from app_settings where key ilike '%automation_rules%' or key ilike '%pause%' or key ilike '%outreach%';
\echo == Q11 non-terminal mail claims
select delivery_state, count(*), min(created_at) oldest from communications where delivery_state in ('queued','attempting','unknown','held') group by 1;
\echo == Q12 ai receipts by state
select state, count(*), min(started_at) oldest from ai_work_receipts group by 1;
\echo == Q13 pg-boss queue backlog
select name, state, count(*) from pgboss.job where state in ('created','retry','active','failed') and created_on > now()-interval '3 days' group by 1,2 order by 3 desc limit 40;
\echo == Q14 pursue opps last 10d
select left(title,60) t, score, stage, human_action_required h, (solicitation_analysis is not null) analyzed, updated_at::timestamp(0) upd from opportunities where tier='pursue' and created_at > now()-interval '10 days' order by created_at desc limit 30;
