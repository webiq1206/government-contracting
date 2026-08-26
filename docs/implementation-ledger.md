# Implementation ledger

One row per requirement in the Complete Claude Code Edit Instructions.

Status is one of `Not started`, `In progress`, `Implemented`, `Verified`,
`Blocked`, `Not applicable`. A requirement is not `Verified` until evidence is
attached: a commit, a test name, a query result, or a screenshot.

**The rule this ledger exists to enforce:** the instructions were written
against commit `814dee6`. There are 51 commits since. A finding appearing in
the instructions is not evidence that it is still true, and this ledger
records what was actually checked rather than what was assumed.

## Baseline, established at `21a6316`

| Gate | Result | Note |
| --- | --- | --- |
| `tsc --noEmit` | clean | |
| `next lint` | **was broken** | eslint installed, no config, so the command dropped into an interactive wizard and could never pass. Fixed in `07b24d7` |
| `vitest run` | 2347 passing, 253 skipped | |
| `next build` | exit 0 | |
| `vitest run` with live `DATABASE_URL` | 21 failing | Pre-existing. Integration tests expect a seeded fixture database; `db-live-database-guard` asserts a guard that `ALLOW_TESTS_AGAINST_DATABASE_URL` deliberately defeats. Recorded here so later failures can be told apart from these |

## Verified against the current repository

Findings named in the instructions, checked before any code was changed.

| Instruction claim | Still true? | Evidence |
| --- | --- | --- |
| WP7: hardcoded `lastCallForOrg()` sends a third outreach email | **Yes** | `lib/agents/maintenance.ts:124`. Worse than described: also ignored `followup_max`, quoted the government deadline rather than the quote deadline, and opened a new thread carrying no packet |
| WP2: `job_runs` lacks `org_id` | **Yes** | No `org_id` in any migration through 069. `/agents` read it unscoped through `agentStatuses()` and `jobRunsSummary()` |
| WP2: customer-facing health functions read platform-wide rows | **Partly** | True of `/agents`. Not true of `lib/automation-status.ts`, which had already been written to read `agent_logs` instead precisely because only that table carries `org_id`, so sidebar and Today badges were never affected |
| WP3: Today, Work Queue and Guide Me use different inclusion rules | **No, already fixed** | `buildWorkLedger` is the single decision, and the nav badges share the same SQL constants. But one of its eleven inputs was still passing a capped list's length, so the count was wrong for accounts with more than 8 compliance alerts. Fixed |
| WP5: trade scope falls back to whole-project scope | **Yes** | `resolveSubWork` falls through draft_sow, scope_plain_language, project_overview, then the notice description, all of which describe the whole job. It reports this through `tradeSpecific`, which reached a `gaps` note and nothing else. `validateOutboundEmail` never looked at it, so the send went ahead |
| WP5: special-requirement trade filter is logically unreachable | **Yes, and there was a second one missing entirely** | The scope loop's guard was `if (trade && !mentionsTrade(text, trade) && !SCOPE_RE.test(text)) continue;` one line after `if (!SCOPE_RE.test(text)) continue;`, so the last clause was always false and the `continue` never ran. The condition loop below it had no trade test at all |
| WP2: scheduler checks pause before resolving the organization | **Yes, and worse than stated** | Proved against a real database. The check read `tryResolveTenantOrgId()` with no context, which falls back to LEGACY_ORG_ID, which `scopedKey` maps to the bare key. So it read the FOUNDING organization's switch for every job. Two failures at once: a customer who paused kept running, and the founding organization pausing stopped everybody. The in-file comment defending the ordering was describing an intent the code did not have |
| WP4: solicitation attachments fetched with no SSRF protection | **Yes, and there were two more surfaces** | `lib/agents/solicitation-analyst.ts:238` was a bare `fetch(att.url)` on a SAM `resourceLink`. `lib/integrations/contact-finder.ts` had no guard at all, with `redirect: "follow"` and a whole-body buffer. `lib/integrations/email-scrape.ts` had a guard, and the guard was wrong: see below |
| WP4: the existing `safeFetchPage` guard is sufficient | **No** | Its IPv6 branch tested `startsWith("::ffff:")` and re-checked the remainder as IPv4, but `new URL("http://[::ffff:169.254.169.254]/").hostname` is `[::ffff:a9fe:a9fe]`, so the remainder was `a9fe:a9fe`, matched nothing, and it returned true. The cloud metadata endpoint was reachable through the subcontractor website field. The same dead check existed in my own first draft of `guarded-fetch.ts` and was caught by a test, not by reading it |

## Work packages

| WP | Requirement | Status | Evidence |
| --- | --- | --- | --- |
| 2 | `job_runs` carries a verified organization | Verified | Migration `070`, `tests/job-runs-tenant.integration.test.ts`, 6 tests against a real two-tenant database. Regression-proof checked: 5 of 6 fail with the scoping removed |
| 2 | Customer job queries scoped by organization | Verified | `agentStatuses()` and `jobRunsSummary()` take the tenant from `currentOrg()`; lateral join scoped as well as the outer query |
| 2 | Platform infrastructure health kept separate | Implemented | `platformJobRunsSummary()`, a separate named function rather than an optional argument, reporting the unattributed count as its own column |
| 2 | Backfill only where provenance is provable | Verified | Not backfilled. Nothing in a legacy row identifies an owner: every tenant runs the same roster, so neither agent name nor timestamp says. Legacy rows stay null and are excluded from customer views |
| 2 | Do not trust `payload.orgId` as tenant identity | In progress | The runner writes the owner resolved from the records the payload names, and a record always beats the payload's claim. The raw field is still the seed when a job names no record; that residual is open |
| 2 | Pause check runs after verified organization resolution | Verified | `lib/agents/runner.ts`. `tests/per-org-pause.integration.test.ts`, 6 tests against a real database. Three of them failed before the change |
| 2 | A paused organization stops before any read, write, enqueue, AI call or external action | Verified | The org check sits above every one of those in `runAgent`. Enforcement points (queue enqueue, Gmail, Twilio, email transport, four API routes) go through `isAutomationStopped`, which is either switch |
| 2 | Platform kill switch separated from the founding organization's switch | Verified | New unscoped `platform_automation` key. Before, the bare key was both, so the founding org pausing itself stopped every customer |
| 3 | Capped display lists do not cap totals | Verified | `totals.compliance` added uncapped; Today no longer passes `complianceAlerts.length`, which was `limit 8`. `tests/ledger-totals-not-caps.test.ts` reads the call site, `tests/compliance-total-exceeds-cap.integration.test.ts` proves 20 alerts read as 20 against a real database |
| 3 | Today, Guide Me, sidebar and mobile badges agree | Verified | All route through `buildWorkLedger` and the shared `TRIAGE_WHERE_SQL` / `WORKABLE_CALL_CARD_SQL` constants. Checked rather than assumed |
| 3 | Today filters: Needs attention, Overdue, Due today, Waiting on others, Blocked | Verified | Two axes in `lib/domain/work-queue.ts`: dates and whose-move. `tests/queue-state-axis.test.ts`, 13 tests, including that overdue-and-waiting is found by either filter and by neither "Needs you" |
| 3 | Completed today | Verified, by a different route | Deliberately not derived from the queue: the queue is what is LEFT, so it would give the same answer for "nothing to do" and "everything done". Comes from the activity ledger, which records what happened |
| 3 | `taskFingerprint` | Verified | Exported from the identity `dedupeWorkItems` already keyed on, so a count on one screen and a list on another can be checked against each other |
| 3 | Waiting-on state and responsible party | Implemented | `WorkItem.waitingOn`. Populated from outreach in `sent` state, which was previously invisible: Today could report nothing waiting while eleven quote requests were in flight |
| 5 | A whole-project scope cannot satisfy trade outreach | Verified | `trade_scope_not_ready` blocks the send in `validateOutboundEmail`. `tests/trade-scope-send-gate.test.ts`, 6 tests, including that a request naming no trade is not blocked and that an un-updated caller does not start failing |
| 5 | Requirements from one trade do not reach another | Verified | `belongsToAnotherTrade` replaces the unreachable guard and is applied to the condition loop that had none. `tests/trade-requirement-ownership.test.ts`, 8 tests. Reverting both fixes fails 3 |
| 6 | The exact 18-name variable catalogue | Verified, no change needed | `OUTREACH_VARS` in `lib/domain/outreach-vars.ts` carries exactly the 18 names the instructions list, no more and no fewer. Checked name by name |
| 6 | Retired names blocked with their replacement named | Verified, no change needed | `RETIRED_VARS` maps all four (`contact_first_name_or_there`, `scope_summary_short`, `documents_url`, `reply_deadline_time_zone`) to their replacements. `documents_url` maps to the empty string because it has no replacement, which is a different and honest answer. Enforced at save: `/api/templates/[slug]` returns 422 |
| 9 | Hard blockers cannot be force-overridden | Verified | `force` skipped the whole package check, taking `validation_json.blockers` with it: a missing mandatory form, an unsigned prefilled document, a required item nobody provided, a missing generated artifact, a missing bid PDF. Now refused regardless of force, with `needsForce: false`. `tests/submit-gate.integration.test.ts`, 5 tests |
| 9 | Hard and soft are already separated in the data | Verified, no change needed | `lib/domain/package.ts` puts optional items and a non-reconciling pricing total in `warnings`, which never blocked. The split the instructions ask for existed; what was missing was force respecting it |
| 9 | Skipped AI audit produces a human gate, not an unqualified block | Verified | The one case force still covers: nothing outstanding, audit unconfirmed. Worded as that rather than as "outstanding compliance checks" |
| 7 | Same-thread follow-up uses stored references | Verified, no change needed | `lib/agents/maintenance.ts` requires all three of `gmail_thread_id`, a recoverable RFC822 Message-ID and an inherited `Re:` subject before it will thread. Its own comment names the trap it was written for: having only the thread id makes OUR conversation view look perfect while the recipient receives an unconnected email every time, which is invisible from our side |
| 7 | A missing Message-ID is recovered rather than sent without | Verified, no change needed | Reads the thread back from Gmail and writes the id to `communications.rfc822_message_id`, so the next follow-up needs no repair |
| 7 | A new thread is used only after confirming why, and the reason is stored | Verified, no change needed | `threadGap` names which of the three parts was missing, and is written to the communication's meta as `new_thread_reason` |
| 7 | Provider thread mismatch is visible | Verified, no change needed | When Gmail returns a different thread id than the one asked for, a `thread-broken` warning is logged. Confirming the provider did what was asked, rather than assuming it |
| 11 | No public fallback secret for externally reachable tokens | Verified | `fileToken` signed with `config.auth.secret`, which falls back to a literal in the open-source tree. Now refuses to mint or honour a file token in production on that default. `tests/file-token-secret.test.ts`, 5 tests |
| 11 | Health fails safely without a real signing secret | Verified, no change needed | `/api/health` returns 503 in production on the default secret, and its comment already names document links among what would be forgeable. That is what stops a host routing traffic; it does not stop the process minting tokens, which is what the row above closes |
| 27 | A pursuit state automation checks before acting | Verified | Migration `071` adds `pursuit_state` with `active`/`paused`/`aborted`, separate from `status` (what the solicitation is doing) and `stage` (how far the work got). Overloading either would make an abort indistinguishable from an agency cancellation in every report |
| 27 | The guard is enforced, not merely available | Verified | Checked in `lib/agents/runner.ts` for every queued job, and again in `sendOutreachEmail` at the provider boundary. `tests/pursuit-guard.integration.test.ts` includes the race: read active, abort, read again |
| 27 | No post-abort external send | Verified | The transport re-reads at the boundary rather than trusting the runner's check minutes earlier. A single check at job start passes every test written against a fast fixture and fails exactly once in production, on the message somebody was trying to stop |
| 27 | Fails closed | Verified | An unreadable row, a missing row, and an unrecognised state all answer "may not act". `tests/pursuit-state.test.ts` pins eight unrecognised values, including `"ACTIVE"` and `"activ"` |
| 27 | Abort reasons are structured, with a note required for Other | Verified | `ABORT_REASONS` plus `abortRequestProblem`. A free-text-only reason makes "why do we abandon pursuits" unanswerable in analytics |
| 27 | Restarting is not resuming | Verified | `POST /api/opportunities/[id]/pursuit` refuses `resume` on an aborted pursuit with a 409 that names the revalidation, rather than quietly performing a restart. `tests/pursuit-api.integration.test.ts` |
| 27 | Pause, resume, abort and restart are distinct | Verified | Four actions with different effects: pause preserves and does not bump the version, abort requires a structured reason and bumps it, restart bumps again and promises nothing sends until packets are approved. 10 tests |
| 27 | Abort is idempotent | Verified | Repeating it returns `alreadyAborted` without a second version bump, which would otherwise make an unrelated restart look stale |
| 27 | The abort confirmation shows what stops and what cannot be undone | Verified | `lib/pursuit-impact.ts`, read through `GET /api/opportunities/[id]/pursuit`. Counted from records, never estimated. `tests/pursuit-impact.integration.test.ts`, 9 tests |
| 27 | Already-sent messages are named as unrecallable | Verified | The half products get wrong. An abort does not reach into another company's inbox, and the summary says "cannot be recalled" in those words rather than implying the emails were pulled back |
| 27 | Typed confirmation is specific to the record | Verified | The solicitation number when there is one, a short piece of the title otherwise. Not the word "ABORT", which is muscle memory and proves nothing about which opportunity is on screen |
| 27 | Recovery sweeps cannot recreate stopped work | Verified | `enqueue` refuses a payload naming a stopped opportunity. Without it, scoring recovery re-queues an aborted opportunity every 15 minutes forever, each refused and logged |
| 7 | Third message disabled unless first-class | Verified | `final_nudge_enabled`, off by default and absent-key-means-off, plus `followup_max > 0`. `tests/final-nudge-gate.test.ts`, 8 tests. No settings toggle, because enabling it today would enable exactly the message the instructions object to |
| 4 | External URLs fetched through one guarded path | Verified | `lib/integrations/guarded-fetch.ts`. Scheme, destination address and every redirect hop checked before connecting; the size limit applied while the bytes arrive. 43 tests in `tests/guarded-fetch.test.ts`, 8 in `tests/site-fetch-guard.test.ts`. Revert-proof checked on four guards: removing the per-hop address check fails 23, `redirect: "follow"` fails 1, buffering before the size check fails 2, dropping the mapped-IPv6 decode fails 4 |
| 4 | Size limit applied before the download, not after | Verified | The analyst read `Buffer.from(await res.arrayBuffer())` and checked 25MB on the next line, so the cap governed what was parsed, not what was pulled. `readCapped` cancels the reader as soon as the total passes the limit, and refuses a declared length outright. Proved by counting stream pulls, not by catching the throw |
| 4 | Redirects revalidated per hop | Verified | `redirect: "manual"` with the checks re-run on every hop, capped at 5. The test asserts the option on the request as well as the loop behaviour: a stubbed fetch ignores `redirect`, so without that assertion the whole suite passed just as happily with `follow` |
| 4 | No second implementation of the rule | Verified | `tests/outbound-fetch-allowlist.test.ts` scans `lib`, `app/api`, `worker` and `scripts` and requires every direct `fetch` caller to be named with a reason. Three further tests keep the allowlist itself honest |
| 4 | The forty-file cap removed, nothing silently skipped | Verified | `.slice(0, 40)` inside a `Promise.all` is gone. Every attachment is processed in bounded batches of 5 and every one receives a disposition. `tests/extraction-budget.test.ts` proves 57 documents all reach the plan; restoring the cap fails 2 tests |
| 4 | Coverage accounting, honest counts | Verified | The log line reported `attachments.length` while the code had discarded everything past the fortieth, so a notice with 57 attachments logged 57 processed and analysed 40. It now reports on the notice, processed, extracted and a coverage summary naming what was shortened and what was left out, at `warn` when coverage is incomplete |
| 4 | A document that did not fit is a blocker, not a success | Verified | New `not_read` disposition, downgraded from `fetched` only. `evaluateSolicitationCompleteness` raises `documents_not_read` as critical, separate from `unreadable_documents` because "upload a text-based copy" is useless advice for a file that read perfectly and did not fit |
| 4 | Prompt budget shared without tail-dropping | Verified | The old share had an 8,000-character floor per document and no ceiling on the total, so past thirty documents the shares summed past the budget and a final slice dropped whole documents off the end. Water-filling in `lib/domain/extraction-budget.ts`; the assembled text is proved to stay inside the budget at 1, 5, 39, 40, 41, 120 and 500 documents. Restoring the old floor fails 7 tests |
| 4 | Idle timeout as well as a total timeout | Verified | `idleMs`, default 20s. A server that accepts the connection and trickles one byte a minute held a worker for the whole budget; the analyst had no timeout at all before this. The reader is cancelled on the way out however the read ended |
| 4 | Audit logging without exposing credentials | Verified | `redactUrl` keeps scheme, host and path and drops the query. SAM resource links carry `api_key` there. Applied to the hop list and to every place a URL reached a log line or the analysis prompt |
| 4 | Decompression-bomb protection | Verified | `fetch` decodes content encoding before the reader sees it, so the streaming cap counts decoded bytes: a 1KB gzip that expands to 10GB stops at the limit like anything else. Recorded in the module rather than assumed |
| 4 | Archive protection where archives are supported | Not applicable, and a defect found while confirming it | Nothing in this codebase extracts archives: `lib/zip.ts` is a writer, and `tar` is a transitive dependency nothing imports. But an archive was reported as a successfully collected attachment, so an opportunity whose whole package arrived as one `.zip` advanced into sourcing with every requirement inside it unread. New `archive` disposition and a critical blocker |
| 4 | One complete source inventory, every field the instructions name | Verified | Migration `072`. Source system and URL, original filename, content hash, byte size, page count, classification, amendment number, superseded-by, disposition, OCR and extraction state, access state, extraction model and version, received and last-verified times, trade relevance, error and retry state, review state. Written by the analyst on every attachment |
| 4 | Exactly one disposition per source file, nothing silently skipped | Verified | `disposition` is `not null default 'blocked'` with a check constraint, so a row nobody classified reads as "somebody has to look at this", never as delivered. `tests/document-inventory.integration.test.ts` proves it against a real database |
| 4 | An exclusion must carry a reviewable reason | Verified | Database check constraint, not an API rule, so a future caller cannot route around it. An exclusion with no reason is indistinguishable from a file that was quietly lost, which is the state the inventory exists to prevent. `inventoryCoverage` refuses to count one as accounted for |
| 4 | Analysis is not complete merely because the model returned valid JSON | Verified | `inventoryCoverage().complete` requires every file to have a disposition, nothing pending, partial, not read, unreadable or blocked, and no unreasoned exclusion. An empty inventory is not complete either: zero documents is not zero problems |
| 4 | Extraction state written after the fact, not before | Verified | The insert leaves `extraction_state` at `pending`; a second write sets it once the budget has decided what actually fit. Writing "extracted" at insert time would be the same mistake as the log line that counted forty files as fifty-seven |
| 4 | Superseded history preserved | Verified | `superseded_by` is set on the OLD row and is `on delete set null`, so deleting the replacement leaves the document it replaced readable. Proved in the integration test |
| 4 | Per-page extraction with source citation anchors | Verified | `extractPdfPages` keeps page boundaries `extractPdfText` merged away; `withPageMarkers` writes `[p.N]` counted from the document, not from the pages that had text, so a blank page cannot shift every later citation by one. The prompt asks for `source_document` and `source_page` |
| 4 | Every extracted requirement can open its source document and page | Verified | `resolveCitation` maps the model's document name back to a real inventory row before anything is stored, so an invented name becomes no anchor rather than a link to the wrong file, and a page past the end of the document loses the page but keeps the document. `/api/documents/[id]/open?page=N` redirects with the `#page=` fragment. The Bid Brief renders "Read it in PWS.pdf, page 44" |
| 4 | A requirement with no resolvable source says so | Verified | No document id means no link, rather than a dead one. `tests/requirement-citations.test.ts`. Unresolved citations are logged at `warn` with a count, because a model citing a document that does not exist is a signal it was reading less carefully than it claimed |
| 4 | The citation route decides access in one place | Verified | Requirements carry document ids, not storage paths, so the route is the single tenant check. `tests/document-open-route.integration.test.ts`, 6 tests against a real database; removing the org comparison fails 2. Another organization's document and a document that never existed return identical responses |
| 26 | Lint runs and passes | Verified | `.eslintrc.json`; three findings fixed rather than suppressed |

## Corrections made to my own work

Recorded because a ledger that lists only the decisions that went well is not
a ledger.

| What I claimed | What was true | Where |
| --- | --- | --- |
| Jobs that failed during an AI outage "was not retried, so anything queued during the outage still needs a run" | False. `scoring-recovery-sweep` re-queues unscored opportunities every 15 minutes, `stalled-pipeline-sweep` re-runs any stage past its `STALL_HOURS` threshold every 2 hours on a two-strike policy, and `outreach-recovery-sweep` re-sends failed or drafted outreach. Every automated stage has a threshold | Shipped in one commit, corrected in the next. `docs/redesign-traceability.md` carries the full note |
| My first `guarded-fetch.ts` blocked IPv4-mapped IPv6 addresses | It did not. The check was a regex against the dotted spelling `::ffff:127.0.0.1`, which URL parsing rewrites to `::ffff:7f00:1` before the guard ever runs, so the branch was dead code. Rewritten to work on the numeric groups | Caught by `tests/guarded-fetch.test.ts` before the module was wired into anything |
| GitHub Actions had stopped dispatching because a spending limit was reached | Unfounded. Three missed dispatches established that dispatch was failing, not why. It recovered on its own, which a spending limit does not do | Corrected on PR #85 |

## Partly built, and honest about which part

| Requirement | Built | Not built |
| --- | --- | --- |
| WP27 operator control | The pursuit state, the guard, its enforcement at the runner, the send boundary and the enqueue path, and the API for pause, resume, abort and restart | The UI: the deliberate abort confirmation flow with its impact summary and typed confirmation, and the Opportunity Workspace controls. Also `Stop outreach for this subcontractor` and the four distinct call controls (`Skip this call`, `Call later`, `Do not call for this trade`, `Do not call this subcontractor`), which need their own suppression records |

Recorded this way deliberately. The guard is the half that prevents harm, and
shipping it before the controls means an abort set by any route is honoured
everywhere. Shipping the buttons first would have been the half that looks
finished.

## Implemented but not yet surfaced

| Requirement | State | What is missing |
| --- | --- | --- |
| Platform kill switch | Settable through `setPlatformAutomationPaused`, read by the runner, every enforcement point, and `doctor` | No platform-admin control yet. It belongs on the platform System Health page (WP22) and is listed there rather than bolted onto the customer Automation Health page, which is a different audience |

## A note on the live-database baseline

The 21 pre-existing failures recorded above were measured against a scratch
database in one state. Integration tests in this suite share that database and
several are order-sensitive, so the number moves as fixtures accumulate: the
same commit later showed 28.

The baseline is therefore only meaningful when re-measured at `main` against
the database in its current state, immediately before the comparison. Diffing
against a stored list would have reported 25 regressions that do not exist,
which is worse than no baseline at all, because it looks like evidence.

## Blocked

| Requirement | Blocked on | What is needed |
| --- | --- | --- |
| WP26 human usability verification | Participants | Five uncoached contractors, including mobile users. The instrumentation and script are engineering work and are in scope; the sessions are not |
| Section 19 analytics vendor and consent model | A product decision | Which vendor, and what consent model. The constraint that does not need a decision (what an event may contain) is already implemented and tested |
