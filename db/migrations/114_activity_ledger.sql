-- Append meaningful source changes in the same transaction as the action.
create table activity_events (
 id bigserial primary key,
 org_id uuid not null references organizations(id) on delete cascade,
 occurred_at timestamptz not null,
 recorded_at timestamptz not null default now(),
 category text not null,
 source_table text not null,
 source_id text not null,
 operation text not null,
 actor text not null,
 title text not null,
 status text not null,
 opportunity_id uuid,
 subcontractor_id uuid,
 detail jsonb not null,
 historical boolean not null default false
);
create index activity_org_time on activity_events(org_id,occurred_at desc,id desc);
create index activity_org_category on activity_events(org_id,category,occurred_at desc);
create index activity_org_opportunity on activity_events(org_id,opportunity_id,occurred_at desc);
create index activity_search on activity_events using gin(to_tsvector('simple', title || ' ' || detail::text));
alter table activity_events enable row level security;
revoke all on activity_events from public;

-- Explicit allowlist: never copy credentials, model prompts, internal API costs,
-- raw provider responses, or unbounded execution input/output into tenant history.
create function activity_projection(j jsonb) returns jsonb language sql immutable as $$
 select coalesce(jsonb_object_agg(key,value),'{}'::jsonb) from jsonb_each(j)
 where key=any(array['subject','body','recipient_email','channel','direction','delivery_state',
 'delivery_detail','submitted_at','bid_amount','narrative','human_flags','qa_checklist',
 'name','kind','version','status','stage','outcome','label','due_at','called_at','call_script',
 'message','reasoning','agent','action','level','duration_ms','quote_amount','trade','intent','reason',
 'original_message','provider','service','feature','workflow','billing_status','tenant_charge',
 'invoice_reference','number','amount_due_cents','amount_paid_cents','currency','failure_reason',
 'period_start','period_end','title','solicitation_number','from_email','from_name','snippet','state','dismissed_reason','matched_by','amount_cents','settlement_status','actor','started_at','finished_at']);
$$;
create function append_activity(t text, j jsonb, op text, historical boolean default false)
returns void language plpgsql as $$
declare
 org uuid := nullif(j->>'org_id','')::uuid;
 cat text; title text; state text; at_time timestamptz;
begin
 -- Unattributed platform records must never be assigned to a tenant by default.
 if org is null then return; end if;
 cat := case t when 'communications' then coalesce(j->>'channel','message')
 when 'bids' then 'bid' when 'quotes' then 'quote' when 'documents' then 'document'
 when 'call_cards' then 'call' when 'opportunities' then 'opportunity'
 when 'contracts' then 'contract' when 'compliance_items' then 'compliance'
 when 'api_usage_events' then 'api' when 'billing_invoices' then 'billing' when 'api_usage_adjustments' then 'billing' when 'api_usage_audit' then 'settings'
 when 'unmatched_inbound' then 'reply' when 'subcontractor_reply_events' then 'reply' else 'automation' end;
 state := coalesce(j->>'status', j->>'outcome','recorded');
 title := coalesce(j->>'label',j->>'name',j->>'title',initcap(cat));
 if t='communications' then
   state := case when j->>'direction'='inbound' then 'received' else coalesce(j->>'delivery_state','recorded') end;
   title := initcap(coalesce(j->>'channel','message')) || ' ' || state || ': ' || coalesce(nullif(j->>'subject',''),'No subject');
 elsif t='bids' then
   state := case when j->>'submitted_at' is not null then 'submitted'
     when case when jsonb_typeof(j->'human_flags')='array' then jsonb_array_length(j->'human_flags') else 0 end>0 then 'needs_review' else 'draft' end;
   title := case state when 'submitted' then 'Bid submitted' when 'needs_review' then 'Partial bid needs review' else 'Bid prepared or updated' end;
 elsif t='unmatched_inbound' then
   state := coalesce(j->>'state','needs_matching'); title := 'Unmatched reply: ' || coalesce(j->>'subject','No subject');
 elsif t='job_runs' then
   title := replace(coalesce(j->>'agent','Automation'),'_',' ') || ' run';
 elsif t='api_usage_adjustments' then
   state := coalesce(j->>'settlement_status',j->>'status','preparing');
   title := initcap(j->>'kind') || ' ' || state;
 elsif t='api_usage_audit' then
   title := replace(j->>'action','_',' ');
 elsif t='agent_logs' then
   state := case when j->>'level'='error' or j->>'status'='error' then 'failed'
     when j->>'level'='warn' then 'needs_review' else coalesce(j->>'status','recorded') end;
   title := replace(coalesce(j->>'action','Automation activity'),'_',' ');
 elsif t='api_usage_events' then
   state := coalesce(j->>'outcome','pending');
   title := coalesce(j->>'provider','API') || ': ' || coalesce(j->>'feature','request');
 elsif t='call_cards' then
   title := case when j->>'called_at' is not null then 'Call recorded' else 'Call prepared' end;
 elsif t='subcontractor_reply_events' then
   title := 'Reply reviewed: ' || replace(coalesce(j->>'intent','other'),'_',' ');
 elsif t='quotes' then title := 'Quote recorded';
 elsif t='documents' then title := 'Document: ' || coalesce(j->>'name','Untitled');
 end if;
 if op='DELETE' then title := title || ' (record removed)'; state := 'removed'; end if;
 at_time := case when historical then coalesce(nullif(j->>'updated_at','')::timestamptz,nullif(j->>'created_at','')::timestamptz,nullif(j->>'started_at','')::timestamptz,now()) else now() end;
 insert into activity_events(org_id,occurred_at,category,source_table,source_id,operation,actor,title,status,opportunity_id,subcontractor_id,detail,historical)
 values(org,at_time,cat,t,j->>'id',op,coalesce(j->>'actor',j->>'agent','Account activity'),title,state,
 case when t='opportunities' then (j->>'id')::uuid else coalesce(nullif(j->>'opportunity_id',''),nullif(j->>'matched_opportunity_id',''))::uuid end,
 nullif(j->>'subcontractor_id','')::uuid,activity_projection(j),historical);
end $$;
create function capture_activity() returns trigger language plpgsql as $$
begin
 if TG_OP='UPDATE' and OLD.org_id is not distinct from NEW.org_id and activity_projection(to_jsonb(OLD))=activity_projection(to_jsonb(NEW)) then return NEW; end if;
 -- Cascading account deletion must not recreate history for a removed account.
 if TG_OP='DELETE' then
   if TG_TABLE_NAME in ('agent_logs','job_runs') then return OLD; end if;
   if exists(select 1 from organizations where id=OLD.org_id) then perform append_activity(TG_TABLE_NAME,to_jsonb(OLD),TG_OP); end if;
   return OLD;
 end if;
 perform append_activity(TG_TABLE_NAME,to_jsonb(NEW),TG_OP);
 return NEW;
end $$;
do $$ declare t text; begin
 foreach t in array array['communications','bids','quotes','documents','call_cards','opportunities','contracts','compliance_items','agent_logs','subcontractor_reply_events','api_usage_events','billing_invoices','unmatched_inbound','job_runs','api_usage_audit'] loop
   execute format('select append_activity(%L,to_jsonb(s),''SNAPSHOT'',true) from %I s',t,t);
   execute format('create trigger activity_capture after insert or update or delete on %I for each row execute function capture_activity()',t);
 end loop;
end $$;
