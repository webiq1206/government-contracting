# API spending controls

Pull this change, apply migration 113_api_spending_controls.sql with the existing migration-owner workflow, then build and restart both the web process and worker. No production budgets or provider settings are changed by this migration.

## Where to find the controls

Admin, API Usage now places account controls and platform safeguards above the activity filters. An administrator can cap daily platform-key requests across all tenants, or narrow a safeguard to an account, provider or feature. Existing monthly platform-cost caps and pause controls remain available.

Settings, API Usage lets authorized account owners and administrators set daily and monthly dollar allowances, a maximum number of requests per day, pause/resume usage, and allow or pause complex AI tasks. Read-only users can see their budget but cannot change it. A tenant cannot remove or overwrite platform safeguards.

Blank means unlimited; zero stops new admissions. Limits use UTC calendar days/months, not subscription renewal dates. No arbitrary default cap is imposed on existing customers. Start with a daily request limit when reliable pricing is not yet configured.

## Enforcement and cost accuracy

Checks run inside the existing admission transaction before provider execution. The same advisory lock serializes admissions and edits across processes. Account limits cover all instrumented services and both platform and tenant-owned keys. Global daily request limits cover shared platform credentials only. Failed and pending requests count toward request limits because their provider cost may not be zero.

Dollar budgets count confirmed costs plus held request ceilings. Accepted platform usage counts at the customer-facing charge, including the existing service charge; tenant-owned usage counts direct provider cost. Private price multipliers and underlying platform costs are not sent by the budget endpoint. The display is a conservative allowance total, not a finalized bill.

Dollar caps block unpriced requests and unreserved, unconfirmed historical usage. A platform administrator must configure maximum request costs and reconcile actual provider charges using the existing ledger tools. This release does not invent provider costs, release unknown charges as free, or automatically invoice estimates. A provider charge exceeding a configured ceiling can still exceed the app's dollar allowance. Calls made outside BrostCo and non-instrumented services are outside these controls. Use provider-side limits as an additional boundary.

Changes and calendar resets take effect at the next admission. In-flight work may finish. No completed action is replayed, and a failed job is not blindly resubmitted when a cap changes. Scheduled workflows can attempt work again through their normal schedules. The spending incident links directly to API Usage and does not send a paid provider test.

## AI cost reductions

The existing default is Claude Haiku 4.5 for routine tasks, with Sonnet 5 for bid analysis, compliance and learning-loop reasoning. Deployment model overrides remain respected. Explicit complex task selection now passes through budget admission. Routine-only mode holds complex tasks rather than silently lowering the quality of bid-critical work.

Hidden Anthropic SDK retries cannot be reenabled by a caller. JSON repair is limited to one additional metered request. A truncated 400-token task now retries at 800 tokens rather than jumping to 16,384. Large bid analysis retains its 16,384-token initial allowance and 32,768-token retry ceiling.

Existing stable-profile and PDF prompt caching is preserved. Page narration now rebuilds trusted guide facts on the server, so client-supplied guide contents cannot inflate the paid prompt. Page narration and page questions have distinct ledger feature labels.

Model guidance checked September 9, 2026:
https://platform.claude.com/docs/en/about-claude/models/choosing-a-model
https://platform.claude.com/docs/en/models/overview

No live provider benchmark or measured dollar-savings percentage is claimed. Savings depend on task mix, output length and cache reuse.

## Unpriced services and stuck allowances (2026-09-25)

Three rules changed after the founding account's daily allowance stayed exhausted for days while its analyses were refused seven hundred times a day.

- A service with no configured price ceiling (Ahrefs, Google Maps, Hunter, Twilio) is governed by the account's request-count limit, not by its dollar limits. The refusal used to ask the operator to "use a request-count limit" and then ignore the one the account already had. A dollar cap still blocks an unpriced service when the account has no request limit at all, and a platform monthly cap still blocks it unless an administrator has set an explicit platform request limit.
- "Awaiting confirmation" now means a request for a priced service that has no confirmed or estimated cost. Rows for unpriced services no longer hold every other service's dollar allowance, and the refusal names the count so the operator knows what to reconcile in Admin, API Usage.
- A request the provider refused with an HTTP error status (401, 429, 529 and the like) is not billed and no longer keeps its full price ceiling held for the rest of the window. A failure with no status, such as a timeout, keeps its reservation because the provider may have completed the work. Ledger rows left `pending` for more than two hours are closed as failed by the hourly usage job so they stop counting as in flight.

Work that the ledger refuses is now recorded as a hold rather than a failure: the run's log line carries the action `spending-held`, the recap counts it as work waiting on an allowance, and Automation Health keeps showing the blocking spending incident with its repair link. The queue also asks the same admission question before creating a job for an agent that cannot run without AI, so an exhausted allowance stops work from being queued instead of being queued, run and refused every fifteen minutes.

Ahrefs ledger rows are keyed by stable service names (`DOMAIN_RATING`, `BACKLINKS_STATS`, `REFDOMAINS`, `ORGANIC_COMPETITORS`, `BROKEN_BACKLINKS`) instead of endpoint paths, so one price ceiling or request limit per service is enough.
