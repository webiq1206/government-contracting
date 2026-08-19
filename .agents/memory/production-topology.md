---
name: Production topology and the dev/prod database split
description: Why "connection timeout" here means a sleeping worker, not a busy database, and how development is kept off live customer data.
---

# Connection timeouts in the worker are a sleeping-instance symptom

A long run of `Connection terminated due to connection timeout` and
`timeout exceeded when trying to connect` in the deployment log means the
worker instance was asleep, not that the database was overloaded.

**Why:** background jobs cannot live on a scale-to-zero deployment. The
platform idles the instance a few minutes after the last web request, while the
shortest cron is longer than that, so the instance is reliably asleep when its
next job is due and wakes into stale pooled connections.

**How to apply:** put the worker on an always-on deployment. Do not respond to
these errors by tuning `idleTimeoutMillis` / `connectionTimeoutMillis`; that was
already tried once, did not work, and left a misleading comment behind
explaining the pool settings as a fix for exactly these errors. Before believing
the database is at fault, check connections in use, sessions
idle-in-transaction, and cold connect latency from an always-on host; when those
are healthy, the instance is the problem. Scale-to-zero saves nothing for this
shape of workload anyway, since the worker must be awake around the clock
regardless.

# Development and production must not share a database

**Why:** they did, and the consequences were invisible. The development worker
executed real customer jobs against live data including outbound email, every
workspace restart killed production work that was in flight, two schedulers
double-enqueued every cron, and the automated tests ran against production rows
(which is why several integration tests only passed against polluted live data
and went green the moment development got its own database).

**How to apply:** the platform-managed connection variable holds the same value
in both environments, so it cannot be repointed per environment. Make the split
opt-in from the development side with its own flag, scoped to the development
environment only, resolving to the repl's separate built-in Postgres. Then
production needs no change at all, which is the property that makes the change
safe to ship.

What makes the split trustworthy rather than merely present is that it fails
closed: refuse to boot if the flag appears in a deployed environment, if
production's URL cannot be parsed to compare against, or if both endpoints
resolve to the same server. A flag that says "you are safely on development"
while the writes land in production is worse than sharing openly.

Redirecting the data is only half of it. Credentials alone are enough to reach
a real inbox, so the same flag must close the mail sink, at the transport every
sender passes through rather than at one caller. Do not exempt the test suite:
tests that mock the transport never reach the guard anyway, and a test that
does reach it is attempting a real send.

# Proving a database change did not touch production

Row-count every table before and after and compare, and pin one recognizable
recent row. Only a count that went *down* is a problem; growth is normal use.
A verified backup means one that was actually restored somewhere disposable and
had its counts compared, not a dump file that exited zero.

# A publish that dies mid-typecheck is memory, not a code error

A failed build whose log stops inside `Checking validity of types ...` with no
`Failed to compile` and no error text was killed, not rejected. Two other tells:
it ends far sooner than a healthy build, and the same commit builds clean under
the publisher's own conditions (production mode, dev dependencies pruned, empty
`.next`).

**Why:** the build machine is small and this build peaks near its ceiling, with
the platform's security scan running alongside it. Nothing is wrong with the
code, so the first move is to publish again rather than to change anything.

**How to apply:** reproduce with a production-conditions build before touching
config, and measure the peak instead of guessing at it. Two plausible-sounding
remedies were measured and both were wrong: raising Node's
`--max-old-space-size` *lifts* the heap ceiling on a small machine, since the
default is already a fraction of total RAM, and splitting the type check into
its own step ahead of the compile measured a higher peak, not a lower one. If a
config change cannot be shown to help, revert it rather than shipping it as a
guess.
