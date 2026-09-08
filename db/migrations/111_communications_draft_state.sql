-- A message written on purpose and never handed to a provider is a draft.
--
-- delivery_state had no word for that. Its default is 'sent', and two writers
-- relied on the default: the Sources Sought responder, which drafts a response
-- for a person to review ("do NOT send" says its own comment) and recorded it
-- as sent; and the award-paperwork chase, which recorded a refused send the
-- same way. On 2026-09-08 production held 140 such drafts and a further set of
-- held approaches, every one reading as sent on the conversation log, and the
-- recap counting them as outreach that went out.
--
-- 'draft' joins the states. It is not 'failed': nothing broke, a person has
-- not sent it yet. The rows below are the ones this build can prove were
-- never handed over: no provider, no Gmail message id, and either the
-- responder's own draft marker or a chase whose stored outcome says the send
-- did not happen. Anything the data cannot prove is left as it is.

alter table communications drop constraint if exists communications_delivery_state_check;
alter table communications add constraint communications_delivery_state_check
  check (delivery_state in ('sent','delivered','bounced','deferred','failed','draft'));

-- Sources Sought drafts: marked as drafts by the writer, never sent by it.
update communications c
   set delivery_state = 'draft',
       org_id = coalesce(c.org_id, o.org_id)
  from opportunities o
 where o.id = c.opportunity_id
   and c.channel = 'email'
   and c.direction = 'outbound'
   and c.provider is null
   and c.gmail_message_id is null
   and c.delivery_state = 'sent'
   and c.meta->>'kind' = 'sources_sought_response';

-- Award-paperwork chases whose own record says the send did not happen.
update communications c
   set delivery_state = 'failed',
       org_id = coalesce(c.org_id, o.org_id)
  from opportunities o
 where o.id = c.opportunity_id
   and c.channel = 'email'
   and c.direction = 'outbound'
   and c.provider is null
   and c.gmail_message_id is null
   and c.delivery_state = 'sent'
   and c.meta->>'kind' = 'compliance-chase'
   and c.meta->>'sent' = 'false';

-- Approaches the outreach agent held back before delivery_state existed: no
-- verified address, or Gmail paused, so the packet was stored and nothing was
-- handed over. These have no provider, no Gmail message id, no marker of any
-- kind (the agent wrote none then), and the opportunity_subs row for the same
-- pair still says no_email, email_unverified or pending. 061 gave them the
-- default and they have read as sent since. Every real send from this agent
-- carries a provider, so provider-less rows from it are exactly the held ones.
update communications c
   set delivery_state = 'draft'
 where c.channel = 'email'
   and c.direction = 'outbound'
   and c.provider is null
   and c.gmail_message_id is null
   and c.subcontractor_id is not null
   and c.delivery_state = 'sent'
   and (c.meta is null or c.meta->>'kind' is null);

-- The attention index covers drafts too: a draft is something a person owes.
drop index if exists communications_delivery_attention_idx;
create index if not exists communications_delivery_attention_idx
  on communications (org_id, delivery_state, created_at desc)
  where delivery_state in ('bounced','deferred','failed','draft');
