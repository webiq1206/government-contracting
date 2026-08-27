-- Tell "somebody pressed Test" apart from "this actually did work".
--
-- integration_settings had one timestamp, last_validated_at, written only by
-- the Test button. The Integrations page then told the operator that each
-- integration "shows when it was last used successfully", which it did not:
-- an integration doing real work every hour for six weeks still read as last
-- verified six weeks ago, and one whose key was tested this morning and has
-- refused every real call since read as verified today.
--
-- Both facts matter and they answer different questions. A passing test says
-- the credential parses; a successful real call says the thing works for what
-- it is for.

alter table integration_settings
  add column if not exists last_success_at timestamptz,
  add column if not exists last_tested_at  timestamptz,
  -- Where a provider tells us. Free text on purpose: every provider says it
  -- differently, and a number we had to invent a unit for would be worse
  -- than their own words.
  add column if not exists quota_note      text,
  add column if not exists expires_at      timestamptz;

/*
 * The existing column only ever recorded tests, so that is what it becomes.
 * last_validated_at stays for now rather than being dropped: readers of it
 * are being moved over in this change, and a column removed in the same
 * migration that renames its meaning is a rollback nobody can perform.
 */
update integration_settings
   set last_tested_at = last_validated_at
 where last_validated_at is not null and last_tested_at is null;
