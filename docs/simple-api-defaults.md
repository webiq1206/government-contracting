# Simple API usage and safe defaults

Apply migration 116_api_safe_defaults.sql with the owner migration workflow, then rebuild and restart web and worker. Free public-data lookups do not consume the paid-request allowance. Spending recovery runs the admission checks for recent workflows without creating events, sending provider calls or using credits.

No live migration or provider request was made while implementing this change.

## Default experience

API Usage shows the current month, three summary figures, a compact spending card and 20 recent records per page. More filters, provider setup, grouped history, platform safeguards and billing tools are collapsed. The new Activity Ledger follows the same approach, and the shared list toolbar shows one primary filter with the rest in its existing filter panel. Saved views are collapsed; active filters remain visible. The main budget editor asks for one monthly amount. Daily caps and model settings are advanced options. Automation Rules now leads with a summary of saved behavior and reveals detailed controls on demand, preserving direct section links and unsaved-change protection. No initial impact-preview request is sent until a rule is edited.

New accounts receive a $25 daily allowance, $250 monthly allowance and 100 paid requests per day. Existing unset limits receive these defaults during migration, but numeric values, pauses and model preferences are preserved. Shared platform credentials get 1,000 requests per day and a $1,000 monthly limit where these were unset. These are protective product defaults, not a promise that every customer's workload fits them. Existing billing consent and API-source choices are never automatically granted or changed.

The platform API preference now resolves the encrypted Settings credential before falling back to deployment variables. Choosing the shared API no longer disconnects an otherwise working Settings-based key. Cards report a configured API source, not an unperformed live authentication check. Existing choices appear only when their editor is opened.

## Cost visibility and enforcement

Published direct Anthropic prices are installed for Haiku 4.5 (including its dated alias), Sonnet 5 and Sonnet 4.6. Custom prices are preserved. Prices are snapshotted at admission, so edits do not silently reprice in-flight requests. Usage tokens produce an estimated cost and a separate budget amount with a 10 percent allowance. Pending and failed calls retain their configured reservation. Unknown services and incomplete usage never become free calls.

Existing successful Claude requests with recorded input/output tokens receive estimates from the configured prices. Unfinished known-model requests receive conservative holds. Actual provider costs and invoice status remain unchanged. No estimates are automatically invoiced or described as confirmed charges. Totals show estimates for priced records and explain that unresolved records are excluded, rather than displaying unknown platform usage as a zero-dollar tenant charge. Account budget figures include held allowances and are not provider bill totals.

Known-model ceilings are conservative full-request bounds, including cache writes and maximum output. Other services or custom models require configured prices before dollar-capped work can proceed. These controls cover instrumented BrostCo workflows, not provider use outside BrostCo. Provider billing remains authoritative; an unexpected price or service change can exceed an estimate. Manual connection-verification requests are separate from workflow metering. Neither deployment nor the migration automatically resumes a deliberate pause or blindly replays previously completed actions.

Pricing source checked September 9, 2026: https://platform.claude.com/docs/en/about-claude/pricing

## Product rule for further pages

Show status, the next necessary action and the information needed for that action first. Keep optional configuration closed by default. Use existing saved preferences; supply protective defaults when none exist. Do not invent required business data, grant permissions, accept charges, enable new outbound communications or delete records as a default. Preserve advanced controls where an authorized operator needs them. A broad visual audit of all other platform pages is not claimed by this change.
