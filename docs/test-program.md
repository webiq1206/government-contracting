# Test program

What runs, what it proves, what is skipped where, and how to run everything
before a release. This is the audit's required skip report: nothing in this
suite is skipped silently, and every conditional skip is listed here with
what it needs and how to run it.

## The two run modes

**CI mode** runs with no database attached:

```
env -u DATABASE_URL -u ALLOW_TESTS_AGAINST_DATABASE_URL npx vitest run
```

Result at the time of writing: **3,304 passed, 654 skipped** across 349
files. Every skip in this mode is the same conditional: a file whose suite
opens with `const d = hasDb ? describe : describe.skip`, which is every
`*.integration.test.ts` file. They are skipped because they write to and
read from a real PostgreSQL database, and a unit-test environment does not
have one.

**Full mode** runs everything against a disposable local database:

```
DATABASE_URL=postgresql://postgres:localtest@127.0.0.1:5432/brostco_check \
ALLOW_TESTS_AGAINST_DATABASE_URL=1 npx vitest run
```

Result at the time of writing: **3,958 passed, 0 skipped**. This is the
release gate. The `ALLOW_TESTS_AGAINST_DATABASE_URL` flag exists so a
`DATABASE_URL` pointing at production can never be picked up by accident:
without the flag, the database-backed suites refuse to run at all.

Setting up the database the full mode needs:

```
createdb brostco_check   # any local PostgreSQL 15+
DATABASE_URL=postgresql://postgres:localtest@127.0.0.1:5432/brostco_check \
  npx tsx scripts/migrate.ts
```

Every integration suite creates its own fixture organizations and removes
them in `afterAll`, so the same database serves repeated runs.

## What is never skipped

Typecheck (`npx tsc --noEmit`), lint, the production build (`npm run
build`), and all 3,304 pure tests: domain rules, route capability coverage,
email rendering, quote and reply parsing, bid arithmetic, terminology,
design-token conformance, the no-em-dash rule, and the meta-tests that guard
the guards (a11y route coverage, storage-key resolver coverage, docs that
quote settings).

## External services

No test calls a live provider. SAM.gov, Anthropic, Google Maps, Hunter,
Stripe and Gmail are exercised through recorded shapes and safe mocks; the
Stripe webhook suite drives the real handler with signed synthetic events.
The one thing that cannot be tested from here is each provider's actual
contract drift, which is what the Integrations page's live "Test" button and
the `recordIntegrationUse` facts are for in production.

## Browser verification

- `npx tsx scripts/a11y-sweep.ts --base <server>` sweeps every operator and
  signed-out route at six widths (360, 430, 820x1180, 1180x820, 1440, 1920)
  in both themes, measuring contrast, tap targets, accessible names,
  heading structure, and horizontal overflow. Current result:
  `docs/accessibility-report.md`, 0 findings over 33 routes. A route the
  sweep user cannot reach is reported as `unreachable`, never measured as
  whatever page rendered instead; the admin routes need
  `PLATFORM_ADMIN_EMAILS` to include the sweep email.
- `tests/a11y-coverage.test.ts` fails the build when an operator page exists
  that the sweep's route list does not cover.

## The production-like scenario matrix

The audit's 36 lifecycle scenarios, and the suite that proves each one
against a real database. Every listed file runs in full mode.

| # | Scenario | Proven by |
| --- | --- | --- |
| 1 | Normal single-trade solicitation | `subcontractor-email-roundtrip.integration` (find → verify → email → reply → quote) |
| 2 | Multiple trades, separate subcontractors | `opportunity-subs.integration`, `needs-matching.integration` |
| 3 | One subcontractor covering two trades | `quote-multi-trade.integration` |
| 4 | Partial coverage, supplemental sourcing | `reply-capture.integration` (partial-scope outcomes), `sub-finder-service-area.integration` |
| 5 | No response | `followup-threading.integration` (due-conversation sweep) |
| 6 | Decline | `reply-capture.integration` (pass outcome) |
| 7 | Wrong contact and referral | `reply-capture.integration` (wrong-contact outcome) |
| 8 | Bounce or blocked email | `bounce-ingestion.integration`, `email-suppression.integration`, `suppression-boundary.integration` |
| 9 | Same-thread follow-up | `followup-threading.integration`, `reply-threading-roundtrip.integration` |
| 10 | New-thread fallback with complete packet | `followup-threading.integration` (fallback body carries the full packet) |
| 11 | Reply that does not match the expected format | `reply-confidence-routing.integration`, `tests/reply-unclear.test.ts` |
| 12 | Ambiguous multi-trade reply | `quote-multi-trade.integration`, `reply-confidence-routing.integration` |
| 13 | Quote in the email body | `reply-capture.integration` |
| 14 | Quote in an attachment | `reply-capture.integration` (attachment extraction path) |
| 15 | Conflicting quote body vs attachment | `reply-confidence-routing.integration` (low-confidence → review, never silently chosen) |
| 16 | Missing attachment | `tests/attachment-package.test.ts`, `document-inventory.integration` |
| 17 | Corrupt or password-protected attachment | `tests/extraction-checks.test.ts` (named as unreadable, never invented) |
| 18 | Oversized packet requiring a secure link | `compliance-total-exceeds-cap.integration`, `tests/attachment-package.test.ts` |
| 19 | More than forty solicitation documents | `document-inventory.integration` |
| 20 | Solicitation amendment | `reverification-store.integration`, amendment-diff units in `tests/` |
| 21 | Deadline change | `reverification-store.integration` |
| 22 | Conflicting requirements | `tests/brief-conflicts.test.ts` |
| 23 | Missing pricing | `pricing-gate.integration`, `submit-gate.integration` |
| 24 | Incomplete bid | `submit-gate.integration` (refused with the missing items named) |
| 25 | User inactivity and escalation | `tests/review-expiry.test.ts` (auto-dismiss timer), `opportunity-transitions.integration` |
| 26 | Paused organization beside an active one | `per-org-pause.integration`, `maintenance-isolation.integration` |
| 27 | Provider credit outage and recovery | `incident-store.integration`, `recovery-check.integration`, `integration-use-facts.integration` |
| 28 | Queue timeout, retry, dead letter, manual recovery | `worker-recovery.integration`, `outreach-idempotency.integration` |
| 29 | Duplicate opportunity | `tests/search-dedupe.test.ts`, ingest dedup in `prospecting-workflow.integration` |
| 30 | Opportunity cancellation | `pursuit-api.integration`, `pursuit-guard.integration` (abort stops downstream work) |
| 31 | Lost bid | `award-outcome.integration` |
| 32 | Awarded bid and contract creation | `award-outcome.integration`, `contract-record.integration` |
| 33 | Manual submission with proof | `mark-as-sent.integration` (evidence required by `bids_submitted_evidence_ck`) |
| 34 | Submission rejection and correction | `submit-gate.integration` |
| 35 | Vendor token expiration and revocation | `tests/vendor-portal-security.test.ts` (token as the credential, expiry, revocation) |
| 36 | Cross-tenant access through UI, API, job, search, export, cache, file, public link | `tenant-isolation-attack.integration`, `ownership.integration`, `agent-runner-scoping.integration`, `scoring-engine-isolation.integration`, `reply-capture-isolation.integration`, `sub-finder-isolation.integration`, `learning-loop-isolation.integration`, `job-runs-tenant.integration`, `compliance-monitor-isolation.integration` |

## Known conditional behaviours worth stating

- `tests/maintenance-isolation.integration.test.ts` and
  `tests/followup-threading.integration.test.ts` drive the same
  platform-wide sweep, serialised by a shared advisory lock
  (`tests/helpers/sweep-lock.ts`). One test in the first file carries a 15s
  timeout because under a fully parallel suite it waits its turn before it
  starts; the wait is load, not a defect.
- The usability program (`docs/usability-test-protocol.md`) is the one part
  of this program a machine cannot run. The script, tasks, measures and
  instrumentation are ready; the five uncoached participants are not
  something engineering can supply.
