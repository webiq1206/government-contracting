-- Two holes in "the package is assembled exactly per this solicitation".
--
-- documents.requirement_id
--   An operator upload had no way to say WHICH requirement it satisfied. The
--   submission zip is built from the manifest, and the manifest resolves a
--   file only for the documents the platform generates, so the operator's
--   signed SF-1449, their bid bond and their certificate of insurance were
--   stored against the opportunity and then never appeared in the package
--   they download and send. The archive was only ever the generated half,
--   with a "__PROVIDE_THIS.txt" placeholder standing in for the rest.
--
-- bids.requirements_fingerprint
--   Re-running the analyst after an amendment rewrites the compliance matrix
--   on the OPPORTUNITY, but nothing rebuilt the bid. The package, its
--   manifest and its validation stayed frozen at the pre-amendment
--   requirements and still displayed as ready to submit. The fingerprint
--   records which requirements the package was actually assembled from, so
--   the drift is detectable instead of invisible.
alter table documents add column if not exists requirement_id text;
create index if not exists documents_requirement_idx
  on documents (opportunity_id, requirement_id)
  where requirement_id is not null;

alter table bids add column if not exists requirements_fingerprint text;
