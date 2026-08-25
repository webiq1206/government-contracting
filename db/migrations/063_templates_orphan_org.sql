-- Adopt template rows that belong to no organization.
--
-- activeTemplate() resolves a template with `org_id in (yours, default)`. A row
-- whose org_id is NULL matches neither, so it is invisible to every
-- organization including the founding one, and an install holding only such
-- rows refuses every outreach send with "no active template_1_outreach
-- template".
--
-- Migrations 028 and 042 each backfilled NULLs once, which fixed every install
-- that existed at the time. But the seed script kept inserting without an
-- org_id, so any environment seeded AFTER 042 grew fresh orphans that nothing
-- would ever adopt. The seed script now writes the default org explicitly;
-- this adopts what it already left behind.
--
-- Rows are adopted only where the default org does not already hold that slug.
-- Where both exist the default row is the live one and the orphan is dead
-- weight, so it is deactivated rather than adopted: promoting it would collide
-- on (org_id, slug, version) and, worse, could resurrect pre-fix wording over
-- the current default.

UPDATE templates t
   SET org_id = '00000000-0000-4000-8000-000000000001'::uuid
 WHERE t.org_id IS NULL
   AND NOT EXISTS (
     SELECT 1 FROM templates d
      WHERE d.slug = t.slug
        AND d.org_id = '00000000-0000-4000-8000-000000000001'::uuid
   );

UPDATE templates
   SET is_active = false
 WHERE org_id IS NULL
   AND is_active;
