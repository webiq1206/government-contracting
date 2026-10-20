\pset pager off
\echo == W1 outreach blocked messages since 15:30
select left(message,400) msg, count(*) from agent_logs where agent='outreach' and created_at > '2026-10-20 15:30:00+00' and level='warn' group by 1 order by 2 desc limit 10;
\echo == W2 why analysis-stage records are not final-score candidates
select (solicitation_analysis is not null) has_analysis, solicitation_analysis->>'brief_source' brief_source, (coalesce(analysis_input_hash,'')<>'') has_hash, (score_breakdown->>'analysis_input_hash' is distinct from analysis_input_hash) needs_score, jsonb_typeof(solicitation_analysis->'completeness'->'missing') missing_type, exists (select 1 from jsonb_array_elements(case when jsonb_typeof(solicitation_analysis->'completeness'->'missing')='array' then solicitation_analysis->'completeness'->'missing' else '[]'::jsonb end) g where g->>'critical'='true' and g->>'key' in ('solicitation_number','agency','deadline','location','scope')) sourcing_gap, ('prime_only_blocked' = any(coalesce(risk_flags,'{}'))) prime_blocked, coalesce(pursuit_state,'active') pursuit, (updated_at < now()-interval '20 minutes') settled, count(*) from opportunities where status='open' and stage in ('analysis','scoring') and deadline > now() and is_sources_sought is not true group by 1,2,3,4,5,6,7,8,9 order by 10 desc limit 30;
\echo == W3 scoring-recovery-sweep summaries since 15:30
select started_at, left(summary->>'summary',300) s from job_runs where agent='scoring-recovery-sweep' and started_at > '2026-10-20 15:30:00+00' order by 1;
\echo == W4 sub-verify incomplete reasons sample
select left(error, 600) e from job_runs where agent='sub-verify' and status='error' and started_at > '2026-10-20 15:30:00+00' limit 3;
\echo == W5 sub-verify success summaries sample
select left(summary->>'summary', 300) s, count(*) from job_runs where agent='sub-verify' and status='ok' and started_at > '2026-10-20 15:30:00+00' group by 1 order by 2 desc limit 10;
\echo == W6 scoring-engine run warnings since 15:30
select left(message,300) msg, count(*) from agent_logs where agent='scoring-engine' and level='warn' and created_at > '2026-10-20 15:30:00+00' group by 1 order by 2 desc limit 10;
