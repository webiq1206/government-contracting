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
| WP5: trade scope falls back to whole-project scope | Not yet checked | |
| WP5: special-requirement trade filter is logically unreachable | Not yet checked | |
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
| 7 | Third message disabled unless first-class | Verified | `final_nudge_enabled`, off by default and absent-key-means-off, plus `followup_max > 0`. `tests/final-nudge-gate.test.ts`, 8 tests. No settings toggle, because enabling it today would enable exactly the message the instructions object to |
| 26 | Lint runs and passes | Verified | `.eslintrc.json`; three findings fixed rather than suppressed |

## Corrections made to my own work

Recorded because a ledger that lists only the decisions that went well is not
a ledger.

| What I claimed | What was true | Where |
| --- | --- | --- |
| Jobs that failed during an AI outage "was not retried, so anything queued during the outage still needs a run" | False. `scoring-recovery-sweep` re-queues unscored opportunities every 15 minutes, `stalled-pipeline-sweep` re-runs any stage past its `STALL_HOURS` threshold every 2 hours on a two-strike policy, and `outreach-recovery-sweep` re-sends failed or drafted outreach. Every automated stage has a threshold | Shipped in one commit, corrected in the next. `docs/redesign-traceability.md` carries the full note |
| GitHub Actions had stopped dispatching because a spending limit was reached | Unfounded. Three missed dispatches established that dispatch was failing, not why. It recovered on its own, which a spending limit does not do | Corrected on PR #85 |

## Implemented but not yet surfaced

| Requirement | State | What is missing |
| --- | --- | --- |
| Platform kill switch | Settable through `setPlatformAutomationPaused`, read by the runner, every enforcement point, and `doctor` | No platform-admin control yet. It belongs on the platform System Health page (WP22) and is listed there rather than bolted onto the customer Automation Health page, which is a different audience |

## Blocked

| Requirement | Blocked on | What is needed |
| --- | --- | --- |
| WP26 human usability verification | Participants | Five uncoached contractors, including mobile users. The instrumentation and script are engineering work and are in scope; the sessions are not |
| Section 19 analytics vendor and consent model | A product decision | Which vendor, and what consent model. The constraint that does not need a decision (what an event may contain) is already implemented and tested |
