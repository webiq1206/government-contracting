# API usage ledger

The change lives in Git. No Replit agent work or production billing action is required to install it.

## Deployment

1. Pull the API ledger branch and install dependencies with `npm ci`.
2. Run `npm run db:migrate` using the established migration-owner connection. Migration 112 must run before either the web application or worker starts. The existing startup schema gate refuses an outdated database.
3. Build and republish the application, then restart the worker so its provider calls use the same code.
4. Open Admin, API Usage. Tenant settings are under Settings, API Usage.

The migration creates new tables and indexes. It does not rewrite historical usage, charge customers, or change existing subscription prices. Roll back application code if needed; preserve the ledger tables and invoice audit trail.

## Implemented behavior

- A durable request entry is inserted before Anthropic, Google Places, Hunter, Ahrefs and Twilio execution. Background agent context supplies workflow and related-opportunity attribution. Network retries get separate entries. Anthropic SDK retries are disabled so invisible SDK retries cannot bypass accounting.
- Credential lookups no longer count as provider consumption. The exact outgoing key is classified against the platform credential and tenant credential. Platform credentials may be encrypted in the founding account’s settings or supplied through deployment variables.
- Anthropic clients do not retain an old key after a source change. Invalid encrypted tenant credentials do not fall back to platform credentials.
- Tenant settings support validated Anthropic, Google Maps, Hunter and Twilio credentials or explicit acceptance of paid platform use. Ahrefs is an existing platform-only website service, so its execution is tracked against its owning account rather than exposing a tenant setting that its workflows would ignore.
- Actual cost and tenant charges use PostgreSQL decimal arithmetic. Confirmed, accepted platform usage generates 1.25 times provider cost. Tenant-owned API use never produces a platform usage charge. The founding platform account is not charged as a customer.
- Unknown costs remain unknown. Provider-returned Twilio prices are captured when available; other prices can be confirmed from provider evidence. Configured unit prices generate estimates, not confirmed customer charges.
- Admin and tenant endpoints use separate projections. Underlying costs, price evidence, reservations, markup and margin are never sent by the tenant endpoint. Client database access to the new tables is denied with RLS; application server guards follow the existing owner-runtime architecture.
- Admin filters cover date ranges, tenant, provider, model/service, source, feature, outcome and billing status. Activity is paginated; totals aggregate the complete filtered range. Daily totals, tenant/provider totals, leaders and conditional monthly projections are included.
- Warnings cover usage spikes, repeated failures, missing ownership, duplicate provider request IDs, unfinished entries, absent billing acceptance, spending thresholds and prices exceeding their configured ceiling.
- Platform, tenant, provider and feature controls can pause calls, require tenant keys, or cap monthly spend. Admissions are serialized and reserve a configured maximum request cost. A capped scope blocks requests without a ceiling, or with unpriced/unreserved historical usage. Reservations remain held until actual costs are confirmed. Provider costs exceeding the configured ceiling are flagged; provider-side limits remain necessary for an absolute external spending guarantee.
- Provider billing totals can be recorded and compared against confirmed ledger totals. Differences are flagged without assigning arbitrary shared provider costs to tenants.
- Confirmed unbilled usage can be collected into a Stripe draft invoice. Rows are locked and attached to one immutable batch. Invoice and item writes use stable idempotency keys. Requests that fail partway resume the same batch. Attempts older than 20 hours require review rather than risk replaying an expired idempotency key.
- Sub-cent amounts carry forward across invoice batches. Existing verified invoice webhook handling updates pending, billed, paid and voided usage. An older open event cannot move paid usage backward.

## Operational boundaries

- Tracking starts after deployment. Earlier provider use cannot be reliably attributed from cached key-lookup counters, so no fabricated history is imported.
- Existing trials/grants keep working, but usage without a recorded paid-use acceptance is held for review and excluded from automatic invoices. Acceptance applies prospectively; it does not authorize retroactive billing.
- Provider billing APIs and privileged billing credentials are not connected in this checkout. Reconciliation is evidence-backed manual confirmation and provider-total comparison. No live provider billing reconciliation was performed. Unconfirmed amounts cannot be invoiced.
- Stripe invoices are drafts with automatic advancement disabled. Review/finalize in Stripe to collect payment. The change does not install a monthly auto-charge schedule. Partial credit notes and refunds should be managed and reviewed in Stripe; the single-record manual status control records a reference, not a money movement.
- Billing-period boundaries are not fully stored in the existing organization schema. Use custom dates for contractual billing periods; this implementation does not guess them from a subscription end date.
- Storage, database infrastructure, flat subscriptions and other services without an instrumented billable execution adapter are not represented as per-request charges. There is no OpenAI adapter in this repository; the AI provider is Anthropic.
- All page data access still uses the repository’s existing authenticated server model. The migration does not switch the runtime database role or claim deployment-wide RLS rollout.

## Verification

Automated tests execute the migration and ledger queries on disposable PostgreSQL (PGlite), covering decimal precision, source attribution, tenant projection isolation, complete-range totals, reservations, failure persistence and invoice idempotency/rounding. Existing credential, provider-status and Claude-availability regression tests are included.

The production build compiled and completed type checking/static page generation, but this workspace failed when removing `.next/export` (`ENOTEMPTY`), including after a clean retry. A fully successful production packaging run is not claimed.

The cloud browser connected, but the preview URL was rejected with `ERR_BLOCKED_BY_CLIENT`. No successful desktop/mobile visual review or live authenticated production review is claimed. Provider calls and Stripe writes in the new tests are simulated; no production credentials, invoices or payments were used.

Stripe invoice behavior follows the documented draft and explicit invoice-item association APIs:
https://docs.stripe.com/api/invoices/create
https://docs.stripe.com/api/invoiceitems/create
