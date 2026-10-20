\pset pager off
\echo == Y1 subs paired in last 3 days by contact_status and email_status
select s.contact_status, os.verification_json->>'email_status' email_status, (s.website is not null and s.website<>'') has_site, count(*) from opportunity_subs os join subcontractors s on s.id=os.subcontractor_id where os.created_at > now()-interval '3 days' group by 1,2,3 order by 4 desc limit 30;
\echo == Y2 email domains of unverified scraped emails
select split_part(s.email,'@',2) dom, count(*) from opportunity_subs os join subcontractors s on s.id=os.subcontractor_id where os.created_at > now()-interval '3 days' and s.contact_status='unverified' group by 1 order by 2 desc limit 15;
\echo == Y3 pairings per opportunity and trade (last 3 days)
select o.title, os.trade, count(*) pairs, count(*) filter (where os.verified) verified, count(*) filter (where s.contact_status='verified') emailable from opportunity_subs os join subcontractors s on s.id=os.subcontractor_id join opportunities o on o.id=os.opportunity_id where os.created_at > now()-interval '3 days' group by 1,2 order by 3 desc limit 30;
\echo == Y4 opportunities reaching sub_research or later per day (14d)
select date_trunc('day', l.created_at)::date d, count(distinct l.opportunity_id) from agent_logs l where l.agent='sub-finder' and l.created_at > now()-interval '14 days' group by 1 order by 1;
\echo == Y5 open live opps by tier and score band
select tier, case when score>=70 then '70+' when score>=60 then '60-69' when score>=50 then '50-59' when score is null then 'none' else '<50' end band, count(*) from opportunities where status='open' and deadline>now() group by 1,2 order by 1,2;
\echo == Y6 company sub standards
select profile_json->'sub_standards' from company_profile where is_active and org_id='00000000-0000-4000-8000-000000000001';
