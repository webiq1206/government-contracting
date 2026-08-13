---
name: Login email aliases
description: One account reachable from several addresses, and why uniqueness needs a lock rather than two independent checks.
---

# Aliases are a front door, not a second identity

Extra sign-in addresses live in an alias table pointing at one user row. There
is no second user row.

**Why:** duplicate user rows make one person into two accounts depending on
which address they typed, and every downstream join then has to guess.

**How to apply:** authentication resolves an alias to the account and then uses
the **canonical** address for the session, the display, and any From line.
Nothing downstream should ever see the alias that was typed.

## Uniqueness spans both tables, and needs a lock

An address may appear at most once across `users.email` and the alias table.
No self-exclusion: an alias that merely repeats its own account's address is
noise. Promoting an alias to primary means deleting the alias first.

The database triggers take `pg_advisory_xact_lock(hashtext(lower(email)))`
**before** their existence check.

**Why:** without the lock, one transaction inserting into `users` and another
inserting into the alias table can each see no committed conflict and both
commit, leaving one address that signs in to two accounts. Application-level
prechecks cannot close that race. This is the strongest version of the bug: an
attacker signing up on somebody's alias would be handed a working sign-in to
an existing account.

**How to apply:** the app-level "is this taken" check is only for producing a
decent error message. The trigger is the actual guarantee.

## Seeding an alias can abort a migration

The trigger *raises* rather than conflicting, so `on conflict do nothing` does
not protect a seed insert. If the address already exists as its own user
account, the migration fails.

That is intentional. Skipping the address quietly is worse: the migration
records as applied and the owner simply finds one of his addresses does not
sign in, with nothing anywhere to say why. The migration fails loudly with a
message naming the conflicting account and what to decide about it.
