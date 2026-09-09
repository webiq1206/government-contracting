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
