-- A delivery state for mail that was not sent, by rule.
--
-- An outreach email the safety boundary refused (a do-not-contact address, a
-- stopped pursuit, a paused or disconnected mailbox, an exhausted trial
-- quota) was written as `failed` with no provider. Every report then read it
-- as mail that did not arrive: the platform recap said "10 emails sent, 10
-- did not arrive" on a day when nothing had failed, and the same rows were
-- counted again the next day after the bounce sweep suppressed their
-- addresses. `held` says what happened: nothing was attempted, nothing broke,
-- and nobody is waiting to send it.
--
-- Existing rows are reclassified only where the record itself proves the
-- hold: an outreach row whose own log line says it was held, and a
-- compliance chase whose stored result names a hold rather than a provider
-- refusal. Anything the data cannot prove stays `failed`.

alter table communications drop constraint if exists communications_delivery_state_check;
alter table communications add constraint communications_delivery_state_check
  check (delivery_state in ('sent','delivered','bounced','deferred','failed','draft','held'));

-- Compliance chases the sender recorded as held rather than refused.
update communications
   set delivery_state = 'held',
       delivery_updated_at = now()
 where channel = 'email'
   and direction = 'outbound'
   and delivery_state = 'failed'
   and provider is null
   and meta->>'kind' = 'compliance-chase'
   and (
     meta->>'error' is null
     or meta->>'error' ~* '(do-not-contact|suppress|paused|not connected|no inbox|quota|stopped|unsubscribed|opted out)'
   );

-- Outreach approaches whose own log line says the send was held.
update communications c
   set delivery_state = 'held',
       delivery_updated_at = now()
  from agent_logs l
 where c.channel = 'email'
   and c.direction = 'outbound'
   and c.delivery_state = 'failed'
   and c.provider is null
   and l.agent = 'outreach'
   and l.action = 'send'
   and l.opportunity_id = c.opportunity_id
   and l.subcontractor_id = c.subcontractor_id
   and l.org_id = c.org_id
   and l.message like 'Held email to %'
   and l.created_at between c.created_at - interval '5 minutes' and c.created_at + interval '5 minutes';
