# Read-only migration134 preservation evidence

The existing Owner production migrations workflow accepts optional inspection
scope `migration134` only with action `inspect`. Its owner secret, independent
target checks, protected environment and serialized concurrency are unchanged.
The ordinary apply path remains the established canonical migration runner.

This inspection reads a UTC repeatable-read READ ONLY snapshot with15second
statement and1second lock limits. It requires the exact approved134 source hash,
no other pending migrations or checksum drift, non-null historical checksums,
the reviewed rate/ledger schema and no user triggers/rules on those tables.

`MIGRATION134_EVIDENCE` contains schema metadata, per-candidate count/SHA256 and
whether each row matches the reviewed insert, plus preservation count/SHA256
for old ledger rows, other rates, fixed historical receipt/hold cohorts, and
nonsecret budget/limit/provider-fact fields. Credential hashes/values and
business message/document payloads are never selected. Existing custom candidate
rows are allowed and must have identical fingerprints after application.

Raw rows exist only in the read-only job's memory; none are logged, uploaded,
stored as artifacts or copied to another recovery location. Only non-sensitive
counts/checksums and schema metadata are retained as ordinary workflow evidence.
There is no new production-data backup or retention period; the existing
recovery package and its cleanup remain unchanged. No recovery payload is
retained past the owner's October19 limit by this extension.

The serializer is explicitly `migration134-pg-jsonb-text-utc-v1`: PostgreSQL
jsonb text for fixed selected fields, rows in explicit stable order, SHA256 of
the UTF-8 JSON array of those strings. UTC timestamps retain database precision;
financial values retain database decimal text. Compare this method only with
itself, not older JavaScript-Date or array-row serializers.

Review pre/post reports: old ledger, other rates and fixed protected cohorts must
match. A preexisting candidate row's fingerprint must match. A previously absent
candidate must appear and match the reviewed insert. The exact134 ledger checksum
must be present afterward and pending/drift empty. A changed concurrently active
provider fact is a discrepancy to investigate, not permission to clear a hold.

The inspection performs no DDL/DML, fixture creation, source import, model
activation, provider calls, worker execution or messages. Apply remains a
separate explicitly authorized workflow dispatch after review of the evidence.
