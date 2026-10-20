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

## Why work used to stop for good after one interrupted AI call

Every paid AI call is wrapped in a work receipt (`ai_work_receipts`), and every
scheduled email in a send claim (`communications.delivery_state` queued,
attempting, unknown). Both exist so a lost acknowledgement cannot be billed or
sent twice. Until October 2026 neither had an expiry: a worker restart in the
middle of a solicitation analysis (every publish restarts the worker) left the
receipt pending forever, every later run of that record was refused as "an
unresolved completion", the record never reached sub research or outreach, and
the daily recap reported the analyst failing again each day.

Both now have a lease, listed with every other latch in
`lib/domain/hold-registry.ts`:

- A work receipt is live for 25 minutes (two 10 minute provider aborts plus a
  margin). Past that, admission and the 10 minute hold sweep mark it
  retryable and the scheduled recovery sweep runs the work again, once. A run
  refused inside the lease is logged as `completion-held` (a warning, not a
  failure needing a person).
- A queued send claim that never reached the mailbox is released to `held`
  after 15 minutes, which the next outreach run may send. An attempting or
  unknown claim is settled against the connected mailbox's Sent folder: found
  becomes sent with its message id, not found becomes held. A mailbox that
  cannot be read leaves the row alone and raises the existing alert.

If the recap shows the same record held for more than an hour, the worker is
being interrupted mid-call repeatedly; check the deployment's restarts rather
than the record.

## Why nothing reached outreach in October 2026

Production showed 206 opportunities found in a week, none pursued and no quote
request sent. Three gates were holding everything:

- **The completeness gate held sourcing on bid-only gaps.** A spreadsheet the
  analyzer cannot read, a missing wage determination, an unstated value, or a
  second reviewer's note on the compliance matrix are critical to the bid, and
  still block bid readiness and the package validator. They no longer stop
  scoring or sourcing. Only a missing scope, place of performance, due date,
  solicitation number or agency does (`SOURCING_BLOCKER_KEYS` in
  `lib/domain/solicitation-completeness.ts`).
- **One live AI call refused every other AI job at enqueue.** Calls on one
  provider credential take turns by design. The queue used to refuse to even
  create AI work while any call was running, and most callers treated the
  refusal as done. Now only an unresolved attempt (older than the 10 minute
  provider abort) holds the queue, and a call that finds the credential busy
  waits up to 4 minutes for its turn.
- **Lost hand-offs had no recovery.** The scoring recovery sweep now also
  re-queues the final score for an analyzed record that never got one, and
  the analyst for a record sent to analysis whose job was never created.

Set-asides the company holds no certification for (SDVOSB, 8(a), WOSB,
HUBZone) and due dates inside the minimum lead time are dismissed by company
rules before any paid analysis, as final scoring always did. `npm run doctor`
now counts only mail that actually left the inbox and warns when discovery
works but nothing reaches pursue.

## User preferences

- No em dashes in user-visible strings.
