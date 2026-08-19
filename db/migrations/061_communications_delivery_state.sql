-- What actually happened to an email after we handed it over.
--
-- communications recorded opened_at, clicked_at and replied_at, but nothing
-- about DELIVERY. The platform could only say "we called the Gmail API and it
-- did not throw", which is not the same as the message arriving -- and it was
-- being shown as though it were. An operator could sit waiting on a quote from
-- an address that had been dead for a year: the outreach read as sent, the
-- follow-up read as sent, and nothing anywhere said the mail had been rejected
-- on arrival.
--
-- The default is 'sent' for every existing row, which is exactly what we know
-- about them and no more. Backfilling anything to 'delivered' would be
-- inventing evidence; a row only becomes delivered when an open, click or
-- reply proves a human saw it.
alter table communications
  add column if not exists delivery_state text not null default 'sent',
  -- The provider's own words (a diagnostic code, "mailbox full"), so an
  -- operator can tell a typo'd address from a full mailbox from a block.
  add column if not exists delivery_detail text,
  add column if not exists delivery_updated_at timestamptz;

-- Only the states the domain module defines. A typo'd write should fail here
-- rather than render as an unknown chip in the UI.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'communications_delivery_state_check'
  ) then
    alter table communications add constraint communications_delivery_state_check
      check (delivery_state in ('sent','delivered','bounced','deferred','failed'));
  end if;
end $$;

-- The operator-facing question is "what needs attention", so the index covers
-- the failure states rather than the whole table.
create index if not exists communications_delivery_attention_idx
  on communications (org_id, delivery_state, created_at desc)
  where delivery_state in ('bounced','deferred','failed');
