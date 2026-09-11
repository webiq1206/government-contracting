# BrostCo redesign implementation

This branch implements a new visual system, simpler workspaces, and a rebuilt public homepage. It preserves the existing application and its domain behavior. It is ready for design and code review; it is **not a production release or a certificate that every requirement in the master brief is complete**.

Base: `4a5461b` on `main`. Working branch: `redesign/complete-platform`. The separate page-loading checkout was not modified.

The latest automated check status is recorded on [draft PR #132](https://github.com/webiq1206/government-contracting/pull/132). Committed evidence files describe their named checkpoints.

## Review the result

Open [review.html](review.html) in a browser. It contains 48 synthetic product and public screens, with 320, 390, 768, 1024, and 1280px width controls and a dark-theme toggle. Native disclosures work. Application navigation, forms, tabs, saves, and transactions in this portable review are intentionally disconnected. It demonstrates layout, not live workflow completion.

The homepage implementation is in `components/marketing/landing-page.tsx`. All seven playable, captioned **guided screen previews** are in `public/demos`. These use actual captured product screens with sample data, but they are not recordings of working interactions. See [media-storyboard.md](media-storyboard.md).

## What changed and why

- A consistent blue, white, navy, and teal palette replaces the gold editorial treatment. DM Sans carries readable headings and body text; dark mode uses the same semantic system.
- Compact navigation uses work-oriented labels: Today, My Work, Opportunities, Calls, Inbox, Reports, Automation, and AI usage. Existing routes and access rules remain.
- Today puts a compact count summary and actionable queue ahead of repeated decision lists, detailed setup, and pipeline analysis. Repeated blockers can be expanded to inspect the affected work.
- Opportunity records have a clear identity, deadline, owner, and next step. Readiness, the complete workflow, and pursuit controls expand on demand. Deep links reveal their containing disclosure.
- The list/detail workspace retains more room for the selected record. Secondary context moves below the record before the primary pane becomes too narrow.
- Focused mobile records and calls use their contextual actions without a second global bottom navigation layer. Profile save controls become persistent when work is unsaved. Settings use a labeled destination selector on phones.
- The activity ledger receives its first page of authorized account data from the server, so the initial render contains activity. Filtering, refresh, error recovery, exports, and subsequent requests retain the existing client behavior.
- The public homepage explains audience, outcome, workflow, human control, pricing, and signup in a deliberate sequence. Five workflow tabs, a hero preview, and a two-minute overview provide product evidence without fabricated customer claims.
- Login and signup are clearer; supporting public pages and account/admin screens inherit the new system. Shared email and generated-document presentation use the new palette. Generated PDF pricing rows now wrap full scope descriptions, preserve short paragraphs across page breaks, and include page numbers. No scope text is truncated to fit a price.

The homepage uses the existing subscription catalog and real signup path. AI usage remains separately billable under existing account terms. No pricing, eligibility, approval, tenant, provider, or job-processing rules were replaced.

## Verification

The full local suite completed with **4,469 tests passed, 735 skipped, and no failures** (434 test files passed, 89 skipped). The skipped tests require the separate database gate. Production compilation and type checking passed. Focused checks after the final media and focus-style adjustments passed.

The production HTTP harness checks all 58 page routes against disposable PGlite fixtures. Content responses and redirects are recorded separately. Additional checks cover saved-view authorization, five compatibility redirects, and the production exclusion of the fixture-only review endpoint.

These results do not establish browser interaction, field performance, payment-provider integration, or complete accessibility conformance. [Release gates](release-gates.md) names the remaining work. [Coverage](coverage.md) distinguishes shared styling, direct workflow changes, captured screens, and open acceptance checks.

The initial published commit also passed GitHub CI, including **798 PostgreSQL integration tests with no failures or skips**. Its desktop browser audit passed. The mobile/tablet checks exposed a stale desktop-only settings selector in the regression script; the follow-up adapts that check to the native selector and retains its URL/history assertions. Require the rerun on the final follow-up commit.

A [three-page sample bid](evidence/sample-bid.pdf) was generated from 24 long synthetic pricing descriptions and reviewed page by page. Its content-preservation regression and the existing document/email tests passed (26 tests).

## Reproduce the local render review

Use a disposable checkout and an ignored local environment file. Do not point the fixture scripts at a real account database. Configure `CI=true`, `BROSTCO_LOCAL_QA=1`, `USE_REPLIT_DEV_DB=true`, `PGHOST=127.0.0.1`, `PGPORT=5544`, `PGDATABASE=brostco_audit`, disposable PG credentials, a disposable `AUTH_SECRET`, `BROSTCO_PROCESS_ROLE=web`, and `PLATFORM_ADMIN_EMAILS=ui-owner@example.test`. Set `DATABASE_URL` to an invalid placeholder that differs from the PG endpoint.

In a fresh fixture environment:

```sh
npm ci
BROSTCO_QA_DATA_DIR=.qa-test-db node --env-file=.env.local scripts/ui-audit/local-database.mjs --prepare
BROSTCO_QA_DATA_DIR=.qa-test-db node --env-file=.env.local scripts/ui-audit/populate-demo.mjs
BROSTCO_BUILD_DIR=.next-release npm run build
BROSTCO_QA_DATA_DIR=.qa-test-db node --env-file=.env.local scripts/ui-audit/route-render.mjs
node --env-file=.env.local scripts/ui-audit/export-screens.mjs
node --env-file=.env.local scripts/ui-audit/build-review.mjs
```

The seed creates private temporary fixture identifiers; never publish that file. Raw HTML, temporary databases, release build output, and raw screenshots are ignored. Only explicitly synthetic review material belongs in this branch.

PGlite omits its unavailable pgcrypto extension declaration only in the disposable preparation helper; production SQL files are unchanged. This is not a substitute for the PostgreSQL 16 CI job. The normal `npm run dev` web-and-worker workflow and production deployment model remain.

## Release and rollback

Keep this pull request in draft while the mandatory gates remain open. Do not merge or deploy based on screenshots alone. Run the existing CI, database, and UI-audit workflows on the final commit and inspect their artifacts.

After the gates close, use the repository's established release process. This change has no schema migration. Rollback is a revert/redeployment of the application commit and its bundled static assets, without reversing database data. Preserve existing sessions, jobs, and account records. Check login, Today, a pursuit, activity, billing access, public media, and error recovery after rollout.
