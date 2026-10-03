# Provider refusal and health release notes

This change needs migrations `125_ai_provider_facts.sql` and `126_ai_provider_attempts.sql` before the new web and worker code starts. They create the evidence table and durable attempt columns only; it does not alter budgets, counters, ledger events, prices, credentials, or saved settings. Apply no production migration or deployment as part of this source-only PR.

Evidence is keyed by provider, the SHA-256 fingerprint of the exact resolved credential, and account scope. Shared platform credentials share a hold; tenant/unknown credentials are scoped to their organization. No raw credential is stored. Replacing a credential starts with unknown health, not inherited success. The app cannot infer that two different credentials belong to the same external billing account.

A permanent refusal persists until a successful explicit connection test on that same scope. Ordinary jobs cannot bypass the hold. Tests still pass through existing metering and spending checks; an exhausted app budget prevents a recovery test even if the owner reports adding provider credits. There is no timer, counter reset, or automatic credit-purchase path. Enabled provider fallback remains subject to its existing configuration and separate provider evidence.

A short transaction uses a non-waiting advisory lock to claim a durable attempt token per account/credential. It commits and releases its connection before metering or provider I/O. Completion atomically saves evidence and clears only the matching token. A contending job gets a transient retry result without ledger reservation or provider I/O, and scheduled admission sees the pending hold. One provider attempt per scope remains in flight, but no database transaction or connection is held across the model request.

A crash, uncertain claim commit, or failed completion write leaves the token in place indefinitely. Age and explicit connection tests cannot bypass it. This deliberately favors avoiding duplicate potentially billed calls over automatic availability. A known transient callback failure clears its token while retaining the existing ledger's uncertain-cost reservation. Local preparation failures create no provider failure fact. A completion write failure must not be reclassified as provider failure or trigger another provider call on that same scope.

Reconciliation is a separate operator procedure, not implemented as an automatic repair: establish the old worker has stopped, inspect matching ledger/provider evidence and preserve all unknown-cost reservations, then review any correction to facts and the exact attempt token. Do not infer non-execution from age, manually erase a refusal, or bulk clear tokens. If execution/cost remains unknown, retain the hold. There is no new grant, timeout relaxation, automatic takeover, or paid recovery path.

Historical generic agent successes and settings-row timestamps do not establish current AI health. The new table starts without inferred evidence; health is unknown until that credential produces a real observation. No migration guesses permanent billing refusal from an ambiguous historical HTTP 429, or replays work to populate history.

## Release preflight (not performed by this PR)

- Review exact-head unit, typecheck, build, and disposable PostgreSQL CI results, including the real cross-connection advisory-lock regression.
- Confirm the migration target and ordering using the repository release procedure. Verify the runtime role can read/write the new table; untrusted PostgREST roles have no access. Verify normal short-transaction access and pool health; provider calls no longer require long-lived database transactions. Unknown attempts still require reconciliation after a worker crash.
- Confirm the selected tenant, effective credential source/fingerprint, model routing and unchanged application limits before any separately authorized recovery probe. Owner-reported credits alone do not prove recovery.
- Do not bulk retry, reset usage, merge, or deploy under the patch/test authorization. Recovery testing and release remain separate approvals.
