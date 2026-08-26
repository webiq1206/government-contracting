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
| 27 | Recovery sweeps cannot recreate stopped work | Verified | `enqueue` refuses a payload naming a stopped opportunity. Without it, scoring recovery re-queues an aborted opportunity every 15 minutes forever, each refused and logged |
| 7 | Third message disabled unless first-class | Verified | `final_nudge_enabled`, off by default and absent-key-means-off, plus `followup_max > 0`. `tests/final-nudge-gate.test.ts`, 8 tests. No settings toggle, because enabling it today would enable exactly the message the instructions object to |
| 26 | Lint runs and passes | Verified | `.eslintrc.json`; three findings fixed rather than suppressed |

## Corrections made to my own work

Recorded because a ledger that lists only the decisions that went well is not
a ledger.

| What I claimed | What was true | Where |
| --- | --- | --- |
| Jobs that failed during an AI outage "was not retried, so anything queued during the outage still needs a run" | False. `scoring-recovery-sweep` re-queues unscored opportunities every 15 minutes, `stalled-pipeline-sweep` re-runs any stage past its `STALL_HOURS` threshold every 2 hours on a two-strike policy, and `outreach-recovery-sweep` re-sends failed or drafted outreach. Every automated stage has a threshold | Shipped in one commit, corrected in the next. `docs/redesign-traceability.md` carries the full note |
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
