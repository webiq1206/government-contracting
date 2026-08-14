-- API keys become per-organization. Every customer brings their own.
--
-- integration_settings holds the credentials that make the product work: the
-- SAM.gov key, Anthropic, Google Maps, Hunter, Twilio, Ahrefs. Its primary key
-- was `env_key` ALONE, so there was exactly one row per key for the entire
-- platform and saveSetting() did `on conflict (env_key) do update`. The second
-- customer to save a SAM key silently overwrote the first, and from then on
-- every tenant's searches ran against one account's key, quota, and bill.
--
-- This is the same defect the Gmail token table had. Migration 035 re-keyed
-- integration_tokens to (provider, org_id) and fixed OAuth; nobody re-checked
-- the table next to it, because a single-tenant install cannot exhibit the
-- symptom.
--
-- The product rule this enforces: a customer without an approved SAM account
-- cannot bid on federal work anyway, so bringing their own key is not friction
-- we are adding, it is a prerequisite they already have. The platform's own
-- key must never be reachable by a customer.

-- Existing rows belong to the founding organization. Backfill before re-keying,
-- otherwise the new primary key rejects them on a null org_id.
update integration_settings
   set org_id = '00000000-0000-4000-8000-000000000001'::uuid
 where org_id is null;

-- A row with no owner after the backfill cannot be attributed to a tenant.
-- Dropping it is the safe direction: that tenant re-enters their key, whereas
-- keeping it would let one customer's credential serve another's requests.
delete from integration_settings where org_id is null;

alter table integration_settings
  alter column org_id set not null;

alter table integration_settings
  drop constraint if exists integration_settings_pkey;

alter table integration_settings
  add constraint integration_settings_pkey primary key (env_key, org_id);

create index if not exists integration_settings_org_idx
  on integration_settings (org_id);
