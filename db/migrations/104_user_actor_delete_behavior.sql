-- Account deletion removes a user identity only when it has no membership in
-- any surviving organization. Historical actor columns must retain the event,
-- not retain an otherwise deleted login solely because it approved or resolved
-- something in the past.

alter table platform_key_grants
  drop constraint if exists platform_key_grants_granted_by_fkey;
alter table platform_key_grants
  add constraint platform_key_grants_granted_by_fkey
  foreign key (granted_by) references users(id) on delete set null;

alter table conversation_flags
  drop constraint if exists conversation_flags_resolved_by_fkey;
alter table conversation_flags
  add constraint conversation_flags_resolved_by_fkey
  foreign key (resolved_by) references users(id) on delete set null;

alter table subcontractor_documents
  drop constraint if exists subcontractor_documents_verified_by_fkey;
alter table subcontractor_documents
  add constraint subcontractor_documents_verified_by_fkey
  foreign key (verified_by) references users(id) on delete set null;

alter table influencer_payouts
  drop constraint if exists influencer_payouts_approved_by_fkey;
alter table influencer_payouts
  add constraint influencer_payouts_approved_by_fkey
  foreign key (approved_by) references users(id) on delete set null;
