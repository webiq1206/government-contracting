-- ---------------------------------------------------------------------------
-- Migration 0101, two integrity rules the recap delivery table was missing.
--
-- 1. Scope and ownership have to agree. A platform recap describes every
--    tenant and belongs to none, so it carries no org_id; a customer's recap
--    always carries one. The application follows that rule today, and nothing
--    in the schema said so. A single mis-scoped row is the one way a customer
--    could be handed a recap built from the whole platform, which is exactly
--    the leak the rest of this feature is built to prevent, so it belongs in
--    the database rather than in a code review.
--
-- 2. A send has to record that it reached the provider. Without that, a worker
--    that died between "the provider accepted this" and "we wrote down that it
--    was sent" leaves a row indistinguishable from one that never got that
--    far, and the next tick sends the mail a second time. The stamp below is
--    written immediately before the provider is called, so the recovery path
--    can tell "never sent" (safe to send again) from "we do not know" (a
--    person decides).
-- ---------------------------------------------------------------------------

alter table recap_deliveries
  add column if not exists provider_attempted_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'recap_deliveries_scope_org_ck'
  ) then
    -- Any pre-existing row that breaks the rule would block this, and there is
    -- no sensible automatic repair: a platform row with an org is a row whose
    -- audience we cannot infer. None exist (the feature ships with this
    -- migration), so failing loudly here is correct.
    alter table recap_deliveries add constraint recap_deliveries_scope_org_ck check (
      (scope = 'platform' and org_id is null)
      or (scope = 'org' and org_id is not null)
    );
  end if;
end $$;
