# Provider refusal and health release notes

This change needs migration `125_ai_provider_facts.sql` before the new web and worker code starts. It creates an evidence table only; it does not alter budgets, counters, ledger events, prices, credentials, or saved settings. Apply no production migration or deployment as part of this source-only PR.

Evidence is keyed by provider, the SHA-256 fingerprint of the exact resolved credential, and account scope. Shared platform credentials share a hold; tenant/unknown credentials are scoped to their organization. No raw credential is stored. Replacing a credential starts with unknown health, not inherited success. The app cannot infer that two different credentials belong to the same external billing account.

A permanent refusal persists until a successful explicit connection test on that same scope. Ordinary jobs cannot bypass the hold. Tests still pass through existing metering and spending checks; an exhausted app budget prevents a recovery test even if the owner reports adding provider credits. There is no timer, counter reset, or automatic credit-purchase path. Enabled provider fallback remains subject to its existing configuration and separate provider evidence.

A transaction-scoped, non-waiting advisory lock serializes provider attempts per account/credential across workers. A contending job gets a transient retry result before any ledger reservation or provider I/O. Refusal evidence commits before the lock releases. Existing HTTP-refusal cost treatment and ambiguous-cost reservations remain in the unchanged usage ledger. The tradeoff is one in-flight model request per credential/account scope and one database connection held through that request.

Historical generic agent successes and settings-row timestamps do not establish current AI health. The new table starts without inferred evidence; health is unknown until that credential produces a real observation. No migration guesses permanent billing refusal from an ambiguous historical HTTP 429, or replays work to populate history.

## Release preflight (not performed by this PR)

- Review exact-head unit, typecheck, build, and disposable PostgreSQL CI results, including the real cross-connection advisory-lock regression.
- Confirm the migration target and ordering using the repository release procedure. Verify the runtime role can read/write the new table; untrusted PostgREST roles have no access. Review pool capacity and idle-transaction timeouts for the serialized provider calls.
- Confirm the selected tenant, effective credential source/fingerprint, model routing and unchanged application limits before any separately authorized recovery probe. Owner-reported credits alone do not prove recovery.
- Do not bulk retry, reset usage, merge, or deploy under the patch/test authorization. Recovery testing and release remain separate approvals.
