-- Durable, event-scoped delivery state for billing notifications.
--
-- Stripe event handling and customer email are intentionally different
-- outcomes. A declined payment must still be recorded when Gmail is down, and
-- Gmail being down must not make Stripe replay the financial event. Keeping
-- the mail state on the claimed event makes that distinction durable and also
-- prevents a retry after an interrupted handler from sending the same billing
-- notice twice.

alter table public.stripe_events
  add column if not exists notification_kind text,
  add column if not exists notification_status text,
  add column if not exists notification_recipient text,
  add column if not exists notification_error text,
  add column if not exists notification_message_id text,
  add column if not exists notification_started_at timestamptz,
  add column if not exists notification_finished_at timestamptz;

do $migration$
begin
  if not exists (
    select 1
      from pg_catalog.pg_constraint
     where conname = 'stripe_events_notification_status_check'
       and conrelid = 'public.stripe_events'::pg_catalog.regclass
  ) then
    alter table public.stripe_events
      add constraint stripe_events_notification_status_check
      check (
        notification_status is null
        or notification_status in ('pending', 'sent', 'failed')
      );
  end if;
end
$migration$;

comment on column public.stripe_events.notification_status is
  'Independent billing-email outcome. pending is deliberately not retried automatically because provider acceptance may have happened before confirmation was saved.';

create index if not exists stripe_events_notification_attention_idx
  on public.stripe_events (notification_status, processed_at desc)
  where notification_status in ('pending', 'failed');
