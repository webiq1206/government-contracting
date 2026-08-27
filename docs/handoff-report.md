# Completion report

The structured handoff the instructions require. Every claim below names its
evidence: a commit, a migration, a test suite, a generated report, or a
query result. Nothing is asserted from memory.

## 1-2. Commits and branch

- **Baseline:** `814dee6` (2026-08-25), the commit the instructions were
  audited against.
- **Ending:** the head of `claude/git-sync-check-nqy8by` at the time this
  report was committed (this file's own commit is the marker).
- **Branch:** all work developed on `claude/git-sync-check-nqy8by`, merged
  into `main` in reviewed batches (PRs #83-#90 and predecessors), 140
  commits, 635 files changed.

## 3. Files changed by work package

Too many to list line-by-line here without the list going stale; the
authoritative grouping is the commit history itself, where every commit
message names its work package and its reasoning. The map from requirement
to change is `docs/implementation-ledger.md` (119 rows verified with
evidence) and `docs/redesign-traceability.md`.

## 4. Database migrations

Migrations `065` through `099` were added by this engagement (35 of them;
baseline ended at `064`). Every one is idempotent (`if not exists` /
`do $$` guards), applies in filename order via `scripts/migrate.ts`, and
was applied to two local databases before ever being committed. Backfills
of note:

- `076` submission evidence: existing submitted bids grandfathered via
  `NOT VALID` constraint, then validated after backfill.
- `081` record ownership: existing records assigned to the founding org.
- `094` dropped three never-written file columns from `compliance_items`
  (added in `091`, nothing ever wrote them; two places for one file, one
  always null).
- `096` template drafts: everything already on file marked `published`, so
  no existing template changed behaviour on migration.
- `097` billing invoices: a new table, no backfill; the page says "charges
  made before this record began are in the Stripe portal" rather than
  presenting an empty list as history.
- `099` account classification: default `customer`, so no account changed
  visibility on migration.

## 5. Requirement ledger

`docs/implementation-ledger.md`. The rule it enforces: a finding appearing
in the instructions is not evidence it was still true - each was verified
against the current repository before being worked, and several were found
already fixed or worse than described (both recorded).

## 6. P0/P1 changes, before and after

The highest-consequence corrections, each with its before/after in the
named commit message:

- Third follow-up emails sent with no packet, ignoring `followup_max`,
  quoting the wrong deadline (WP7) - fixed and round-trip tested.
- A customer's template save rewording every other customer's outreach
  (copy-on-write templates, migration `062/063`); then saves going live
  instantly (drafts + publish, `096`).
- The funnel unable to distinguish "nobody replied" from "replied but would
  not price" - ninth step added without widening the funnel.
- Rule previews disagreeing with the retention sweep they previewed, on
  three predicates, each overstating deletion.
- `/api/files` refusing files from any table not registered in the
  ownership resolver, with a 404 that reads like a missing file - resolver
  table-coverage now enforced by a test that reads the migrations.
- Stripe webhook ordering: a delayed checkout event resurrecting a
  cancelled subscription - ordering guard on applied-event timestamps.

## 7. UI changes by route

`docs/interface-inventory.md` and `docs/redesign-traceability.md` carry the
per-route record. Every operator route was rebuilt or verified against the
shared frame (`PageFrame`), the six-state integration model, the one
attention system, and the approved status vocabulary
(`lib/domain/terminology.ts`, enforced by tests).

## 8. Automation changes and human gates

`lib/domain/automation-health.ts` is the one health model; job runs carry
org, idempotency key, related ids, heartbeat, retries, last error and next
retry (`job_runs`, migrations `070/074`); incidents are grouped by root
cause (`automation_incidents`, `073`). Human gates: pursue/dismiss on
review-tier work, publish on templates, quote confirmation, submission
itself (the platform assembles, never submits), abort-pursuit with typed
confirmation, and destructive settings changes behind impact previews.

## 9. Tenant and security controls

`docs/security-verification.md`. Four ordered gates (session, billing,
tenant, capability), verified by `tenant-isolation-attack.integration` and
eight sibling isolation suites against a real two-tenant database. Storage
keys resolve to owners via `lib/domain/file-ownership.ts`; unknown is
refused, and table coverage is test-enforced.

## 10. Provider-credit recovery

Incident model + recovery check verified in `incident-store.integration`
and `recovery-check.integration`; the browser-verified Integrations page
distinguishes a passing test from real work (`last_success_at` vs
`last_tested_at`, migration `095`), so a provider that recovered reads as
recovered and one refusing since this morning's test does not.

## 11. Tests

`docs/test-program.md` - the commands, both modes, and the skip report.
CI mode: 3,304 passed, 654 conditionally skipped (all database-gated, each
listed with what it needs). Full mode against a real database: 3,958
passed, 0 skipped, 0 failures. Typecheck and production build clean.

## 12. Production-like scenarios

The 36-scenario matrix in `docs/test-program.md` maps each required
lifecycle to the suite that proves it. All run in full mode.

## 13. Visual verification

Screenshots were taken and reviewed at every stage (the working set lives
outside the repo; the repeatable artifact is the sweep). The repeatable
evidence is `docs/accessibility-report.md`: 33 routes x 6 widths x 2
themes, 0 findings, plus `scripts/theme-visual-qa.mjs` for themed states.

## 14. Performance

`docs/performance-report.md`: server render medians at production-like
volumes (5,090 opportunities, 20,061 communications). Every route holds
under 300ms at scale; the table view holds under 100ms.

## 15. Accessibility

`docs/accessibility-report.md`: 0 findings across contrast, tap targets,
accessible names, heading structure and overflow, both themes, six widths.
Coverage is itself test-enforced (`tests/a11y-coverage.test.ts`).

## 16. Known limitations and external dependencies

- Five uncoached usability participants (WP26) cannot be supplied by
  engineering; the protocol, tasks, measures and instrumentation are ready
  in `docs/usability-test-protocol.md`.
- Provider contract drift (SAM.gov, Anthropic, Google, Stripe) is
  observable only in production; the integration facts and Test buttons
  exist for exactly that.
- The analytics vendor and consent decision (instructions section 19)
  remains the owner's call; the current implementation is first-party and
  privacy-scrubbed (`docs/` analytics audit).

## 17. Environment and deployment changes

- `PLATFORM_ADMIN_EMAILS` must list platform administrators (admin routes
  404 without it).
- **`AUTH_SECRET` must not change**: Gmail tokens are AES-256-GCM encrypted
  with it, and rotating it disconnects every inbox.
- No new required environment variables; migrations run via
  `npx tsx scripts/migrate.ts` before the new build serves traffic.

## 18. Rollback

Deploys are commit-addressed; rolling back the application is redeploying
the prior commit. Migrations are additive (new tables/columns with
defaults); the two destructive ones (`094` column drops, `063` orphan
cleanup) removed only never-written or orphaned data, verified before
committing. A rollback past a migration does not require reversing it:
older code ignores the new columns.

## 19. Post-deployment smoke test

1. Sign in; Today renders with the setup checklist truthful for the account.
2. Integrations page: each configured provider shows a verdict, not
   "Connected"; press Test on one and see the timestamp move.
3. Save an outreach template: the draft banner appears, the tab counts it,
   publish puts it live, the send path reads the published text.
4. Billing: the status panel, card, and invoice list agree with Stripe.
5. Admin accounts (as a platform admin): headline counts exclude
   test-classified accounts; open one account through all five tabs.
6. Run one opportunity through score → pursue → outreach preview.

## 20. First-production-run monitoring

Watch Automation Health and `/admin/health` for the first scheduled cycle:
source freshness after the first SAM poll, queue depth returning to zero,
zero incident groups, and webhook health green after the first Stripe
event. The reconciliation panel on `/admin/billing` should list zero
conflicts; any row there is the first thing to read.

## 21. Skip / stop / pause / abort evidence

`skip-scope.integration`, `per-org-pause.integration`,
`pursuit-api.integration`, `pursuit-guard.integration` (in-flight jobs
cannot advance an aborted pursuit), `abandon-deleted-record.integration`.
Distinct tested effects for skip-call, call-later, do-not-call and
stop-outreach are in the call and suppression suites.

## 22. Reverification evidence

`reverification-store.integration` covers the no-change case (a clean
reconciliation recorded as such) and the material-change case (differences
pause affected actions and require review). The seven scopes are the WP29
implementation on the opportunity workspace.

## 23. Competitive benchmark

The lean-operator scenario is preserved as the repeatable evaluation in
`docs/usability-test-protocol.md` (tasks 1-14 map to the ten required
demonstrations), with elapsed time, manual actions, corrections and help
requests as its recorded measures. The machine-runnable halves are the
scenario matrix (section 12); the human-timed halves await the
participants named in section 16.
