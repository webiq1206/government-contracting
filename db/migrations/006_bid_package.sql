-- 006: submission compliance matrix + assembled bid package.
-- The bid-builder resolves every solicitation requirement into an artifact,
-- assembles an ordered package, and validates it before the operator submits.
alter table bids add column if not exists compliance_matrix jsonb;   -- ResolvedRequirement[]
alter table bids add column if not exists package_manifest  jsonb;   -- PackageItem[] (ordered)
alter table bids add column if not exists package_ready      boolean not null default false;
alter table bids add column if not exists validation_json    jsonb;   -- PackageValidation

comment on column bids.compliance_matrix is 'Every solicitation submission requirement, resolved to satisfied/needs_signature/needs_operator/missing.';
comment on column bids.package_manifest is 'Ordered, correctly-named files that make up the submission package.';
comment on column bids.package_ready is 'True when pre-submission validation found no blockers.';
