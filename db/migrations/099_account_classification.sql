-- Which accounts are real.
--
-- The platform's own workspace, demo accounts, and QA organizations sat in
-- every admin list and every headline count as if they were customers. The
-- number at the top of the Accounts page gets believed, and a "locked out"
-- count that includes three test accounts sends somebody investigating an
-- outage that is two QA fixtures and a demo.
--
-- Explicit rather than inferred. Guessing from the name ("QA Workspace",
-- "test") classifies a landscaping company called Test Valley Contractors as
-- a fixture, and nothing about that failure announces itself.

alter table organizations
  add column if not exists classification text not null default 'customer';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'organizations_classification_ck') then
    alter table organizations add constraint organizations_classification_ck
      check (classification in ('customer', 'internal', 'test'));
  end if;
end $$;
