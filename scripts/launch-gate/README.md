# Launch-gate harnesses

Throwaway-but-reusable scripts that verify production behaviour against a
**running build**, not against the source. They exist because several defects
this repo has shipped were invisible to unit tests and to code reading: a
concurrency race that produced two bid rows for one opportunity, a page that
404s only when you type its URL, a layout that overflows only at 390px.

They are deliberately not part of `npm test`: each one needs a server on
`localhost:3100` and a disposable database, so they are run by hand during a
release gate.

## Setup

```bash
# 1. a disposable database with every migration applied
createdb brostco_gate
DATABASE_URL=postgres://…/brostco_gate npx tsx scripts/migrate.ts

# 2. a real production build (not `next dev` — these test the built output)
npx next build
APP_URL=http://localhost:3100 AUTH_SECRET=$(openssl rand -hex 48) \
  DATABASE_URL=postgres://…/brostco_gate npx next start -p 3100
```

**Never point `DATABASE_URL` at production.** `lib/db.ts` refuses to connect
under test unless the database is explicitly marked disposable, and these
scripts write and delete rows.

## The scripts

| Script | Proves |
|---|---|
| `bid-race.mjs <opportunityId> <orgId>` | Two concurrent bid builds converge to **one** bid row. Caught the duplicate-row defect fixed by migration 058; re-run it to catch a regression. |
| `idempotency.mjs <email> <password>` | Double-clicks and concurrent writes (notes, agent runs, requirement toggles) produce no duplicate rows and no 5xx. |
| `ui-sweep.mjs <email> <password>` | Every authenticated page returns 200 with no console errors and no redirect-to-login. |
| `mobile-viewport.mjs <email> <password>` | No horizontal overflow at a 390px viewport; writes screenshots to `/tmp/e2e/`. |

The browser scripts need Chromium. In an environment where Playwright's own
download is skipped, point them at the installed binary — they already use
`executablePath: '/opt/pw-browsers/chromium'`.

## Cross-tenant checks

Tenant isolation is covered by the test suite proper
(`tests/tenant-isolation-attack.integration.test.ts`), which runs against a
seeded two-org database and is the authoritative check. The gate scripts here
cover the things a test process cannot see: the built server, a real browser,
and genuine concurrency.
