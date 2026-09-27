---
name: Migration ledger baseline
description: Why the checksum baseline pass can stop halfway, and how a deleted migration file strands a production ledger row.
---

# Baselining a checksum-less migration ledger

The runtime schema gate and the release migration runner disagree about ledger
rows whose file no longer exists in the build.

- **The runtime gate ignores them.** It only checks that every file the build
  ships has a ledger row with a matching checksum. An extra row is invisible
  to it.
- **The runner does not.** After baselining, it hardens the ledger by setting
  the checksum column `NOT NULL`. That ALTER sees every row, including one
  whose file was deleted from the repo, and fails with `23502 ... contains
  null values` — *before* pending migrations are applied.

So a baseline run can report "recorded reviewed checksums for N legacy
migration(s)" and still leave the release unapplied. Always confirm the
pending list actually ran; the success line above it is not the outcome.

**Why:** a migration file that gets deleted in a later refactor (a provider
being removed, a feature reverted) leaves its ledger row behind in every
database that already ran it. Long-lived production ledgers accumulate these;
a fresh development database never reproduces the condition, so it surfaces
only at release time, with the site already down.

**How to apply:** before a baseline pass, diff the ledger's row names against
the migration filenames in the build. Any ledger name with no file is a
stranded row and must be resolved first. Three ways out, in order of how much
they preserve: write a sentinel string into that row's checksum (history kept,
no file restored, no source change — the runtime gate never reads it because
it only walks files the build ships), drop the row (the schema it created
stays; only the historical record goes), or restore the file so the baseline
can checksum it. Reading the ledger first also tells you whether the
"cannot verify file checksums" error means a real mismatch or simply that the
checksum column does not exist yet: that message is emitted from a catch
 around the ledger SELECT, so a missing column produces it too.

## Out-of-band objects are not an applied migration

A database object can exist while its migration is still absent from
`_migrations`. An earlier repair may create a function that a pending migration
uses plain `CREATE FUNCTION` to add. The runner then fails with a duplicate
object error before applying that migration's other effects.

**Why:** the isolated development database had the token estimator function,
but no ledger row for the migration that also installs provider rates. Function
presence alone did not establish that the migration was complete.

**How to apply:** when a pending migration collides with an existing object,
compare the whole migration's schema and data effects with the database and
ledger. Do not mark the migration applied or infer its completion from one
matching object; reconcile the verified differences in the isolated target
before resuming the release.
