---
name: Release schema ordering
description: Why publishing can take the entire site down, and the workspace flag that makes a manual migration run hit the wrong database.
---

# Publishing ships code before the schema it needs

The web process starts with a schema gate in front of the server: the gate
verifies the migration ledger matches the migrations the build ships, and only
then hands off to the server. Publishing does **not** run the release migration
job. So a build containing new migrations goes live against a database that
has not been migrated, the gate refuses, the server never starts, and the port
never opens.

The failure is total, not partial. It is not "the new feature is broken" — the
whole site returns a bare `500` from the platform (or `502` between restart
attempts), because there is no application listening at all. A browser renders
that empty body as a blank white page, which reads to the owner as a front-end
bug and sends the investigation in the wrong direction.

Two symptoms identify it immediately, both in the deployment log:

- a `[schema-check]` line naming the exact missing migration files
- `a port configuration was specified but the required port was never opened`

The restart loop means the fix needs no redeploy: apply the migrations and the
next automatic restart picks them up and serves normally.

**Why:** the runtime role is deliberately restricted and cannot migrate, so
applying the schema is a separate owner-credentialed job that a publish does
not trigger. Nothing enforces the ordering between the two, and the gap is
invisible until the new build takes over from the old container — the site can
answer `200` for many minutes after the publish, then fail.

**How to apply:** treat "publish" and "migrate production" as one release, and
run the migration job first. When the site is down right after a publish, read
the deployment log before touching any code — if a `[schema-check]` line is
there, no source change is involved and the recovery is a migration run.

## The workspace flag that redirects a manual migration run

The workspace sets the use-the-dev-database flag, and the migration runner
falls back to the resolved config URL. Running the migrate script bare in the
workspace therefore migrates the **development** database and reports a
cheerful success while production stays broken.

Always pass the production owner connection to the runner explicitly (the
dedicated migration-URL variable takes precedence over the resolved config
URL) and clear the dev-database flag for that one command. Confirm the target
before and after by reading the ledger count over the same connection string
you are about to migrate — not from the runner's own output, which will happily
describe the wrong database.

The deployed environment also reports this flag as set and logs that it is
ignoring it. Code currently defends against it; that defence is the only thing
standing between a config change and production traffic on a dev database.
