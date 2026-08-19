# Brost Co

Government contracting workspace for BROSTCO Holdings LLC. Next.js 14 (App Router)
with a Postgres database and a background worker that runs scheduled agents:
finding solicitations on SAM.gov, reaching out to subcontractors, tracking quotes,
and drafting replies an operator reviews before anything is sent.

- Web app on port 3000, worker on port 3100, both started by the `Dev` workflow.
- Production is brostco.com.

## Environments and databases

`DATABASE_URL` is platform-managed and holds the **production** connection in the
workspace as well, so a shell command here talks to live data by default. The
workspace keeps itself off production by setting `USE_REPLIT_DEV_DB`, which
points the app at the repl's own built-in Postgres instead.

That flag belongs to the workspace only. If it ever appears in a deployment it is
ignored (with a warning in the logs) and the deployment stays on `DATABASE_URL`.
It used to refuse to start instead, which took the live site down completely.

## Getting back into a locked-out account

Two ways in, in order of preference:

1. **The emailed reset link.** "Forgot password?" on the login page. If the site
   cannot send email at all, the form now says so outright instead of telling you
   to check an inbox nothing was sent to.

2. **Break-glass, from the workspace shell.** Sets the password directly and signs
   out every existing session:

   ```
   npx tsx scripts/set-password.ts <email> --confirm
   ```

   It prompts for the new password rather than taking it as an argument, so the
   value stays out of shell history. It prints the database and account it is
   about to touch, and writes nothing without `--confirm`. Without
   `USE_REPLIT_DEV_DB` set in that shell, it acts on the **live** account, which
   is usually the point. Accepts a login alias.

Note that `OPERATOR_EMAIL` / `OPERATOR_PASSWORD` only ever *create* the owner
account when it is missing. Changing those secrets does not reset an existing
password, and a restart no longer overwrites a password set in the app.

## Diagnosing a login problem

`https://brostco.com/api/health` returns `{"ok":true,"db":true}` when the site can
reach its database. If `db` is false, sign-in cannot work for anyone regardless of
password, and the login form will say sign-in is temporarily unavailable rather
than blaming the password.

## Tests

```
NODE_ENV=test npx vitest run
```

`NODE_ENV` is pinned to `production` in `.replit`, so a workflow restart prunes
devDependencies. Restore them with `npm install --include=dev`. Tests refuse to
run against a database that is not disposable.

## Deployment type: Reserved VM is required

The published app must run as a **Reserved VM**, not Autoscale. The background
worker shares the same process as the web server (`npm run start` starts both via
`concurrently`). Autoscale sleeps the instance a few minutes after the last web
request, which kills the worker with it. The shortest scheduled job runs every
10 minutes, so an Autoscale deployment is reliably asleep when each job is due.

Signs that this has drifted back to Autoscale: the Today dashboard shows "The
automation engine is not running" and the production `job_runs` table has a gap
of hours with no activity despite earlier steady runs. The fix is to republish as
a Reserved VM -- no code change needed.

The `.replit` `[deployment]` block sets `deploymentTarget = "vm"`. If it ever
reverts to `"cloudrun"` (which is Autoscale), treat that as a regression and
change it back before the next publish.

## Reading the worker's boot log

The worker narrates every step it takes at startup: `database`, `migrations`,
`operator-account`, `recover-interrupted-runs`, `queue`, `handlers`, then
`ready`. Each line reports how long the step took, and each step has a timeout,
so a step that never returns is logged as STALLED instead of leaving the process
silent. If a deploy's log stops after one of those names, that step is the fault.

The worker also writes a check-in row (`worker_heartbeat`) every 30 seconds with
the step it is on. That is what the dashboard reads, so it can tell three states
apart that used to look identical:

- no check-in, or one that stopped: the engine is gone (usually the Autoscale
  problem above)
- checking in, phase is not `ready`: the engine is alive but stuck starting up
- checking in as `ready` with an old job log: the engine is fine and nothing was
  due, or automation is paused

A queue connection that fails at boot is retried with backoff forever rather
than left half-started, and runs that were in flight when the previous instance
stopped are closed out on the next boot so the Automation Log stops showing work
that is not happening.

## User preferences

- No em dashes in user-visible strings.
