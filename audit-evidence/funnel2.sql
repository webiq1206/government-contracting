\pset pager off
\echo == R1 critical blocker keys on open live opps in analysis/scoring
select o.stage, regexp_replace(m->>'key','_[0-9]+$','') k, count(distinct o.id) from opportunities o, jsonb_array_elements(coalesce(o.solicitation_analysis->'completeness'->'missing','[]'::jsonb)) m where o.status='open' and o.deadline>now() and o.stage in ('analysis','scoring') and (m->>'critical')::boolean group by 1,2 order by 3 desc;
\echo == R2 blocker combos (excluding verification) per opp
select stage, other_blockers, count(*) from (select o.id, o.stage, coalesce(string_agg(distinct regexp_replace(m->>'key','_[0-9]+$',''), ',') filter (where m->>'key' not like 'analysis_verification%'), '(only verification)') other_blockers from opportunities o, jsonb_array_elements(coalesce(o.solicitation_analysis->'completeness'->'missing','[]'::jsonb)) m where o.status='open' and o.deadline>now() and o.stage in ('analysis','scoring') and (m->>'critical')::boolean group by o.id, o.stage) x group by 1,2 order by 3 desc limit 30;
\echo == R3 sample verification issues
select left(i,220) issue from opportunities o, jsonb_array_elements_text(coalesce(o.solicitation_analysis->'verification_issues','[]'::jsonb)) i where o.status='open' and o.deadline>now() and o.stage='analysis' limit 40;
\echo == R4 attachment outcome statuses on analysis-stage opps
select a->>'status' st, count(*) from opportunities o, jsonb_array_elements(coalesce(o.solicitation_analysis->'completeness'->'attachment_outcomes','[]'::jsonb)) a where o.status='open' and o.deadline>now() and o.stage='analysis' group by 1 order by 2 desc;
\echo == R5 analysis-stage opps: score/tier/past_perf/risk flags
select score is not null scored, tier, past_perf_classification pp, (select string_agg(f, ',' order by f) from unnest(risk_flags) f where f like 'pre_analysis%' or f in ('prime_only','prime_only_blocked','incomplete_solicitation','unverified_analysis','documents_not_read','missing_attachments')) flags, count(*) from opportunities where status='open' and deadline>now() and stage='analysis' group by 1,2,3,4 order by 5 desc limit 30;
\echo == R6 scoring-stage tier-null opps: last scoring log action
select x.action, left(x.message,120) msg, count(*) from opportunities o cross join lateral (select action, message from agent_logs l where l.opportunity_id=o.id and l.agent in ('scoring-engine','solicitation-analyst') order by created_at desc limit 1) x where o.status='open' and o.deadline>now() and o.stage='scoring' and o.tier is null group by 1,2 order by 3 desc limit 20;
\echo == R7 set-asides on held pre_analysis_ineligible records
select set_aside_type, count(*) from opportunities where status='open' and deadline>now() and 'pre_analysis_ineligible_set_aside' = any(risk_flags) group by 1 order by 2 desc limit 20;
\echo == R8 company certifications in profile
select org_id, profile_json->'certifications' certs, profile_json->'decision_thresholds' thresholds, profile_json->'trades' trades, profile_json->'naics_codes' naics from company_profile where is_active;
\echo == R9 tier distribution of opps created in last 14d
select tier, count(*), round(avg(score)) avg_score, max(score) max_score from opportunities where created_at > now()-interval '14 days' group by 1 order by 2 desc;
\echo == R10 outreach/call_queue opps last log
select x.agent, x.action, left(x.message,140) msg, count(*) from opportunities o cross join lateral (select agent, action, message from agent_logs l where l.opportunity_id=o.id order by created_at desc limit 1) x where o.status='open' and o.deadline>now() and o.stage in ('outreach','call_queue') group by 1,2,3 order by 4 desc limit 20;
