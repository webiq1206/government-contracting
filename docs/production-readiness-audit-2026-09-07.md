# BrostCo production readiness audit

Date: 2026-09-07 UTC

Branch: `audit/production-readiness-2026-09-07`

Baseline commit: `dbbf629`

## Executive verdict

**NO-GO for production release.**

The audited code is materially safer, clearer, and more resilient than the
baseline. The complete non-database test suite passes, TypeScript and ESLint
are clean, and a clean production build succeeds. Major tenant, lifecycle,
delivery, automation, audit, billing, storage, and user-interface defects were
corrected.

Production readiness still cannot be certified. The managed cloud browser has
not reached the BrostCo login page, so the authenticated rendered visual review
remains incomplete. Publication was subsequently approved, and draft PR #112
now runs native PostgreSQL CI. Its first database run applied all 110 migrations
and passed schema verification, then reported 690 passing tests, 34 failures,
and 15 skips. Corrections from that run are awaiting a native retest. Migrations
102 through 110 have not been exercised against a restored production snapshot,
the new row-level-security policies are deliberately staged rather than
enforced for the current table-owner runtime, and live third-party integrations
were not invoked.

Calling this system 100 percent ready under those conditions would be false.
The code changes should remain unreleased until every blocking gate in this
report is completed.

## Scope and inventory

The generated interface inventory contains:

| Surface | Count |
| --- | ---: |
| Pages | 66 |
| API routes | 127 |
| Layouts | 6 |
| Shared components | 185 |
| Domain modules | 176 |

The review traced authentication, account setup, customer and platform-admin
navigation, permission gates, dashboard state, SAM ingestion and
reverification, attachments and extraction, opportunity scoring and pursuit,
subcontractor discovery and verification, outreach and follow-ups, reply
capture and review, call work, bid building and submission, outcomes,
compliance, billing, recaps, recovery, queue execution, storage, platform
automation, support sessions, and account deletion.

Static visual review covered all 40 changed page, layout, and loading files,
all 42 changed shared user-interface components, and the shared CSS. The full
route inventory and source-level coverage tests guard every current operator
route. This is not a substitute for rendered inspection.

## Earlier checkpoint validation results

These are the results before public branch approval. The native CI findings
and follow-up status below supersede the database and publication blockers.

| Check | Result | Notes |
| --- | --- | --- |
| Full Vitest run | PASS with skips | 397 files passed, 87 skipped. 4,265 tests passed, 724 skipped. |
| TypeScript | PASS | `tsc` completed with no errors. |
| ESLint | PASS | No warnings or errors. |
| Production build | PASS | Clean Next.js build compiled, typechecked, generated all 64 static pages, and completed route optimization. |
| Interface inventory | PASS | Regenerated: 66 pages, 127 API routes, 6 layouts, 185 components, 176 domain modules. |
| Diff integrity | PASS | `git diff --check` returned clean. |
| Fresh portable SQL migration and constraint checks | PASS, limited scope | All 110 migration files applied in PGlite; 17 direct SQL probes passed. This is not native PostgreSQL integration or concurrency evidence. |
| Rendered accessibility and viewport sweep | BLOCKED | Requires a functioning browser, authenticated session, and representative data. |
| PostgreSQL integration suite | BLOCKED | No disposable database was configured. The 724 skipped tests include the database-backed workflows and tenant attacks. |
| Live provider validation | NOT RUN | No live email, SMS, call, Stripe, SAM, storage, OAuth, OCR, Ahrefs, or scraping action was sent. |

The first production-build attempt compiled and generated every static page but
encountered a stale local `.next/export` cleanup error. The reproducible build
directory was moved aside and the clean rebuild passed. This was a local build
artifact issue, not an application compile failure.

The normal inventory command wrapper was denied permission to create its local
IPC socket in this sandbox. Running the same checked-in inventory entry point
through Node completed successfully and regenerated the inventory.

## Corrections completed

### Tenant isolation and authorization

- Added tenant ownership guards to high-risk reads, writes, storage paths,
  queue work, SAM records, subcontractor operations, call cards, documents,
  replies, opportunity state, and background agents.
- Hardened token-authenticated vendor and document paths against cross-tenant
  ownership mistakes.
- Scoped reply idempotency to organization and mailbox context so an opaque
  Gmail identifier in one tenant cannot suppress another tenant's reply.
- Added relationship and immutable-owner database guards.
- Added public-schema lockdown and staged tenant RLS policies.
- Preserved shared legacy file bytes with a boolean-only exact-path check while
  removing the unscoped compliance-document scan.
- Made missing, unreadable, or conflicting tenant context fail closed rather
  than falling back to a default customer.

### Admin and support-session safety

- Made impersonation start and stop atomic with their required audit records.
  Cookies change only after commit.
- Kept the impersonation banner visible when exit fails and added an
  actionable error instead of silently leaving the operator stranded.
- Made privileged account, invitation, billing mirror, concession, credential,
  role, ownership, suspension, deletion, purge, and platform-automation changes
  commit with their audit record on the same database client.
- Serialized owner-role changes to prevent concurrent last-owner demotion.
- Made account exports identify incomplete tables and return partial status
  rather than presenting incomplete output as complete.
- Kept support sessions read-only, blocked money-moving and outbound-contact
  actions, and made unreadable support-session state block sending.

### Authentication and account management

- Made password reset token locking, password replacement, token consumption,
  and session revocation one transaction.
- Added actionable reset, password, session, bootstrap, logout, and account
  load failures.
- Distinguished a missing HTTP request context from a database or session
  failure so schedulers can run without turning real auth faults into anonymous
  success.
- Added migration checksum verification and an explicit, one-time baseline
  path for legacy migration rows. Runtime web and worker processes verify the
  schema but no longer apply owner migrations.

### SAM, solicitation, document, and scoring workflows

- Hardened SAM normalization, discovery, tenant scoping, daily-call accounting,
  attachment identity, document inventory, OCR partial failures, extraction
  completeness, citation readiness, verification history, and downstream
  scoring invalidation.
- Required verification agents to carry tenant context before database or
  provider access.
- Provider, search, scrape, SAM, and document failures now remain unverified,
  create attention state, and return failed results instead of becoming a
  false "not found" or successful verification.
- Prevented incomplete upstream attachment packages from entering outreach or
  bid workflows as if they were complete.

### Opportunity and bid lifecycle

- Added guarded lifecycle transitions and compare-and-set behavior for pursue,
  decline, submission, sent, outcome, closeout, recovery, and package states.
- Locked approved and sent bid artifacts against late worker rewrites.
- Made submission approval and its audit evidence atomic.
- Prevented stale, duplicate, skipped, interrupted, and late-running jobs from
  moving an opportunity backward or replaying completed work.
- Kept closeout follow-up and call cleanup in the same transaction as the
  lifecycle transition.
- Made partial package, pricing, requirements, document, and provider failures
  visible and retryable.

### Subcontractor outreach and replies

- Made all outbound email paths fail closed when the configured sender identity
  is missing, unreadable, incomplete, or not a verified Gmail send-as address.
- Preserved tenant, opportunity, pairing, thread, Gmail, RFC message, outreach
  sequence, and reply-correlation identity through sends and replies.
- Hardened reply ownership, idempotency, weak-match review, quote finalization,
  partial-scope replacement work, and post-commit failure reporting.
- Added tenant-scoped skip and undo behavior. A skipped call creates a linked
  suppression, and undo only lifts the rule created by that exact skip.
- Made call preparation, workspace history, caller identity, active pairing,
  and suppression reads fail closed.
- Made backlink and subcontractor verification distinguish a failed crawl from
  an inspected page with no contact details.

### Automation, recovery, and attention state

- Required a durable job-run row before agent work begins.
- Persisted structured failed results as failures and prevented successful
  parent work from replaying just because a downstream enqueue failed.
- Converted missing downstream job identifiers, follow-up reads, fanout,
  bounces, reply polling, notification delivery, scoring recovery, deadline
  messaging, and maintenance failures into explicit failed or attention state.
- Added an atomic platform automation emergency switch and audit trail.
- Updated dashboard and health surfaces to distinguish unknown, delayed,
  blocked, overdue, partial, and failed data from zero or success.

### Billing, compliance, and external state

- Hardened Stripe event claiming, invoice and payment-state reads, promotion
  handling, quota failures, notification delivery state, card-capture failures,
  and reconciliation messages.
- Made compliance item changes, documents, state, history, and audit records
  transactional where they share PostgreSQL.
- Stored the exact compliance-document backend so deletion and retry do not
  guess where bytes live.
- Kept retry targets intact when storage deletion or history writes fail, and
  reported failed compensating cleanup.

### User interface and responsive source fixes

- Added visible errors for load, empty, partial, save, retry, send, integration,
  account, dashboard, preview, recap, and automation failures.
- Prevented modal overflow on short mobile viewports and added focus containment
  to blocking dialogs.
- Fixed narrow-screen wrapping for integration credentials, status, masked
  values, and actions.
- Increased undersized controls to 44 pixel touch targets across reply,
  guidance, submission, billing, sent, trial, and filtering surfaces.
- Added explicit button types where an action could accidentally submit an
  enclosing form.
- Preserved primary actions, selections, and retry context after partial or
  network failures.

## Database migrations prepared

| Migration | Purpose |
| --- | --- |
| 102 | Lock newly added public tables away from public API roles. |
| 103 | Scope inbound reply idempotency to the organization. |
| 104 | Preserve historical actors while allowing safe account deletion. |
| 105 | Make approved and sent bid artifacts immutable. |
| 106 | Add tenant relationship, ownership, and cross-tenant write guards. |
| 107 | Install staged tenant RLS policies and restrictive boundaries. |
| 108 | Add durable billing-notification delivery state. |
| 109 | Record compliance-document storage backend and integrity indexes. |
| 110 | Link call-skip suppressions to their exact source action. |

These migration files passed source and contract tests. They have not been
applied to a disposable clone in this environment and must not be applied
directly to production as their first execution.

## Authenticated visual audit blocker

The browser failed before an authenticated BrostCo page could be inspected.
The observed cloud browser sessions were:

- `-7641-47e4-9b11-92bd6bb4f035`: tab discovery and navigation timed out.
- `-75fc-4e14-a557-6f2134b03af6`: tab creation and listing timed out.
- `-df49-4c77-b47f-dc4baa495be6`: first tab listing timed out after usage reset.
- `-e458-4fde-9742-ae205a9a62e6`: fresh tab creation timed out.
- `-8996-41b0-9b80-857e333540c0`: blank tab 10 opened, but the first navigation
  to `https://brostco.com/login` timed out in `Page.navigate`; the next state
  read also timed out.
- `-1c64-4481-9204-1fe2ddff3c32`: a new blank tab opened, but the first
  navigation to `https://brostco.com/login` timed out in `Page.navigate`. The
  documented fresh-tab recovery then timed out and reset the browser runtime.
- `-efc4-4fe1-8fe4-6b01000f10a1`: the final clean reconnection selected Chrome,
  but creating its first tab timed out and reset the browser runtime.

The sanctioned browser interface exposes no launch or connection
`protocolTimeout` setting. Its available timeout options only wrap waits and
cannot change the failing CDP navigation operation. No BrostCo page content was
returned, secure browser authentication was never invoked, and no credential
was requested, read, or entered.

This evidence identifies a managed cloud-browser control failure. It does not
identify a BrostCo login defect. It also means none of the following can be
honestly marked complete:

- admin login and secure authentication;
- rendered review of every page, section, widget, CTA, action item, and modal;
- desktop, laptop, tablet portrait, tablet landscape, and phone interaction;
- live focus order, contrast, tap-target dimensions, overflow, and screen
  reader naming;
- real role-by-role control visibility and navigation;
- real loading, offline, interrupted, and partial-completion behavior in the
  deployed application.

## Workaround investigation and additional SQL evidence

The connected BrostCo Replit project is published at `https://brostco.com`.
Replit's read-only inspection reported a working development preview and a
built-in development PostgreSQL server separate from its published Neon
database. It reported its workspace on `main` at
`9ab0d3860b3f44faae0044480ffc682a882140d2`, with `dbbf629` in history. The
audit branch was absent from that workspace and its remote listing when
checked. These are hosting-agent observations, not independent visual proof.

Replit reported that a separate worktree can test the audit branch without
changing the published app. Public screenshots work in that environment, but
its screenshot tool has no authenticated session, and it reported that browser
binaries were not installed. Public screenshots cannot establish coverage of
authenticated admin pages. The exact audit version must be transferred before
that environment can verify these fixes.

The managed browser retry selected Chrome `-3432-4290-9e5c-27d200dea7be` and
created tab `7`. Navigation to `/login` again failed with `Page.navigate timed
out`; the subsequent visible-DOM request timed out and reset the session.
There was no site response establishing a login or bot-detection problem.

A supported alternative is the ChatGPT desktop browser extension, configured
through Settings > Computer Use. It can operate the user's signed-in browser
when available to their workspace. This cloud conversation does not currently
expose that browser. See the official
[browser extension setup](https://learn.chatgpt.com/docs/chrome-extension).

System PostgreSQL installation failed on environment user/group restrictions.
A portable PGlite database was installed outside the application dependency
tree and created with synthetic data only. Running the migration program as
its child process applied all 110 migration files successfully. Seventeen
direct SQL checks passed:

- exact migration ledger checksums and enabled immutable-owner triggers;
- valid tenant derivation and rejected mixed-tenant pairings and quotes;
- blocked tenant reassignment and caller-setting bypass attempts;
- blocked direct analytics owner removal, with actual organization-deletion
  retention preserved;
- rejected unowned core records and mixed-tenant backlink references;
- independent tenant backlink identity;
- restricted-role tenant-only reads and rejected cross-tenant inserts;
- hidden cross-tenant updates/deletes, missing-context denial, and
  transaction-local context clearing on rollback.

The portable socket adapter was not reliable enough to substitute for the
native integration suite. Its first two-file run reported 13 passes and one
failure; a serial retry produced connection failures. Direct SQL proved that
the apparent analytics-owner failure was not reproduced by the underlying
constraint. No application protection was weakened to accommodate the adapter.
These transport runs are diagnostic only and do not reduce the 724 tests
awaiting native PostgreSQL verification.

CI now includes a separate disposable PostgreSQL 16 service job that applies
and verifies the exact migration files, seeds defaults, and selects all
integration suites plus the two mixed database suites. It explicitly enables
the restricted-role RLS probes. It supplies no production credentials and
blocks external network access during tests. A report gate rejects empty,
failed, or skipped database runs. This job is prepared and still awaits its
first remote execution; it is not a passing production gate yet.

The CI setup passed TypeScript, ESLint, YAML parsing, and diff checks. A local
network-guard probe allowed a loopback HTTP fixture and rejected external
fetch, TCP, and TLS attempts. The report gate accepted a passing fixture and
rejected skipped, empty, and failed fixtures. These validate the harness, not
the native database workflows it will run remotely.

The implementation was checkpointed locally as `0c0d59a`, covering 467 changed
files. The attempted push of `audit/production-readiness-2026-09-07` was blocked
by automatic approval review because the target GitHub repository is public
and explicit permission to publish this unpublished source and security
payload was not established. No alternate publication path was attempted.
At that checkpoint no remote branch or draft PR was created. Explicit approval for that public
branch publication is required before transferring the exact fixes through
GitHub into CI and the isolated Replit worktree.

## Approved publication and native database follow-up

The user subsequently approved public publication. The exact checkpoint tree
was published in [draft PR #112](https://github.com/webiq1206/government-contracting/pull/112),
with remote commit `032238c79320d136c65438357baabd8f42302a50`. The CI typecheck,
unit tests and production build completed successfully.

The first native PostgreSQL 16 run applied all 110 migrations and passed schema
verification and seeding. Across 91 selected files, 690 tests passed, 34 failed,
and 15 were skipped. The restricted-role RLS and tenant database guard suites
passed. This is partial evidence, not a passing release gate.

The second native run at remote commit `4467c3e735f8d672b4b260603d82459e22368cc5`
reported 737 passes, one failure, and no skips across the 91 selected files.
The remaining failure identified a suppressed activity-log explanation for an
ambiguous trade quote. That explanation and the incorrect "no longer active"
copy were corrected locally and await the next native run.

The follow-up changes correct an ambiguous bid-rebuild SQL column, preserve
durable abandonment records for deleted or malformed jobs, retain safe tenant
context throughout outreach and reply dependencies, validate reply parent
ownership before extraction, scope outbound reply updates, and retain screenshot
uploads under the feedback account. Mixed-tenant job refusals are logged without
foreign record links or identifiers. Test fixtures were also corrected to use
editable pricing stages, current rebuilt packages, valid confidence labels,
immutable account ownership, explicit trade context, and strong decline
correlation. They do not weaken the production safeguards.

The three production-owner data assertions were separated into an explicit,
opt-in production read-only test file. Disposable CI cannot prove the actual
owner's account history. Those assertions remain a separate outstanding gate
and now fail if the expected account is missing instead of silently returning.

An isolated Replit test-environment request was started before the user asked
that all code and design implementation be performed locally. No further Replit
implementation work will be requested. Code fixes and verification proceed on
the audit branch, with merge held until the remaining gates are complete.

## First reported rendered preview observations

Replit subsequently reported an unchanged, detached copy of remote commit
`032238c79320d136c65438357baabd8f42302a50` running against a separate disposable
database. It reported 21 synthetic-account captures covering selected Today,
Opportunities, Subs, Settings, All accounts, empty-tenant, denied-admin, and
missing-record views at 390, 820, 1440, and 1920 pixel widths. It reported no
horizontal overflow on those views. Workers and live providers were disabled.

The connector returned text only. Actual screenshot attachments or accessible
download links have not reached this workspace, so these observations are
hosting-agent reports, not an independently completed visual audit. They cover
only part of the page, role and state matrix and do not cover the user's actual
production admin session. Subsequent evidence-retrieval calls timed out or
reported that the hosting agent was still busy.

Local source inspection confirmed a countdown hydration defect and navigation
paths with no pending feedback. Local fixes add stable first-render countdown
and greeting text, visible pending navigation feedback, settings/admin loading
boundaries, and filter progress. A separate login failure was also corrected:
a rejected or stalled network request could leave Sign in disabled forever.
Sign-in now times out, explains network or server failure, preserves retry,
and requires an explicit successful response. All implementation changes are
made locally, as requested by the user.

## Requirement-by-requirement evidence

| Requirement area | Current evidence | Release status |
| --- | --- | --- |
| Pages, navigation, forms, filters, menus, CTAs | Complete source inventory, static coverage tests, production build | Rendered interaction blocked |
| Clear errors and recovery | Failure injection tests and explicit UI/API state fixes | Live provider faults unverified |
| Attention, deadlines, priorities, next steps | Dashboard, queue, state, and copy tests | Representative production data unverified |
| Loading, empty, success, warning, error, offline, partial | Source review and targeted component tests | Rendered and network-interruption matrix blocked |
| Cross-page data synchronization | Domain and route tests | Database integration skipped |
| SAM discovery through scoring | Mocked normalization, routing, failure, completeness, and tenant tests | Live SAM and real attachments unverified |
| Subcontractor discovery through bid collection | Agent, outreach, attachment, follow-up, reply, suppression, and lifecycle tests | Live providers and database round trip unverified |
| Reply-to-tenant and thread integrity | Idempotency, matching, threading, review, sender, and isolation contracts | Real Gmail inbox round trip skipped |
| Skip, pause, retry, reverify, cancel, abort | State-machine and failure-injection tests | Real interrupted worker processes unverified |
| Roles, permissions, tenant boundaries | Route inventory, guards, source scans, and unit attack cases | Two-tenant PostgreSQL attack suite skipped; staged RLS not active |
| Responsive mobile-app experience | Static review and responsive source tests | Real screenshots and device interaction blocked |

## Remaining release blockers

1. **Authenticated rendered review:** obtain a functioning managed browser,
   authenticate through the secure browser-authentication interface, and run
   the complete role and viewport matrix.
2. **Disposable database validation:** restore a current production snapshot,
   run migrations 102 through 110, run all 724 skipped tests, and execute the
   tenant-isolation verifier using the exact proposed runtime role.
3. **Active database isolation:** complete the restricted runtime-role work in
   `docs/rls-enforcement-plan.md`. Migration 107 enables policies, but the
   current table-owner runtime can still bypass them.
4. **Live integration sandboxes:** validate SAM, Gmail OAuth and send-as,
   delivery and reply round trips, Stripe test mode, storage, OCR, Ahrefs,
   scraping, SMS, and any call provider with non-customer fixtures and
   controlled destinations.
5. **Distributed consistency:** add durable reconciliation or outbox handling
   for provider-success/database-failure gaps. Important remaining examples
   include Stripe plus local state, email delivery plus local history, storage
   deletion plus database rollback, and invitation delivery after commit.
6. **Quota concurrency:** replace read-then-act quota checks with atomic
   reservations for concurrent billable actions.
7. **Historical evidence:** backfill or explicitly classify old approved bids
   that predate immutable snapshots and old files whose storage backend or
   tenant owner cannot be proven.
8. **Operational release rehearsal:** exercise worker shutdown, webhook pause,
   migration locks, checksum baseline, canary startup, monitoring, rollback,
   and reconciliation before production traffic resumes.

## Required release sequence

1. Repair or replace the managed cloud-browser session and complete the full
   authenticated visual and accessibility sweep at 360, 430, 820, 1180, 1440,
   and 1920 pixel widths for every role and relevant data state.
2. Restore a recent production snapshot into an isolated environment. Never
   use production as the test target.
3. Pause all writers, workers, scheduled jobs, and inbound webhooks in the
   rehearsal environment.
4. Review the existing migration ledger. Use the legacy checksum baseline flag
   only once, only after matching every previously applied file to trusted
   source history.
5. Apply migrations 102 through 110 with the migration-owner credential.
6. Run the schema and tenant verifier with separate owner and restricted
   runtime credentials, then run the full database and RLS integration suite.
7. Complete the live sandbox workflow matrix, including duplicate, delayed,
   rejected, partial, interrupted, pause, retry, cancel, and recovery cases.
8. Fix every new finding and rerun the complete test, browser, database,
   provider, accessibility, edge-case, and performance suites.
9. Perform a controlled canary with rollback credentials, queue and provider
   reconciliation, and explicit release sign-off.

## Change and safety status

- Changes are on `audit/production-readiness-2026-09-07`, with the initial
  checkpoint published in draft PR #112 and native-test corrections in progress.
- Nothing was deployed or pushed to production.
- No production database was mutated.
- No live email, SMS, call, outreach, payment, or bid submission was sent.
- No browser credential was accessed.
- The audit implementation, tests, migrations, and CI setup are checkpointed
  in local commit `0c0d59a`; this report records subsequent validation and
  publication approval, native CI findings, and follow-up details.
