-- Additional mailboxes that may speak for a subcontractor.
-- Additive only. Shared company inboxes (dispatch@, estimating@) are stored
-- here and trusted on a strongly matched thread. Nothing is dropped.
alter table subcontractors
  add column if not exists email_aliases text[] not null default '{}';

comment on column subcontractors.email_aliases is
  'Exact mailboxes, besides subcontractors.email, that speak for this firm. Freemail domain trust is never inferred from these.';
