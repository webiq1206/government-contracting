-- Future application transitions only. No historical send/receipt backfill.
-- The trigger and the communication write commit or roll back together. A
-- missing audit write therefore prevents the pre-provider attempt checkpoint.
alter table unmatched_inbound add column original_date_header text;
create table communication_events (
  id bigserial primary key,
  org_id uuid not null references organizations(id) on delete cascade,
  communication_id uuid not null references communications(id) on delete cascade,
  recorded_at timestamptz not null default clock_timestamp(),
  kind text not null check (kind in ('record_created','content_revised','state_changed','activity_recorded')),
  evidence jsonb not null,
  -- Present only when original content/intent changes; tracking requests do
  -- not duplicate the entire message body on each event.
  content jsonb
);
create index communication_events_history_idx on communication_events(org_id,communication_id,id);
alter table communication_events enable row level security;
create policy brostco_tenant_access on communication_events as permissive for all
  using (org_id=nullif(current_setting('brostco.org_id',true),'')::uuid)
  with check (org_id=nullif(current_setting('brostco.org_id',true),'')::uuid);
create policy brostco_tenant_boundary on communication_events as restrictive for all
  using (org_id=nullif(current_setting('brostco.org_id',true),'')::uuid)
  with check (org_id=nullif(current_setting('brostco.org_id',true),'')::uuid);
revoke all on communication_events from public;
do $$ begin
  if exists(select 1 from pg_roles where rolname='anon') then revoke all on communication_events from anon; end if;
  if exists(select 1 from pg_roles where rolname='authenticated') then revoke all on communication_events from authenticated; end if;
end $$;
create trigger communication_events_tenant_reference before insert or update on communication_events
  for each row execute function enforce_tenant_reference('public','communications','communication_id');
create trigger communication_events_tenant_owner before update of org_id on communication_events
  for each row execute function prevent_tenant_reassignment();

create function record_communication_evidence() returns trigger language plpgsql
security definer set search_path=pg_catalog as $$
declare
  payload jsonb;
  previous_payload jsonb;
  event_evidence jsonb;
  previous_evidence jsonb;
  event_kind text;
begin
  if new.channel <> 'email' or new.org_id is null then return new; end if;
  payload := jsonb_build_object('subject',new.subject,'body',new.body,
    'recipient_email',new.recipient_email,'direction',new.direction,
    'intent_kind',new.meta->>'kind','actor_id',new.meta->>'actor_id',
    'scheduled_key',new.meta->>'scheduled_key','request_key',new.request_key,
    'in_reply_to',new.meta->'in_reply_to','references',new.meta->'references');
  event_evidence := jsonb_build_object('delivery_state',new.delivery_state,
    'provider',new.provider,'provider_message_id',new.gmail_message_id,
    'rfc822_message_id',new.rfc822_message_id,'gmail_thread_id',new.gmail_thread_id,
    'sender_email',new.sender_email,'provider_account_email',new.meta->>'provider_account_email',
    'provider_connection_generation',new.meta->>'provider_connection_generation','provider_attempted_at',new.provider_attempted_at,
    'provider_accepted_at',new.provider_accepted_at,'delivery_detail',new.delivery_detail,
    'opened_at',new.opened_at,'clicked_at',new.clicked_at,'replied_at',new.replied_at,
    'follow_up_at',new.follow_up_at,'record_created_at',new.created_at);
  if tg_op='INSERT' then event_kind := 'record_created';
  else
    previous_payload := jsonb_build_object('subject',old.subject,'body',old.body,
      'recipient_email',old.recipient_email,'direction',old.direction,
      'intent_kind',old.meta->>'kind','actor_id',old.meta->>'actor_id',
      'scheduled_key',old.meta->>'scheduled_key','request_key',old.request_key,
      'in_reply_to',old.meta->'in_reply_to','references',old.meta->'references');
    previous_evidence := jsonb_build_object('delivery_state',old.delivery_state,
      'provider',old.provider,'provider_message_id',old.gmail_message_id,
      'rfc822_message_id',old.rfc822_message_id,'gmail_thread_id',old.gmail_thread_id,
      'sender_email',old.sender_email,'provider_account_email',old.meta->>'provider_account_email',
      'provider_connection_generation',old.meta->>'provider_connection_generation','provider_attempted_at',old.provider_attempted_at,
      'provider_accepted_at',old.provider_accepted_at,'delivery_detail',old.delivery_detail,
      'opened_at',old.opened_at,'clicked_at',old.clicked_at,'replied_at',old.replied_at,
      'follow_up_at',old.follow_up_at,'record_created_at',old.created_at);
    if payload = previous_payload and event_evidence = previous_evidence then return new; end if;
    -- Preserve the old snapshot at first future change to a legacy record.
    -- Its event time is now, explicitly not a reconstructed provider receipt.
    if not exists(select 1 from public.communication_events where communication_id=new.id and org_id=new.org_id) then
      insert into public.communication_events(org_id,communication_id,kind,evidence,content)
        values(new.org_id,new.id,'record_created',previous_evidence || '{"legacy_snapshot":true}'::jsonb,previous_payload);
    end if;
    event_kind := case when payload <> previous_payload then 'content_revised'
      when new.delivery_state is distinct from old.delivery_state
        or new.provider_attempted_at is distinct from old.provider_attempted_at
        or new.provider_accepted_at is distinct from old.provider_accepted_at
        or new.gmail_message_id is distinct from old.gmail_message_id then 'state_changed'
      else 'activity_recorded' end;
    if payload = previous_payload then payload := null; end if;
    event_evidence := event_evidence || jsonb_build_object('previous_delivery_state',old.delivery_state);
  end if;
  insert into public.communication_events(org_id,communication_id,kind,evidence,content)
    values(new.org_id,new.id,event_kind,event_evidence,payload);
  return new;
end $$;
create trigger communications_evidence after insert or update on communications
  for each row execute function record_communication_evidence();

alter table quotes add column source_communication_id uuid references communications(id) on delete set null;
create index quotes_source_communication_idx on quotes(org_id,source_communication_id) where source_communication_id is not null;
create trigger quotes_source_tenant_reference before insert or update of source_communication_id,org_id on quotes
  for each row execute function enforce_tenant_reference('public','communications','source_communication_id');
create function enforce_quote_message_source() returns trigger language plpgsql set search_path=pg_catalog as $$
begin
  if new.source_communication_id is not null and not exists (
    select 1 from public.communications c where c.id=new.source_communication_id
      and c.org_id=new.org_id and c.opportunity_id=new.opportunity_id
      and c.subcontractor_id=new.subcontractor_id and c.direction='inbound' and c.channel='email'
  ) then raise exception using errcode='23514',message='Quote source must be an inbound email for the same account, solicitation and supplier.'; end if;
  return new;
end $$;
create trigger quotes_message_source before insert or update of source_communication_id,org_id,opportunity_id,subcontractor_id on quotes
  for each row execute function enforce_quote_message_source();
