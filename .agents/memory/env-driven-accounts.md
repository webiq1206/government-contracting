---
name: Environment-driven account provisioning
description: Why boot-time account setup from secrets must create only, never overwrite, and how a test run reached the live database.
---

# Provisioning from a secret is a create, never an update

A routine that provisions an account from environment variables at boot may
insert a missing account. It must never reconcile an existing one toward the
secret.

**Why:** the owner changed their password in the app; the next restart found it
did not match the secret and overwrote it, and they were locked out of
production with "invalid credentials" for a password they had set themselves.
Nothing logged it, so the account looked broken rather than reset. A password
chosen in the app is the more recent intent and outranks a value left in an
environment variable months earlier.

**How to apply:** on a mismatch, warn (naming neither password) and change
nothing. Keep exactly one path that rotates an existing hash — the emailed
single-use reset token — which also means password recovery depends on mail
delivery actually working. Rotating the secret must be a no-op once the account
exists. This applies equally to seed scripts and signup bootstrap routes.

# A test run must prove its database is disposable

Tests here create real users, organizations and jobs, so the run has to be
pointed at a throwaway database by proof, not by assumption.

**Why:** an integration run whose environment lacked the development-database
flag fell through to the platform-managed connection string, which is the same
value in the workspace and in production. Thirty throwaway accounts, seventeen
organizations and their sessions landed in live data, indistinguishable from
genuine signups until someone read the user list.

**How to apply:** refuse the connection at the pool, not in a lint rule. Detect
the runner itself (Vitest exports its own marker into every worker and child) —
NODE_ENV cannot be used, since it is pinned to "production" here and a test run
inherits that. Fail closed when the isolation flag is absent, since its absence
is precisely the dangerous case, and make the refusal name both the flag and the
deliberate override. A child process spawned with a rebuilt environment is still
uncovered; pass a marker through.
