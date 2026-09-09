# Admin reliability investigation, September 9, 2026

Baseline: `52cacad81e727ca9c2e553aada9d260e82694b61`.
Branch: `fix/admin-reliability-performance`.

The code changes in this branch were made directly in git. The Replit job
previously submitted was canceled by the owner; no further Replit job was used.

## Confirmed source defects and changes

| Defect | Change | Practical effect |
| :--- | :--- | :--- |
| Session resolution submitted an activity UPDATE, a session SELECT and two membership reads every time a data helper requested the tenant. | One joined session/membership/entitlement read; touch activity only when stale; request-scoped sharing during server rendering. | A recently active session takes one database request instead of four. Separate HTTP requests still revalidate access. |
| Organization and role were selected separately with an unstable tie order. | Resolve them together; use the same deterministic membership ordering in login helpers. | A role cannot come from a different membership in the session result. |
| The dashboard layout awaited task counts, health, pause state, trial meters and inbox aggregation before returning any page content. | Stream navigation status, notices and mobile badges independently from the authorized page, sharing their reads within that render. | Slow badge/health queries no longer gate the entire page. Unknown status does not display as healthy; unavailable pause state disables the toggle. |
| The inbox badge transferred one detailed row per email conversation, then counted in JavaScript. | Apply the existing resolution, delivery-failure and reply precedence in SQL and return one count. | Badge response size stays constant as conversation count grows. Existing native badge-versus-list tests check parity. |
| Time/status health queries lacked tenant-first indexes. | Add migration 112 for agent logs, job history, successful replay lookup and email history. | Allows PostgreSQL to narrow history by tenant and time instead of scanning unrelated history. Actual production query-plan gains still require measurement. |
| Ordinary web database queries could occupy a connection for two minutes. | Web startup supplies a separate process role with a 15-second default query ceiling; worker and migration budgets remain separate. | Stalled web queries relinquish capacity sooner. Explicit `PG_QUERY_TIMEOUT_MS` still takes precedence; `PG_WEB_QUERY_TIMEOUT_MS` can adjust only web requests. |
| Generic auth words matched before Gmail-specific errors, and any phrase containing "too low" was treated as exhausted AI credit. | Classify mailbox auth and missing configuration before generic key errors; do not classify every Gmail network error as revoked authorization. | Gmail authorization failures no longer direct the user to replace an AI key. |
| Health used only the account pause switch and could report healthy without any worker heartbeat. | Include the platform switch; report missing worker check-in explicitly. | The displayed state reflects platform pauses and unverified worker liveness. |
| A tenant's health displayed the entire platform's queued-job count. | Scope the count to the queue-owned `enqueuedByOrgId` provenance. | A customer's backlog excludes other tenants. The platform-admin aggregate remains available. Legacy jobs without provenance cannot be attributed and are excluded from the tenant count. |
| Old errors stayed blocking after an incident was verified recovered, allowing the health page to recreate it. | Ignore errors covered by that tenant and cause's recorded recovery time when building active incidents; retain the 24-hour failure count. | Old history no longer reopens a completed recovery. Later errors and unrelated causes remain active. Historical failures can still show degraded status during the rolling window. |
| Every recovery check called the AI service, including mailbox and queue incidents. | Check the actual dependency: fresh mailbox authorization, queue plus ready worker, database connectivity, or a small AI request. Establish the incident's tenant context for recovery. | A healthy AI response no longer proves a broken mailbox is repaired. AI probes have a short deadline, no automatic retries, and no company-profile injection. |
| Failed queue starts left partially initialized resources behind; queue creation errors were swallowed. | Stop a failed backend before retrying; propagate queue creation errors; bound its PostgreSQL connection/query waits. | Startup can retry without accumulating abandoned pools or falsely claiming the queue is ready. |
| Redis queue startup created a consumer in web processes before handlers existed. | Separate producer startup from explicit worker activation after all handlers are registered; bound producer startup and disable offline command accumulation. | Web requests cannot steal jobs from the worker and fail them for missing handlers. |
| Redis singleton IDs accepted colon-containing caller keys and shared identity across agents and tenants. | Hash the agent, queue-owned tenant and caller key together. | Keys meet BullMQ's ID requirements and unrelated tenants or agents cannot collide. Existing completed-job retention semantics remain unchanged. |
| PostgreSQL enqueue repeatedly recreated already initialized queue metadata. | Share successful and in-flight queue initialization by name, evicting failed attempts. | Ordinary enqueues avoid a redundant metadata operation while new queue failures remain visible and retryable. |
| Shared action buttons and recovery buttons could wait indefinitely, expose raw errors, or process late results after changing records. | Bounded requests, immediate in-flight guards, cancellation on component replacement, safe messages, and a current-status action. | A lost response is treated as an uncertain outcome. Mutations are never automatically retried by the client. |
| Navigation pause failures were silently rolled back in the UI. | Explain failed or unconfirmed changes and link to Automation Health. | Users can check the authoritative state before retrying. |
| Recovery controls appeared for users who could not use them, and incident samples were visible to ordinary customers. | Gate recovery controls by capability and support-session state; restrict raw incident diagnostics to platform administrators; link directly to the relevant integration card. | The repair path matches access and keeps technical details out of ordinary incident cards. |

## Validation

The complete local unit/source suite passed: **4,327 tests in 410 files**.
An additional 734 database/provider assertions were skipped because this workspace
has no configured disposable native PostgreSQL database or live provider setup.
TypeScript, ESLint and the production build passed. The last classifier
refinement also passed all 54 targeted health/lifecycle tests. Native PostgreSQL
checks run in the pull request; use its exact-commit CI results for final status.

The first published commit passed both GitHub CI jobs, including the production
build and native PostgreSQL no-skips gate. All 19 targeted follow-up queue tests
passed. These include producer/consumer ownership,
startup timeout, tenant/agent key isolation and queue initialization tests. Redis
behavior is tested with mocked transports here; a real Redis outage rehearsal
remains a deployment verification item.

New behavioral coverage includes warmed-session query count, cross-request role
and tenant changes, support-session preservation, orphaned membership, lost
mutation responses, malformed success responses, permission guidance, repaired
versus new incidents, missing worker heartbeat, platform pause, dependency-specific
recovery, and queue initialization cleanup. Existing native tests exercise session
revocation, inbox badge parity, recovery replay protection, state transitions and
tenant isolation. No live email, SMS, bid submission, or payment was sent for tests.

The query-count change is a code/test measurement. It is **not** a measured
percentage improvement in production page latency. The streaming change removes
a blocking dependency; it does not claim that every page-specific query is fast.

## Pull-in and release notes

1. Review and merge this branch, or pull this exact branch into the application
   workspace. Preserve any separate, uncommitted Replit work.
2. Back up the database and apply the normal migration workflow, including new
   migration 112. It adds indexes without rewriting existing migrations or rows.
   On large production history tables, ordinary index creation can briefly block
   writers, so use a suitable release window. Do not run the development seed on
   an existing production database.
3. Build and restart using the normal application startup so the web-specific
   timeout setting applies. This branch does not publish the app or restart live
   automations itself.
4. Measure the deployed pages and inspect actual blocked incidents before
   certifying the user's reported failures as resolved.

## Remaining verification and investigation

The managed cloud browser failed before it could inspect the login page. Both
navigation and tab discovery timed out; creating a fresh tab also timed out.
This is a browser-control limitation, not evidence that BrostCo's login is broken.
No production administrator session, live network waterfall, browser console,
viewport interaction, production query plan, queue trace or provider account was
observed in this pass. The complete authenticated desktop/tablet/mobile audit is
therefore **not complete**.

Several large pages still fetch a complete server-side working set before
filtering/paginating it, including platform accounts, communications and parts of
the work queue. Moving those filters into database pagination needs full parity
for counts, selected records, deep links and permission-sensitive actions. This
branch does not claim those views are fully profiled or optimized.

The previous production-readiness report also identifies production-data/RLS
rehearsal and distributed provider/database consistency gates. Those are not
closed by the fixes here. Configuration-specific blockers such as exhausted
provider credit, revoked OAuth grants or missing production schema still need
actual production evidence and, where applicable, the account owner's external
account action. Recovery checks do not invent credentials or bypass such gates.

## Follow-up connectivity and integration investigation

The alternate TinyFish browser successfully issued navigation requests but
received ERR_CONNECTION_CLOSED for the apex homepage and login page. Its content
reader also timed out for the www login hostname. This does not establish that
all users are affected or prove an origin TLS, DNS or application failure.
The local runtime's DNS resolution failed and its HTTPS probe went through the
managed proxy, completed TLS with that proxy, then received no origin headers.
Those results cannot validate the public origin certificate.

The branch now integrates main's API usage ledger. The AI client preserves both
usage attribution and recovery-specific timeouts/retry budgets. Both migration
112 files are retained unchanged: this repository tracks full filenames and
checksums, not numeric prefixes. Apply both pending files through the normal
owner-only release workflow. The conflict was in the shared AI client, not a
proven duplicate-migration execution error.

A separate read-only GitHub diagnostic checks public DNS, TLS and HTTP response
headers for the homepage, login and health endpoint on both hostnames. It uses
no account credentials, does not collect page bodies or cookies, and does not
invoke Replit or paid provider APIs. The workflow retains its dated JSON evidence.
Its result is diagnostic evidence, not a claim that authenticated visual testing
or a full production audit has been completed.

The first independent GitHub check resolved both hostnames to 34.111.179.208,
connected in 51 to 89 ms, and validated their public Let's Encrypt certificates.
All six dynamic requests received no response headers within 20 seconds.
This narrows the observed failure to after TLS establishment; it does not
distinguish a stalled application/database from hosting-edge behavior. Evidence:
https://github.com/webiq1206/government-contracting/actions/runs/34359350581
The follow-up adds the database-independent favicon as a control.

Login's first-run check now uses EXISTS rather than counting every user. Missing
results and database errors remain fail-closed and cannot open bootstrap access.
Combined-suite failures from the ledger integration were traced to omitted
accessibility routes and stale test assumptions. The sweep includes both usage
pages. The platform billing endpoint has behavioral 401/403 tests proving that
unauthorized requests cannot read usage or change billing. The grant test now
executes a fake provider through the real ledger instead of treating a credential
lookup as a billed request; prompt formatting tests mock the accounting boundary.
No database safety checks were disabled.
