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

## User preferences

- No em dashes in user-visible strings.
