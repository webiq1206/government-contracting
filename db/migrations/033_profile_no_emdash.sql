-- 033: strip em/en dashes from the LIVE company profile (and any template that
-- still carries one).
--
-- Why a migration and not just a seed-file edit: the scoring rubric labels,
-- guidance, and notes live inside company_profile.profile_json, a row that was
-- written once at seed time. Editing db/seedData.ts fixes new installs only;
-- an existing production profile keeps the old text forever. That is why
-- "Recompete <emdash> incumbent price identified" was still rendering on every
-- opportunity page's score breakdown long after the copy rule was adopted.
--
-- Same normalisation as lib/sanitize.ts noEmDash():
--   " word <dash> word "  ->  "word, word"
--   any remaining dash    ->  "-"      (e.g. "$50K-$350K")
-- Applied to the whole JSON document as text, so every nested label, guidance
-- string, exclusion rule, and note is covered in one pass.

update company_profile
   set profile_json = regexp_replace(
                        regexp_replace(profile_json::text, '\s+[—–]\s+', ', ', 'g'),
                        '[—–]', '-', 'g'
                      )::jsonb,
       profile_text = regexp_replace(
                        regexp_replace(coalesce(profile_text, ''), '\s+[—–]\s+', ', ', 'g'),
                        '[—–]', '-', 'g'
                      )
 where profile_json::text ~ '[—–]'
    or coalesce(profile_text, '') ~ '[—–]';

update templates
   set body = regexp_replace(
                regexp_replace(body, '\s+[—–]\s+', ', ', 'g'),
                '[—–]', '-', 'g'
              ),
       subject = regexp_replace(
                   regexp_replace(coalesce(subject, ''), '\s+[—–]\s+', ', ', 'g'),
                   '[—–]', '-', 'g'
                 )
 where body ~ '[—–]' or coalesce(subject, '') ~ '[—–]';
