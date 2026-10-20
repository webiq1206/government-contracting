\pset pager off
\echo == F1 sender addresses used for outbound email (90d)
select sender_email, count(*), max(created_at) from communications where direction='outbound' and channel='email' and created_at > now()-interval '90 days' group by 1 order by 2 desc limit 10;
\echo == F2 follow-up schedule on sent outreach
select (follow_up_at is not null) scheduled, (follow_up_at < now()) due, replied_at is not null replied, coalesce(follow_up_sent,false) fu_sent, delivery_state, count(*) from communications where direction='outbound' and channel='email' and coalesce(meta->>'kind','outreach')='outreach' and created_at > now()-interval '90 days' group by 1,2,3,4,5 order by 6 desc;
\echo == F3 follow-up emails sent (90d)
select date_trunc('day',created_at)::date d, meta->>'kind' kind, delivery_state, count(*) from communications where direction='outbound' and channel='email' and created_at > now()-interval '90 days' and coalesce(meta->>'kind','') not in ('outreach','') group by 1,2,3 order by 1 desc limit 30;
\echo == F4 outreach-followup run summaries (last 6)
select started_at, status, left(coalesce(summary->>'summary', error),250) s from job_runs where agent='outreach-followup' order by started_at desc limit 6;
\echo == F5 follow-up rule settings
select value_json->'follow_up_hours' fu_hours, value_json->'max_follow_ups' max_fu, value_json from app_settings where key ilike '%automation_rules%';
\echo == F6 bounces and deferrals (30d)
select delivery_state, left(coalesce(delivery_detail,''),160) detail, count(*) from communications where direction='outbound' and channel='email' and created_at > now()-interval '30 days' and delivery_state in ('bounced','deferred','failed') group by 1,2 order by 3 desc limit 10;
