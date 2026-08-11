-- Backfill outreach_display_name (first name) on active company profiles so
-- subcontractor-facing emails stop using full legal owner names.
update company_profile
   set profile_json = jsonb_set(
         profile_json,
         '{outreach_display_name}',
         to_jsonb(split_part(coalesce(profile_json->>'owner_name', ''), ' ', 1)),
         true
       ),
       updated_at = now()
 where is_active = true
   and coalesce(profile_json->>'outreach_display_name', '') = ''
   and coalesce(profile_json->>'owner_name', '') <> '';
