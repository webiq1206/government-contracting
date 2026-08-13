-- Retire the last single-tenant uniqueness assumptions.
--
-- Three unique indexes from 000_init predate organizations and enforce
-- one-per-PLATFORM instead of one-per-ORG:
--
--   company_profile_active_uidx   (is_active) where is_active
--   company_profile_version_uidx  (version)
--   scoring_weights_active_uidx   (is_active) where is_active
--
-- The first is not theoretical: the SECOND customer to ever sign up got a 500,
-- because signup inserts their active profile shell and the founding org
-- already holds the one allowed active row. Found by signing up a second
-- organization; every new customer would have hit it.
--
-- Uniqueness was always meant per organization; these now say so.

drop index if exists company_profile_active_uidx;
create unique index company_profile_active_uidx
  on company_profile (org_id) where is_active;

drop index if exists company_profile_version_uidx;
create unique index company_profile_version_uidx
  on company_profile (org_id, version);

drop index if exists scoring_weights_active_uidx;
create unique index scoring_weights_active_uidx
  on scoring_weights (org_id) where is_active;

-- Templates: same disease, different symptom. unique (slug, version) is
-- global, so the first org to save "template_1_outreach v5" blocks every
-- other org's v5 forever. Versions are per-org; the founding org's rows are
-- the platform defaults every org reads until they save their own copy.
alter table templates drop constraint if exists templates_slug_version_key;
create unique index if not exists templates_org_slug_version_uniq
  on templates (org_id, slug, version);
